// Sky Across Time: app state, the timeline, travel between dates, input, frames.
import { CONFIG } from './config.js';
import * as A from './astro.js';
import { createRenderer } from './render/renderer.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { MARKS, RANGE, DEEP } from './dates.js';

const RAD = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const TRAVEL_MS = 3400;

const PLACES = {
  delhi: { lat: 28.61, lon: 77.21, haze: 0.85, mw: 0.05 },
  roorkee: { lat: 29.87, lon: 77.89, haze: 0.25, mw: 0.8 },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const COORDS = { delhi: '28.61\u00b0 N, 77.21\u00b0 E', roorkee: '29.87\u00b0 N, 77.89\u00b0 E' };

/** What the corner says: the date, and the time and place under it. */
function dateParts(ms, place) {
  const t = A.unixToIst(ms);
  const h12 = ((t.h + 11) % 12) + 1;
  return {
    date: `${t.d} ${MONTH_NAMES[t.mo - 1]} ${t.y}`,
    detail: `${h12}:${String(t.mi).padStart(2, '0')} ${t.h < 12 ? 'am' : 'pm'}   \u00b7   ${place === 'delhi' ? 'Delhi' : 'Roorkee'}   ${COORDS[place]}`,
  };
}

// ---------- catalogue ----------

const cat = await fetch('stars.json').then((r) => r.json());
const namedByName = Object.fromEntries(cat.names.filter((n) => n.star !== undefined)
  .map((n) => [n.name, { ra: cat.stars[n.star][0], dec: cat.stars[n.star][1] }]));

// ---------- setup ----------

const canvas = document.getElementById('sky');
const renderer = createRenderer(canvas, cat.stars);
if (!renderer) {
  document.getElementById('nogl').classList.remove('hidden');
  throw new Error('WebGL unavailable');
}
const audio = createAudio();

// The opening screen sits over the darkest of the nights: 12 Oct, over Roorkee, looking east.
const state = {
  mark: -1,
  place: 'roorkee',
  ms: A.istToUnix(2026, 10, 12, 23, 0),
  cam: { alt: 40, az: 75, fov: 105 },
  vel: { alt: 0, az: 0 },
  // region model: A (Delhi side) occupies [0, d) of the split axis and blends Delhi->Roorkee by a;
  // B is Roorkee. geo blends the geometry (lat/lon) so both halves share one continuous sky.
  region: { d: 1, a: 1, geo: 1 },
  turnDir: 1,
  nightAnim: null,
  placeAnim: null,
  fadeAnim: null,
  started: false,
  meteors: [],
  nextMeteor: performance.now() + 25000 + Math.random() * 35000,
};

const ui = createUI({
  marks: MARKS.map((m) => ({ label: m.label, ms: m.ms() })),
  range: { from: RANGE.from, to: RANGE.to() },
  places: [{ key: 'delhi', label: 'Delhi' }, { key: 'roorkee', label: 'Roorkee' }],
  onMark: (i) => goMark(i),
  onScrub: (ms) => scrubTo(ms),
  onPlace: selectPlace,
  onMute: () => { audio.setMuted(!audio.muted); return audio.muted; },
  muted: audio.muted,
});
ui.setPlace(state.place);

// ---------- geometry helpers ----------

function geometry(ms, geo) {
  const lat = mix(PLACES.delhi.lat, PLACES.roorkee.lat, geo);
  const lon = mix(PLACES.delhi.lon, PLACES.roorkee.lon, geo);
  return { lat, lon, lst: A.lst(A.julianDate(ms), lon) };
}

// Cached equatorial positions of the Sun, Moon and planets for a moment.
const bodyCache = new Map();
function bodies(ms) {
  if (!bodyCache.has(ms)) {
    if (bodyCache.size > 64) bodyCache.clear();
    const jd = A.julianDate(ms);
    bodyCache.set(ms, {
      sun: A.sunPosition(jd),
      moon: A.moonPosition(jd),
      planets: A.PLANETS.map((name) => ({ name, ...A.planetPosition(name, jd) })),
    });
  }
  return bodyCache.get(ms);
}

function localOf(M, ra, dec) { return A.applyMatrix(M, A.equatorialVector(ra, dec)); }
function sunAltAt(ms, geo) {
  const g = geometry(ms, geo);
  const s = bodies(ms).sun;
  return A.equatorialToHorizon(s.ra, s.dec, g.lst, g.lat).alt;
}

/** Equatorial RA/Dec of a story target at a moment. */
function targetRaDec(t, ms) {
  if (t === 'moon') { const m = bodies(ms).moon; return [m.ra, m.dec]; }
  const pl = bodies(ms).planets.find((p) => p.name === t);
  if (pl) return [pl.ra, pl.dec];
  if (namedByName[t]) return [namedByName[t].ra, namedByName[t].dec];
  return DEEP[t];
}

// ---------- transitions ----------

/**
 * Moves the sky to `ms` (a time-lapse) while the camera glides to `cam`.
 * spin: add an extra full turn, so the stars visibly wheel (used between nights).
 */
function travel(ms, cam, { spin = true } = {}) {
  const now = performance.now();
  const from = currentSkyTime(now);
  if (reducedMotion()) {
    state.fadeAnim = { t0: now, dur: 300, swap: () => {
      state.ms = ms; state.nightAnim = null;
      Object.assign(state.cam, cam);
      state.vel.alt = state.vel.az = 0;
    } };
    return;
  }
  const g0 = geometry(from.ms, state.region.geo);
  const g1 = geometry(ms, state.region.geo);
  const base = A.wrap360(g1.lst - g0.lst);
  let total;
  if (spin) { state.turnDir *= -1; total = state.turnDir > 0 ? base + 360 : base - 720; }
  else total = ms >= from.ms ? base : base - 360; // turn the way time actually goes
  state.nightAnim = {
    t0: now, dur: spin ? TRAVEL_MS : 3000,
    lst0: from.lst, total,
    msFrom: from.bodiesMs, msTo: ms, tFrom: from.ms, tTo: ms,
    sun0: sunAltAt(from.ms, state.region.geo), sun1: sunAltAt(ms, state.region.geo),
    cam0: { ...state.cam }, cam1: { ...cam },
    glide: true, ...flightShape(state.cam, cam, spin ? 0.45 : 0.2),
  };
  state.vel.alt = state.vel.az = 0;
  state.ms = ms;
}

/** Camera that frames a target (or the midpoint of two) at a moment, nicely placed on screen. */
function aimCam(targets, ms, fov) {
  const g = geometry(ms, state.region.geo);
  const M = A.horizonMatrix(g.lst, g.lat);
  const vecs = targets.map((t) => localOf(M, ...targetRaDec(t, ms)));
  let p = vecs.reduce((a, v) => a.map((x, i) => x + v[i]), [0, 0, 0]);
  const l = Math.hypot(...p); p = p.map((x) => x / l);
  const { alt, az } = A.vecToAltAz(p);
  // low targets sit in the lower part of the frame so the horizon shows
  const centre = Math.min(80, alt + fov * (alt < 30 ? 0.22 : 0.1));
  return { alt: centre - altOffset(), az, fov };
}

/** How the camera flies: pull back mid-flight, and order turning vs zooming for deep dives. */
function flightShape(c0, c1, pull) {
  const zoom = c1.fov < c0.fov / 3 ? 'in' : c1.fov > c0.fov * 3 ? 'out' : null;
  return { zoom, pull: zoom ? 0.15 : pull };
}

/** Camera-only flight (no time change), reusing the time-lapse machinery with zero rotation. */
function glideTo(cam) {
  const now = performance.now();
  const from = currentSkyTime(now);
  if (reducedMotion()) { Object.assign(state.cam, cam); return; }
  const shape = flightShape(state.cam, cam, 0.25);
  state.nightAnim = {
    t0: now, dur: shape.zoom ? 3400 : 2400, lst0: from.lst, total: 0, msFrom: from.bodiesMs, msTo: from.bodiesMs,
    tFrom: from.ms, tTo: from.ms,
    sun0: sunAltAt(from.ms, state.region.geo), sun1: sunAltAt(from.ms, state.region.geo),
    cam0: { ...state.cam }, cam1: { ...cam }, glide: true, keepBodies: true, ...shape,
  };
}

/** Where the sky "is" right now (mid-transition aware). */
function currentSkyTime(now) {
  const na = state.nightAnim;
  if (na) {
    const e = easeInOutCubic(clamp((now - na.t0) / na.dur, 0, 1));
    return { ms: e < 0.5 ? na.msFrom : na.msTo, bodiesMs: e < 0.5 ? na.msFrom : na.msTo, lst: na.lst0 + na.total * e };
  }
  return { ms: state.ms, bodiesMs: state.ms, lst: geometry(state.ms, state.region.geo).lst };
}

const PLACE_TARGET = { delhi: { d: 1, a: 0, geo: 0 }, roorkee: { d: 1, a: 1, geo: 1 } };

function selectPlace(key) {
  if (key === state.place) return;
  const r = state.region;
  // Normalise so a single place enters/leaves "Both" by sliding from its own edge.
  if (key === 'both' && r.d >= 0.999 && r.a >= 0.999) { r.d = 0; r.a = 0; }
  if (key === 'delhi' && r.d <= 0.001) { r.d = 1; r.a = 1; }
  let target = { ...PLACE_TARGET[key] };
  if (key === 'roorkee' && r.d < 0.999) target = { d: 0, a: 0, geo: 1 };
  state.placeAnim = { t0: performance.now(), dur: reducedMotion() ? 300 : 1400, from: { ...r }, to: target };
  state.place = key;
  ui.setPlace(key);
}

// ---------- the timeline ----------

/** Where to look on arrival: the brightest thing up (the Moon or a planet), else south. */
function arrivalCam(ms, fov = 100) {
  const g = geometry(ms, state.region.geo);
  const M = A.horizonMatrix(g.lst, g.lat);
  const b = bodies(ms);
  const cands = [];
  if (localOf(M, b.moon.ra, b.moon.dec)[2] > 0.26) cands.push({ t: 'moon', mag: -12 });
  for (const p of b.planets) if (p.mag < 1 && localOf(M, p.ra, p.dec)[2] > 0.26) cands.push({ t: p.name, mag: p.mag });
  cands.sort((a, c) => a.mag - c.mag);
  if (cands.length) return aimCam([cands[0].t], ms, fov);
  return { alt: 45, az: 180, fov };
}

/** Fly to one of the marked dates: the sky wheels through time, the date counts as she goes. */
function goMark(i) {
  if (!state.started) return;
  i = clamp(i, 0, MARKS.length - 1);
  state.mark = i;
  const ms = MARKS[i].ms();
  const dt = Math.abs(ms - state.ms);
  const cam = arrivalCam(ms, 100);
  if (dt < 1000) glideTo(cam);
  else travel(ms, cam, { spin: dt > 2 * 86400e3 });
  ui.setMark(i);
}
const next = () => goMark(state.mark >= MARKS.length - 1 ? 0 : state.mark + 1);
const prev = () => goMark(Math.max(0, state.mark - 1));

/** Dragging the timeline: the same hour of night, on whichever day she's dragged to. */
function scrubTo(ms) {
  if (!state.started) return;
  const t = A.unixToIst(ms);
  let m = A.istToUnix(t.y, t.mo, t.d, 23, 0);
  m = Math.min(m, RANGE.to());
  state.nightAnim = null;
  state.ms = m;
  state.mark = -1;
  ui.setMark(-1);
}

// ---------- input ----------

const pointers = new Map();
let gesture = null;
function cssSize() { return { W: innerWidth, H: innerHeight }; }
function degPerPx() { const { W, H } = cssSize(); return (state.cam.fov / Math.min(W, H)) * 0.95; }
function altOffset() { const { W, H } = cssSize(); return clamp((H / W - 1) * 25, 0, 30); }
function clampCam() {
  const off = altOffset();
  state.cam.alt = clamp(state.cam.alt, -8 - off, 86 - off);
  state.cam.az = A.wrap360(state.cam.az);
  state.cam.fov = clamp(state.cam.fov, 2, 130);
}
function takeControl() { if (state.nightAnim) state.nightAnim.glide = false; }

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    gesture = { type: 'drag', sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: 0, t: performance.now(), pointerType: e.pointerType };
    state.vel.alt = state.vel.az = 0;
    canvas.classList.add('dragging');
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), fov: state.cam.fov, moved: 99 };
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;
  if (gesture.type === 'drag') {
    const dx = e.clientX - gesture.lx, dy = e.clientY - gesture.ly;
    gesture.lx = e.clientX; gesture.ly = e.clientY;
    gesture.moved = Math.max(gesture.moved, Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy));
    if (gesture.moved < 10) return;
    const k = degPerPx();
    takeControl();
    state.cam.az -= dx * k;
    state.cam.alt += dy * k;
    clampCam();
    const now = performance.now();
    const dt = Math.max(1, now - gesture.t) / 16.67;
    gesture.t = now;
    state.vel.az = mix(state.vel.az, (-dx * k) / dt, 0.6);
    state.vel.alt = mix(state.vel.alt, (dy * k) / dt, 0.6);
  } else if (gesture.type === 'pinch' && pointers.size >= 2) {
    takeControl();
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    state.cam.fov = clamp(gesture.fov * (gesture.dist / Math.max(d, 1)), 2, 130);
  }
});
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture?.type === 'drag' && pointers.size === 0) {
    if (gesture.moved < 10) { state.vel.alt = state.vel.az = 0; if (e.type === 'pointerup') tap(e.clientX); }
    else if (performance.now() - gesture.t > 80) state.vel.alt = state.vel.az = 0; // held still before release
  }
  if (pointers.size === 0) { gesture = null; canvas.classList.remove('dragging'); }
  else if (pointers.size === 1) {
    const [p] = [...pointers.values()];
    gesture = { type: 'drag', sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: 99, t: performance.now() };
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  takeControl();
  state.cam.fov = clamp(state.cam.fov * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), 2, 130);
}, { passive: false });
// iOS Safari pinch-zoom of the page itself
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.target === canvas) e.preventDefault(); }, { passive: false });

addEventListener('keydown', (e) => {
  if (!state.started) return;
  const k = e.key;
  let used = true;
  if (k === '+' || k === '=') state.cam.fov = clamp(state.cam.fov / 1.12, 2, 130);
  else if (k === '-' || k === '_') state.cam.fov = clamp(state.cam.fov * 1.12, 20, 130);
  else if (k === 'ArrowLeft') state.cam.az -= 4;
  else if (k === 'ArrowRight') state.cam.az += 4;
  else if (k === 'ArrowUp') state.cam.alt += 3;
  else if (k === 'ArrowDown') state.cam.alt -= 3;
  else if (k === ' ' || k === 'Enter') { if (e.target.tagName === 'BUTTON') return; e.shiftKey ? prev() : next(); }
  else used = false;
  if (used) { e.preventDefault(); takeControl(); clampCam(); }
});

/** A tap on the sky travels on; a tap near the left edge goes back. */
function tap(x) {
  if (!state.started) return;
  if (x < innerWidth * 0.22 && state.mark > 0) prev();
  else next();
}

// ---------- per-frame view ----------

const norm = (p) => { const l = Math.hypot(...p) || 1; return p.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function buildView(now) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const { W: w, H: h } = cssSize();
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const alt = clamp(state.cam.alt + altOffset(), -8, 86);
  const f = A.altAzToVec(alt, state.cam.az);
  const rl = Math.hypot(f[1], f[0]);
  const r = [f[1] / rl, -f[0] / rl, 0];
  const u = cross(r, f);
  const S = (Math.min(W, H) / 2) / (2 * Math.tan((state.cam.fov / 4) * RAD));
  return { W, H, dpr, cx: W / 2, cy: H / 2, S, f, r, u, time: now / 1000, zoom: clamp(Math.pow(100 / state.cam.fov, 0.3), 0.9, 1.5), fade: 1,
    fov: state.cam.fov, zoomDark: 0.85 * smoothstep(45, 4, state.cam.fov) };
}

/** Local ENU vector -> GL device px, or null if behind the camera. */
function project(v, p) {
  const d = p[0] * v.f[0] + p[1] * v.f[1] + p[2] * v.f[2];
  if (d < -0.5) return null;
  const k = 2 / (1 + d);
  const X = k * (p[0] * v.r[0] + p[1] * v.r[1] + p[2] * v.r[2]);
  const Y = k * (p[0] * v.u[0] + p[1] * v.u[1] + p[2] * v.u[2]);
  return [v.cx + X * v.S, v.cy + Y * v.S, k];
}
function unproject(v, x, y) {
  const X = (x - v.cx) / v.S, Y = (y - v.cy) / v.S, s = X * X + Y * Y;
  const a = 4 / (4 + s), c = (4 - s) / (4 + s);
  return [0, 1, 2].map((i) => a * X * v.r[i] + a * Y * v.u[i] + c * v.f[i]);
}

function screenDirTowards(v, from, to) {
  const t = norm(to.map((x, i) => x - dot(to, from) * from[i]));
  const a = project(v, from), b = project(v, norm(from.map((x, i) => x + 0.01 * t[i])));
  if (!a || !b) return [0, 1];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

function placeParams(blend, moonGlow, night) {
  const D = PLACES.delhi, R = PLACES.roorkee;
  const haze = mix(D.haze, R.haze, blend);
  // zooming in works like binoculars: fainter stars and more of the Milky Way show
  const zoomed = smoothstep(70, 22, state.cam.fov);
  return {
    haze, mw: Math.min(0.85, mix(D.mw, R.mw, blend) * (1 + 3 * zoomed)), tree: blend,
    lim: 5.6 - 2.3 * haze - 1.6 * moonGlow - 6 * (1 - night) + 4 * zoomed,
  };
}

// ---------- shooting stars ----------

function spawnMeteor(now, v, shower) {
  for (let tries = 0; tries < 16; tries++) {
    const p0 = unproject(v, v.W * (0.08 + 0.84 * Math.random()), v.H * (0.25 + 0.7 * Math.random()));
    if (p0[2] < Math.sin(14 * RAD)) continue;
    let t;
    if (shower) {
      const g = geometry(state.ms, state.region.geo);
      const rad = localOf(A.horizonMatrix(g.lst, g.lat), ...shower);
      const c = dot(rad, p0);
      if (c > Math.cos(6 * RAD) || c < Math.cos(75 * RAD)) continue;
      t = norm(p0.map((x, i) => x * c - rad[i]));
    } else {
      const rnd = norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
      t = norm(rnd.map((x, i) => x - dot(rnd, p0) * p0[i]));
    }
    const bright = shower ? 0.45 + Math.random() * 0.55 : 0.35 + Math.random() * 0.35;
    state.meteors.push({ p0, t, len: (shower ? 8 + Math.random() * 16 : 6 + Math.random() * 8) * RAD, t0: now, dur: 450 + Math.random() * 450, bright });
    if (shower && bright > 0.92) audio.bell(81 + [0, 2, 5, 7][Math.floor(Math.random() * 4)], 0.012);
    return;
  }
}

function updateMeteors(now, v, night) {
  const busy = state.nightAnim || state.placeAnim || !state.started;
  const radiant = null;
  const shower = false;
  if (now > state.nextMeteor) {
    state.nextMeteor = now + (shower ? 600 + Math.random() * 1900 : 25000 + Math.random() * 35000);
    if (night >= 0.99 && !busy && !reducedMotion()) spawnMeteor(now, v, shower ? radiant : null);
  } else if (shower && state.nextMeteor - now > 3000) state.nextMeteor = now + 800;
  const out = [];
  state.meteors = state.meteors.filter((m) => {
    const k = (now - m.t0) / m.dur;
    if (k >= 1) return false;
    const at = (s) => { const a = s * m.len; return m.p0.map((x, i) => x * Math.cos(a) + m.t[i] * Math.sin(a)); };
    const head = project(v, at(k)), tail = project(v, at(Math.max(0, k - 0.45)));
    if (head && tail) out.push({ a: tail, b: head, alpha: m.bright * Math.sin(Math.PI * k), width: 0.8 + 1.4 * m.bright * m.bright });
    return true;
  });
  return out;
}

// ---------- frame ----------

function frame(now) {
  requestAnimationFrame(frame);
  const v = buildView(now);

  if (state.placeAnim) {
    const pa = state.placeAnim;
    const k = clamp((now - pa.t0) / pa.dur, 0, 1);
    const e = easeInOutCubic(k);
    for (const key of ['d', 'a', 'geo']) state.region[key] = mix(pa.from[key], pa.to[key], e);
    if (k >= 1) state.placeAnim = null;
  }

  // time-lapse and camera glide
  let sky = currentSkyTime(now);
  let bodyAlpha = 1;
  let sunAlt;
  const na = state.nightAnim;
  if (na) {
    const t = now - na.t0;
    const k = clamp(t / na.dur, 0, 1);
    const e = easeInOutCubic(k);
    if (na.glide) {
      const c0 = na.cam0, c1 = na.cam1;
      const daz = ((c1.az - c0.az + 540) % 360) - 180;
      // diving in: turn first, then zoom; flying out: zoom first, then turn
      const ed = na.zoom === 'in' ? easeInOutCubic(clamp(k * 1.7, 0, 1))
        : na.zoom === 'out' ? easeInOutCubic(clamp((k - 0.3) / 0.7, 0, 1)) : e;
      const ez = na.zoom === 'in' ? easeInOutCubic(clamp((k - 0.25) / 0.75, 0, 1))
        : na.zoom === 'out' ? easeInOutCubic(clamp(k / 0.75, 0, 1)) : e;
      state.cam.alt = mix(c0.alt, c1.alt, ed);
      state.cam.az = A.wrap360(c0.az + daz * ed);
      const logFov = Math.exp(mix(Math.log(c0.fov), Math.log(c1.fov), ez));
      state.cam.fov = Math.min(150, logFov * (1 + na.pull * Math.sin(Math.PI * k)));
    }
    state.shownMs = na.tFrom !== na.tTo ? na.tFrom + (na.tTo - na.tFrom) * e : state.ms;
    if (!na.keepBodies) {
      bodyAlpha = t < 400 ? 1 - t / 400 : t > na.dur - 600 ? (t - (na.dur - 600)) / 600 : 0;
      bodyAlpha = clamp(bodyAlpha, 0, 1);
      sunAlt = Math.min(mix(na.sun0, na.sun1, e), -14);
    }
    if (k >= 1) { state.nightAnim = null; sky = currentSkyTime(now); bodyAlpha = 1; sunAlt = undefined; }
  }

  if (!gesture && (Math.abs(state.vel.az) > 1e-3 || Math.abs(state.vel.alt) > 1e-3)) {
    state.cam.az += state.vel.az;
    state.cam.alt += state.vel.alt;
    state.vel.az *= 0.93; state.vel.alt *= 0.93;
    clampCam();
  }

  if (state.fadeAnim) {
    const fa = state.fadeAnim;
    const k = clamp((now - fa.t0) / fa.dur, 0, 1);
    if (k >= 0.5 && fa.swap) { fa.swap(); fa.swap = null; sky = currentSkyTime(now); }
    v.fade = Math.abs(1 - 2 * k);
    if (k >= 1) state.fadeAnim = null;
  }

  const geo = geometry(sky.ms, state.region.geo);
  const M = A.horizonMatrix(sky.lst, geo.lat);
  v.M = new Float32Array(M);
  const b = bodies(sky.bodiesMs);
  if (sunAlt === undefined) sunAlt = A.vecToAltAz(localOf(M, b.sun.ra, b.sun.dec)).alt;
  const night = 1 - smoothstep(-15, -5, sunAlt);
  const day = smoothstep(-14, 2, sunAlt);

  // Moon (topocentric)
  const moonTopo = A.moonTopocentric(A.vecToAltAz(localOf(M, b.moon.ra, b.moon.dec)));
  const moonVec = A.altAzToVec(moonTopo.alt, moonTopo.az);
  const moonGlow = b.moon.illum * smoothstep(-2, 15, moonTopo.alt) * bodyAlpha;
  const light = { night, day, moonGlow, moonDir: moonVec };

  let moonSprite = null;
  const mp = moonTopo.alt > -1 ? project(v, moonVec) : null;
  if (mp) {
    const radius = Math.max(9 * v.dpr, v.S * mp[2] * 0.26 * RAD);
    const sunVec = localOf(M, b.sun.ra, b.sun.dec);
    const pole = [M[2], M[5], M[8]];
    const airmass = 1 / Math.max(0.06, moonVec[2]);
    const hz = mix(PLACES.delhi.haze, PLACES.roorkee.haze, state.region.geo);
    const ext = Math.pow(10, -0.4 * 0.25 * (airmass - 1) * (1 + hz));
    moonSprite = {
      x: mp[0], y: mp[1], radius,
      north: screenDirTowards(v, moonVec, pole), sun: screenDirTowards(v, moonVec, sunVec),
      cosI: 2 * b.moon.illum - 1, illum: b.moon.illum, alpha: bodyAlpha * Math.max(0.35, ext),
    };
  }

  const portrait = v.H > v.W;
  const r = state.region;
  const pA = placeParams(r.a, moonGlow, night);
  const pB = placeParams(1, moonGlow, night);
  let regions;
  if (!portrait) {
    const x = Math.round(v.W * r.d);
    regions = [{ x: 0, y: 0, w: x, h: v.H, place: pA }, { x, y: 0, w: v.W - x, h: v.H, place: pB }];
  } else {
    const y = Math.round(v.H * (1 - r.d));
    regions = [{ x: 0, y, w: v.W, h: v.H - y, place: pA }, { x: 0, y: 0, w: v.W, h: y, place: pB }];
  }

  const hz = mix(PLACES.delhi.haze, PLACES.roorkee.haze, state.region.geo);
  const meteors = updateMeteors(now, v, night).map((m) => ({ ...m, alpha: m.alpha * (1 - 0.45 * hz) }));

  renderer.frame(v, regions, light, b.planets, moonSprite, bodyAlpha, meteors);
  ui.overlay(r.d, portrait, v.dpr);
  const shown = state.nightAnim ? state.shownMs ?? state.ms : state.ms;
  ui.setDate(dateParts(shown, state.place), shown);
}

// ---------- start screen and gate ----------

const startEl = document.getElementById('start');
const gateEl = document.getElementById('gate');
function begin() {
  if (state.started) return;
  audio.start();
  state.started = true;
  startEl.classList.add('hidden');
  ui.show();
  goMark(0);
}
startEl.addEventListener('click', begin);
startEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') begin(); });

const unlock = CONFIG.unlockAt ? Date.parse(CONFIG.unlockAt) : 0;
if (unlock && Date.now() < unlock && location.hash !== '#preview') {
  gateEl.classList.remove('hidden');
  const cd = document.getElementById('countdown');
  const tick = () => {
    const s = Math.max(0, Math.ceil((unlock - Date.now()) / 1000));
    cd.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
    if (s <= 0) { gateEl.classList.add('hidden'); startEl.classList.remove('hidden'); return; }
    setTimeout(tick, 1000 - (Date.now() % 1000));
  };
  tick();
} else {
  startEl.classList.remove('hidden');
}

requestAnimationFrame(frame);

if (import.meta.env.DEV) window.__sky = { state, goMark, next, prev, selectPlace, scrubTo };

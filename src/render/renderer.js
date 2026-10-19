// Section 6.1: one WebGL canvas, drawn per region (one, or two in split view):
// sky + Milky Way, bright stars, planets, Moon, shooting stars, horizon silhouette.
import { createContext, program, quadBuffer, textureFromImage, blankTexture, loadImage, resetAttribs, QUAD_VERT } from './gl.js';
import common from './common.glsl?raw';
import skyFrag from './sky.frag?raw';
import { createHorizon, FRAG_HEAD } from './horizon.js';
import { createStars } from './stars.js';
import { createMoon } from './moon.js';

const METEOR_VERT = `#version 300 es
precision highp float;
in vec3 aPos; // clip xy, t along streak
out float vT;
void main() { vT = aPos.z; gl_Position = vec4(aPos.xy, 0.0, 1.0); }
`;
const METEOR_FRAG = `#version 300 es
precision highp float;
in float vT;
uniform float uAlpha;
out vec4 fragColor;
void main() { fragColor = vec4(vec3(0.85, 0.9, 1.0) * uAlpha * vT * vT, 1.0); }
`;

export function createRenderer(canvas, catalogue) {
  const ctx = createContext(canvas);
  if (!ctx) return null;
  const { gl } = ctx;
  const quad = quadBuffer(gl);
  const sky = program(ctx, QUAD_VERT, FRAG_HEAD + common + skyFrag);
  const horizon = createHorizon(ctx, quad);
  const stars = createStars(ctx, catalogue);
  const moon = createMoon(ctx);
  const meteorProg = program(ctx, METEOR_VERT, METEOR_FRAG);
  const meteorBuf = gl.createBuffer();

  // Photo layer: preview first, then full tiles (section 4.2).
  const tex = { preview: blankTexture(ctx), t0: blankTexture(ctx), t1: blankTexture(ctx), tiled: false };
  const ready = loadImage('sky/preview_2k.jpg').then((img) => { tex.preview = textureFromImage(ctx, img); });
  fetch('sky/manifest.json').then((r) => r.json()).then(async (m) => {
    const imgs = await Promise.all(m.tiles.map((t) => loadImage('sky/' + t.file)));
    tex.t0 = textureFromImage(ctx, imgs[0]);
    tex.t1 = textureFromImage(ctx, imgs[1] || imgs[0]);
    tex.tiled = true;
  }).catch((e) => console.warn('sky tiles unavailable', e));

  // Close-up survey photos (DSS2 colour via CDS hips2fits, gnomonic, north up). Each fades in
  // when she zooms in near it, so flying in feels like arriving somewhere.
  const RAD = Math.PI / 180;
  const PATCHES = [
    { file: 'm44.jpg', ra: 130.1, dec: 19.67, half: 1.6 },   // Beehive
    { file: 'm42.jpg', ra: 83.82, dec: -5.39, half: 0.8 },   // Orion Nebula
    { file: 'm45.jpg', ra: 56.75, dec: 24.12, half: 1.3 },   // Pleiades
    { file: 'm31.jpg', ra: 10.68, dec: 41.27, half: 1.7 },   // Andromeda
  ].map((p) => {
    const a = p.ra * RAD, d = p.dec * RAD;
    const out = { ...p, tex: null,
      c: [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)],
      e: [-Math.sin(a), Math.cos(a), 0],
      n: [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)] };
    loadImage('sky/' + p.file).then((img) => { out.tex = textureFromImage(ctx, img); }).catch(() => {});
    return out;
  });
  const blank = blankTexture(ctx);
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /** The photo nearest the view centre, and how strongly it shows at this zoom. */
  function activePatch(v) {
    const M = v.M, f = v.f;
    const fe = [0, 1, 2].map((i) => M[i] * f[0] + M[3 + i] * f[1] + M[6 + i] * f[2]); // ENU -> equatorial
    let best = null;
    for (const p of PATCHES) {
      if (!p.tex) continue;
      const ang = Math.acos(Math.min(1, fe[0] * p.c[0] + fe[1] * p.c[1] + fe[2] * p.c[2])) / RAD;
      if (ang > v.fov * 0.9 + p.half) continue;
      const a = smooth(p.half * 12, p.half * 4.5, v.fov);
      if (a > 0.001 && (!best || ang < best.ang)) best = { p, a, ang };
    }
    return best;
  }

  function setView(prog, v, place) {
    const u = prog.u;
    gl.uniform2f(u.uCenter, v.cx, v.cy);
    gl.uniform1f(u.uS, v.S);
    gl.uniform3fv(u.uF, v.f); gl.uniform3fv(u.uR, v.r); gl.uniform3fv(u.uU, v.u);
    gl.uniform3f(u.uSkyglow, 0.3 * place.haze, 0.17 * place.haze, 0.09 * place.haze);
    gl.uniform1f(u.uHaze, place.haze);
    gl.uniform1f(u.uFade, v.fade);
  }

  function drawSky(v, place, light) {
    gl.useProgram(sky.p);
    const u = sky.u;
    setView(sky, v, place);
    gl.uniformMatrix3fv(u.uMt, false, v.M);
    gl.uniform1f(u.uMw, place.mw);
    gl.uniform1f(u.uNight, light.night);
    gl.uniform1f(u.uDay, light.day);
    gl.uniform1f(u.uMoonGlow, light.moonGlow);
    gl.uniform3fv(u.uMoonDir, light.moonDir);
    gl.uniform1f(u.uSeed, (v.time * 61.7) % 97);
    gl.uniform1f(u.uTiled, tex.tiled ? 1 : 0);
    gl.uniform1f(u.uZoomDark, v.zoomDark || 0);
    const ap = activePatch(v);
    const P = ap ? ap.p : PATCHES[0];
    gl.uniform3fv(u.uPatchC, P.c); gl.uniform3fv(u.uPatchE, P.e); gl.uniform3fv(u.uPatchN, P.n);
    gl.uniform1f(u.uPatchT, Math.tan(P.half * RAD));
    gl.uniform1f(u.uPatchA, ap ? ap.a * (1 - 0.3 * place.haze) : 0);
    [[tex.t0, 'uTile0'], [tex.t1, 'uTile1'], [tex.preview, 'uPreview'], [(ap && ap.p.tex) || blank, 'uPatch']].forEach(([t, name], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(u[name], i);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(sky.a.aPos);
    gl.vertexAttribPointer(sky.a.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    resetAttribs(gl);
  }

  function drawMeteor(v, m) {
    // m: { a:[x,y], b:[x,y] device px (GL), alpha, width (CSS px) }
    const dx = m.b[0] - m.a[0], dy = m.b[1] - m.a[1];
    const len = Math.hypot(dx, dy) || 1;
    const c = (x, y) => [(x / v.W) * 2 - 1, (y / v.H) * 2 - 1];
    gl.useProgram(meteorProg.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, meteorBuf);
    gl.enableVertexAttribArray(meteorProg.a.aPos);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    // a soft glow, then the bright core
    for (const [wk, ak] of [[5, 0.12], [1, 1]]) {
      const w = (m.width || 0.7) * wk * v.dpr * 0.5;
      const nx = (-dy / len) * w, ny = (dx / len) * w;
      const d = new Float32Array([
        ...c(m.a[0] + nx, m.a[1] + ny), 0, ...c(m.a[0] - nx, m.a[1] - ny), 0,
        ...c(m.b[0] + nx, m.b[1] + ny), 1, ...c(m.b[0] - nx, m.b[1] - ny), 1,
      ]);
      gl.uniform1f(meteorProg.u.uAlpha, m.alpha * ak * v.fade);
      gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(meteorProg.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
    resetAttribs(gl);
  }

  return {
    ready,
    gl,
    /**
     * v: view; regions: [{ x, y, w, h (device px, GL y-up), place }];
     * light: { night, day, moonGlow, moonDir }; planets; moonSprite; bodyAlpha; meteors
     */
    frame(v, regions, light, planets, moonSprite, bodyAlpha, meteors) {
      gl.viewport(0, 0, v.W, v.H);
      gl.enable(gl.SCISSOR_TEST);
      for (const r of regions) {
        if (r.w <= 0 || r.h <= 0) continue;
        gl.scissor(r.x, r.y, r.w, r.h);
        const place = r.place;
        drawSky(v, place, light);
        stars.draw(v, place, planets, bodyAlpha);
        resetAttribs(gl);
        moon.draw(v, moonSprite);
        resetAttribs(gl);
        for (const m of meteors) drawMeteor(v, m);
        horizon.draw((p) => setView(p, v, place), place);
        resetAttribs(gl);
      }
      gl.disable(gl.SCISSOR_TEST);
    },
  };
}

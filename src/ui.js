// The interface: the date in the corner, a Delhi / Roorkee switch, and a timeline from 2003 to
// tonight that she can drag across, with the marked dates as stops she can tap.
const $ = (id) => document.getElementById(id);

export function createUI({ marks, range, places, onMark, onScrub, onPlace, onMute, muted }) {
  const span = range.to - range.from;
  const frac = (ms) => Math.min(1, Math.max(0, (ms - range.from) / span));
  const pct = (ms) => `${frac(ms) * 100}%`;

  // ----- the timeline -----
  const track = $('track');
  const startYear = new Date(range.from).getUTCFullYear();
  const endYear = new Date(range.to).getUTCFullYear();
  for (let y = startYear + 1; y <= endYear; y++) {
    const t = document.createElement('span');
    t.className = 'year-tick';
    t.style.left = pct(Date.UTC(y, 0, 1));
    track.appendChild(t);
  }
  [['start-year', startYear], ['end-year', endYear]].forEach(([cls, y]) => {
    const e = document.createElement('span');
    e.className = cls;
    e.textContent = y;
    track.appendChild(e);
  });

  const pins = marks.map((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin';
    b.style.left = pct(m.ms);
    b.setAttribute('aria-label', m.label);
    b.addEventListener('click', (e) => { e.stopPropagation(); onMark(i); });
    track.appendChild(b);
    return b;
  });
  const handle = document.createElement('span');
  handle.className = 'handle';
  track.appendChild(handle);

  // drag anywhere on the track to move through the years
  let dragging = false;
  const scrubAt = (x) => {
    const r = track.getBoundingClientRect();
    onScrub(range.from + Math.min(1, Math.max(0, (x - r.left) / r.width)) * span);
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('pin')) return;
    dragging = true;
    track.setPointerCapture(e.pointerId);
    document.body.classList.add('scrubbing');
    scrubAt(e.clientX);
  });
  track.addEventListener('pointermove', (e) => { if (dragging) scrubAt(e.clientX); });
  const end = () => { dragging = false; document.body.classList.remove('scrubbing'); };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);

  // ----- the dates as buttons -----
  const chips = marks.map((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onMark(i));
    $('chips').appendChild(b);
    return b;
  });

  // ----- place, sound -----
  const placeBtns = places.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onPlace(p.key));
    $('places').appendChild(b);
    return [p.key, b];
  });
  const mute = $('mute');
  const setMuteBtn = (m) => {
    mute.setAttribute('aria-pressed', String(m));
    mute.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  };
  setMuteBtn(muted);
  mute.addEventListener('click', () => setMuteBtn(onMute()));

  const overlay = $('overlay');
  const o2d = overlay.getContext('2d');
  let lastDate = '', lastDetail = '';

  return {
    show() { $('ui').classList.remove('hidden'); },
    setMark(i) {
      chips.forEach((c, k) => c.setAttribute('aria-pressed', String(k === i)));
      pins.forEach((p, k) => p.classList.toggle('on', k === i));
      if (chips[i]) chips[i].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    },
    setPlace(key) { placeBtns.forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === key))); },
    /** The date in the corner and the handle on the timeline, every frame (cheap when unchanged). */
    setDate({ date, detail }, ms) {
      if (date !== lastDate) { $('date').textContent = date; lastDate = date; }
      if (detail !== lastDetail) { $('detail').textContent = detail; lastDetail = detail; }
      handle.style.left = pct(ms);
    },
    /** Kept for the renderer's split view, which this version doesn't use: just keeps it clear. */
    overlay(_frac, _portrait, dpr) {
      const W = innerWidth, H = innerHeight;
      if (overlay.width !== Math.round(W * dpr) || overlay.height !== Math.round(H * dpr)) {
        overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr);
      }
    },
  };
}

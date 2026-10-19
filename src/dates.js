// The dates on the timeline, and the timeline's range, read from config.js.
import { CONFIG } from './config.js';
import * as A from './astro.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Places in space with real survey photos (render/renderer.js); she can pinch into them.
export const DEEP = {
  m42: [83.82, -5.39], m45: [56.75, 24.12], m31: [10.68, 41.27], m44: [130.1, 19.67],
};

/** Tonight: now if it's dark out in India, otherwise 10 pm today. */
export function tonightMs() {
  const now = Date.now();
  const t = A.unixToIst(now);
  if (t.h >= 21 || t.h < 4) return now;
  return A.istToUnix(t.y, t.mo, t.d, 22, 0);
}

const parse = ({ date, time = '23:00' }) => {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return A.istToUnix(y, mo, d, h, mi);
};

export const MARKS = [
  ...CONFIG.dates.map((d) => {
    const ms = parse(d);
    const t = A.unixToIst(ms);
    return { ms: () => ms, label: `${t.d} ${MONTHS[t.mo - 1]} ${t.y}` };
  }).sort((a, b) => a.ms() - b.ms()),
  { ms: tonightMs, label: 'Tonight', tonight: true },
];

export const RANGE = { from: parse({ date: CONFIG.from, time: '23:00' }), to: () => Math.max(tonightMs(), Date.now()) };

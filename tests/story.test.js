// Every sky fact the story tells her, checked with our own maths (cross-checked in astro.test.js).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as A from '../src/astro.js';

const DELHI = [28.61, 77.21];
const cat = JSON.parse(readFileSync('public/stars.json', 'utf8'));
const star = (name) => { const n = cat.names.find((x) => x.name === name); return [cat.stars[n.star][0], cat.stars[n.star][1]]; };
const at = (ms, [ra, dec]) => A.equatorialToHorizon(ra, dec, A.lst(A.julianDate(ms), DELHI[1]), DELHI[0]);
const planet = (name, ms) => { const p = A.planetPosition(name, A.julianDate(ms)); return { ...p, ...at(ms, [p.ra, p.dec]) }; };
const sep = (ra1, d1, ra2, d2) => {
  const r = Math.PI / 180;
  return Math.acos(Math.sin(d1 * r) * Math.sin(d2 * r) + Math.cos(d1 * r) * Math.cos(d2 * r) * Math.cos((ra1 - ra2) * r)) / r;
};
// Leo's rough bounds (RA 140-180 deg, Dec -5..+35) are enough to say "in Leo" for these dates
const inLeo = (p) => p.ra > 140 && p.ra < 180 && p.dec > -5 && p.dec < 35;

describe('her birth night (18 Jan 2003, 23:30, Delhi)', () => {
  const ms = A.istToUnix(2003, 1, 18, 23, 30);
  it('the Moon is full, with Jupiter below it', () => {
    const s = A.skyState(ms, ...DELHI);
    expect(s.moon.illum).toBeGreaterThan(0.98);
    const j = planet('jupiter', ms);
    expect(j.alt).toBeLessThan(s.moon.alt);
    expect(sep(s.moon.ra, s.moon.dec, j.ra, j.dec)).toBeLessThan(16);
  });
});

describe('his birth night (20 Apr 2003, 22:00), 92 days later', () => {
  const ms = A.istToUnix(2003, 4, 20, 22, 0);
  it('is 92 days after hers', () => expect((A.istToUnix(2003, 4, 20, 0, 0) - A.istToUnix(2003, 1, 18, 0, 0)) / 86400e3).toBe(92));
  it('the same Jupiter is up in the west', () => { const j = planet('jupiter', ms); expect(j.alt).toBeGreaterThan(30); expect(j.az).toBeGreaterThan(225); expect(j.az).toBeLessThan(300); });
});

describe('August 2003', () => {
  it('Mars was closest to Earth around 27 Aug, and bright and up that night', () => {
    const dist = (d) => A.planetPosition('mars', A.julianDate(A.istToUnix(2003, 8, d, 12, 0))).distance;
    expect(dist(27)).toBeLessThan(dist(20));
    expect(dist(27)).toBeLessThan(dist(3 + 31)); // 3 Sep
    expect(dist(27)).toBeLessThan(0.375); // AU; ~55.8 million km
    const m = planet('mars', A.istToUnix(2003, 8, 27, 23, 30));
    expect(m.alt).toBeGreaterThan(30);
    expect(m.mag).toBeLessThan(-2.5);
  });
});

describe('12 October 2026', () => {
  const ms = A.istToUnix(2026, 10, 12, 23, 0);
  it('the Moon is a ~5% sliver, already set', () => {
    const s = A.skyState(ms, ...DELHI);
    expect(Math.round(s.moon.illum * 100)).toBeLessThanOrEqual(6);
    expect(s.moon.alt).toBeLessThan(0);
  });
  it('Saturn is high in the south', () => { const s = planet('saturn', ms); expect(s.alt).toBeGreaterThan(55); expect(Math.abs(s.az - 180)).toBeLessThan(30); });
  it('that morning at 04:30, Mars was inside the Beehive with Jupiter below it in the east', () => {
    const m0 = A.istToUnix(2026, 10, 12, 4, 30);
    const mars = planet('mars', m0), jup = planet('jupiter', m0);
    expect(sep(mars.ra, mars.dec, 130.1, 19.67)).toBeLessThan(0.4);
    expect(jup.alt).toBeLessThan(mars.alt);
    expect(jup.mag).toBeLessThan(-1.5);
    expect(Math.abs(jup.az - 90)).toBeLessThan(20);
  });
});

describe('her next birthday (18 Jan 2027, 23:30)', () => {
  const ms = A.istToUnix(2027, 1, 18, 23, 30);
  it('the Moon is about 80% lit, a few degrees from the Pleiades', () => {
    const m = A.moonPosition(A.julianDate(ms));
    expect(Math.abs(m.illum - 0.8)).toBeLessThan(0.04);
    expect(sep(m.ra, m.dec, 56.75, 24.12)).toBeLessThan(7);
  });
  it('Jupiter and Mars are both up in the east, in Leo', () => {
    for (const n of ['jupiter', 'mars']) { const p = planet(n, ms); expect(inLeo(p), n).toBe(true); expect(p.alt).toBeGreaterThan(15); expect(p.az).toBeLessThan(120); }
  });
});

describe('Geminids night (13-14 Dec 2026)', () => {
  it('the Moon is a thin crescent and has set by 9:30 pm', () => {
    const ms = A.istToUnix(2026, 12, 13, 21, 30);
    const s = A.skyState(ms, ...DELHI);
    expect(s.moon.illum).toBeLessThan(0.25);
    expect(s.moon.alt).toBeLessThan(0);
  });
  it('the radiant in Gemini is high at 2:30 am', () => expect(at(A.istToUnix(2026, 12, 14, 2, 30), [112.3, 32.5]).alt).toBeGreaterThan(70));
});

describe('journeys into space and moments in the sky', () => {
  it('the Orion Nebula is well up on her birthday night', () => expect(at(A.istToUnix(2005, 1, 18, 23, 30), [83.82, -5.39]).alt).toBeGreaterThan(40));
  it('Andromeda is almost overhead on 12 Oct', () => expect(at(A.istToUnix(2026, 10, 12, 23, 0), [10.68, 41.27]).alt).toBeGreaterThan(70));
  it('the Pleiades are up on her next birthday', () => expect(at(A.istToUnix(2027, 1, 18, 23, 30), [56.75, 24.12]).alt).toBeGreaterThan(35));
  it('16 Nov before dawn: Mars and Jupiter about 1.2 deg apart, high in the east, Moon down', () => {
    const ms = A.istToUnix(2026, 11, 16, 5, 0);
    const m = planet('mars', ms), j = planet('jupiter', ms);
    expect(sep(m.ra, m.dec, j.ra, j.dec)).toBeLessThan(1.5);
    expect(m.alt).toBeGreaterThan(50);
    expect(m.az).toBeLessThan(135);
    expect(A.skyState(ms, ...DELHI).moon.alt).toBeLessThan(0);
  });
  it('24 Dec midnight: the full Moon is almost overhead', () => {
    const s = A.skyState(A.istToUnix(2026, 12, 24, 0, 0), ...DELHI);
    expect(s.moon.illum).toBeGreaterThan(0.98);
    expect(s.moon.alt).toBeGreaterThan(80);
  });
  it('22 Oct 4 am: Orionid radiant is high and the Moon has set', () => {
    const ms = A.istToUnix(2026, 10, 22, 4, 0);
    expect(at(ms, [95, 16]).alt).toBeGreaterThan(60);
    expect(A.skyState(ms, ...DELHI).moon.alt).toBeLessThan(0);
  });
});

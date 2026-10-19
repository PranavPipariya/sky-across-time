// Section 11, astronomy acceptance checks (1-8).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as A from 'astronomy-engine';
import {
  istToUnix, julianDate, lst, equatorialToHorizon, moonPosition, planetPosition, skyState,
} from '../src/astro.js';

const DELHI = [28.61, 77.21];
const ROORKEE = [29.87, 77.89];
const cat = JSON.parse(readFileSync('public/stars.json', 'utf8'));
const star = (name) => {
  const n = cat.names.find((x) => x.name === name);
  return n.star !== undefined ? { ra: cat.stars[n.star][0], dec: cat.stars[n.star][1] } : n;
};
const where = (name, [lat, lon], ...t) => {
  const s = star(name);
  return equatorialToHorizon(s.ra, s.dec, lst(julianDate(istToUnix(...t)), lon), lat);
};
const azDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const near = (got, alt, az, tol = 1) => {
  expect(Math.abs(got.alt - alt)).toBeLessThan(tol);
  if (az !== undefined) expect(azDiff(got.az, az)).toBeLessThan(tol);
};

describe('star positions', () => {
  it('1. Sirius over Delhi, 18 Jan 2006 23:30', () => near(where('Sirius', DELHI, 2006, 1, 18, 23, 30), 44.5, 185));
  it('2. Arcturus and Regulus over Roorkee, 20 Apr 2004 22:00', () => {
    near(where('Arcturus', ROORKEE, 2004, 4, 20, 22, 0), 52.8, 97);
    near(where('Regulus', ROORKEE, 2004, 4, 20, 22, 0), 62.6, 234);
  });
  it('3. Pleiades rising over Delhi, 12 Oct 2026 23:00', () => {
    near(where('Pleiades', DELHI, 2026, 10, 12, 23, 0), 40, 81, 3);
  });
  it('4. Sirius over Delhi, 20 Oct 2026 03:00', () => near(where('Sirius', DELHI, 2026, 10, 20, 3, 0), 34, 140, 2));
});

describe('Moon', () => {
  it('5. about 5% lit and below the horizon on 12 Oct 2026 23:00', () => {
    const s = skyState(istToUnix(2026, 10, 12, 23, 0), ...DELHI);
    expect(s.moon.illum).toBeGreaterThan(0.01);
    expect(s.moon.illum).toBeLessThan(0.1);
    expect(s.moon.alt).toBeLessThan(0);
  });
  it('6. about 60% lit on 19 Oct 2026 23:00', () => {
    const m = moonPosition(julianDate(istToUnix(2026, 10, 19, 23, 0)));
    expect(Math.abs(m.illum - 0.6)).toBeLessThan(0.08);
  });
});

describe('planets', () => {
  const jd = julianDate(istToUnix(2026, 10, 12, 23, 0));
  it('7. Saturn and Jupiter on 12 Oct 2026', () => {
    const s = planetPosition('saturn', jd);
    expect(Math.abs(s.ra / 15 - 0.7)).toBeLessThan(0.15);
    expect(Math.abs(s.dec - 1.6)).toBeLessThan(1);
    expect(Math.abs(s.mag - 0.6)).toBeLessThan(0.4);
    const j = planetPosition('jupiter', jd);
    expect(Math.abs(j.ra / 15 - 9.6)).toBeLessThan(0.15);
    expect(Math.abs(j.dec - 15)).toBeLessThan(1);
    expect(Math.abs(j.mag + 1.9)).toBeLessThan(0.3);
  });
});

describe('8. cross-check against astronomy-engine', () => {
  const sep = (ra1, d1, ra2, d2) => {
    const r = Math.PI / 180;
    const c = Math.sin(d1 * r) * Math.sin(d2 * r) + Math.cos(d1 * r) * Math.cos(d2 * r) * Math.cos((ra1 - ra2) * r);
    return Math.acos(Math.min(1, c)) / r;
  };
  const times = [
    istToUnix(2026, 10, 12, 23, 0), istToUnix(2026, 10, 19, 23, 0),
    istToUnix(2005, 1, 18, 23, 30), istToUnix(2005, 4, 20, 22, 0), istToUnix(2027, 1, 18, 23, 30),
  ];
  for (const ms of times) {
    const jd = julianDate(ms);
    const date = new Date(ms);
    it(`agrees on ${date.toISOString()}`, () => {
      const obs = new A.Observer(DELHI[0], DELHI[1], 0);
      for (const [name, body] of [['jupiter', A.Body.Jupiter], ['saturn', A.Body.Saturn], ['mars', A.Body.Mars], ['venus', A.Body.Venus], ['mercury', A.Body.Mercury]]) {
        const ref = A.Equator(body, date, obs, false, true);
        const p = planetPosition(name, jd);
        expect(sep(p.ra, p.dec, ref.ra * 15, ref.dec), name).toBeLessThan(0.5);
      }
      const m = moonPosition(jd);
      const refM = A.EquatorFromVector(A.GeoMoon(date)); // geocentric, J2000 (Equator() with an observer is topocentric)
      expect(sep(m.ra, m.dec, refM.ra * 15, refM.dec), 'moon').toBeLessThan(0.5);
      const ill = A.Illumination(A.Body.Moon, date).phase_fraction;
      expect(Math.abs(m.illum - ill), 'moon phase').toBeLessThan(0.03);
    });
  }
});

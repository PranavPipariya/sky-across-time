// Section 5: pure astronomy, no dependencies. Angles in degrees unless noted.

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const atan2d = (y, x) => Math.atan2(y, x) / RAD;
const asind = (x) => Math.asin(Math.max(-1, Math.min(1, x))) / RAD;
export const wrap360 = (d) => ((d % 360) + 360) % 360;
const OBLIQUITY = 23.439;

// ---------- 5.1 Time ----------

/** Unix ms for a wall-clock time in IST (UTC+05:30), independent of device timezone. */
export function istToUnix(y, mo, d, h = 0, mi = 0) {
  return Date.UTC(y, mo - 1, d, h, mi) - 5.5 * 3600e3;
}

/** IST wall-clock parts for a unix time. */
export function unixToIst(ms) {
  const t = new Date(ms + 5.5 * 3600e3);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

export const julianDate = (ms) => ms / 86400000 + 2440587.5;

export const gmst = (jd) => wrap360(280.46061837 + 360.98564736629 * (jd - 2451545));

export const lst = (jd, lonEast) => wrap360(gmst(jd) + lonEast);

// ---------- 5.2 Equatorial -> horizon ----------

export function equatorialVector(ra, dec) {
  return [cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec)];
}

/** Row-major 3x3 mapping equatorial unit vectors to local (East, North, Up). */
export function horizonMatrix(lstDeg, lat) {
  const sL = sin(lstDeg), cL = cos(lstDeg), sP = sin(lat), cP = cos(lat);
  return [
    -sL, cL, 0,
    -sP * cL, -sP * sL, cP,
    cP * cL, cP * sL, sP,
  ];
}

export function applyMatrix(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** ENU vector -> { alt, az } with az 0 = north, 90 = east. */
export function vecToAltAz(p) {
  return { alt: asind(p[2]), az: wrap360(atan2d(p[0], p[1])) };
}

export function altAzToVec(alt, az) {
  return [cos(alt) * sin(az), cos(alt) * cos(az), sin(alt)];
}

export function equatorialToHorizon(ra, dec, lstDeg, lat) {
  return vecToAltAz(applyMatrix(horizonMatrix(lstDeg, lat), equatorialVector(ra, dec)));
}

function eclipticToEquatorial(lam, beta) {
  const x = cos(beta) * cos(lam);
  const y = cos(beta) * sin(lam) * cos(OBLIQUITY) - sin(beta) * sin(OBLIQUITY);
  const z = cos(beta) * sin(lam) * sin(OBLIQUITY) + sin(beta) * cos(OBLIQUITY);
  return { ra: wrap360(atan2d(y, x)), dec: asind(z) };
}

// ---------- 5.3 Sun ----------

export function sunPosition(jd) {
  const n = jd - 2451545;
  const L = 280.46 + 0.9856474 * n;
  const g = 357.528 + 0.9856003 * n;
  const lambda = wrap360(L + 1.915 * sin(g) + 0.02 * sin(2 * g) - 1.3969 * (n / 36525));
  return { lambda, ...eclipticToEquatorial(lambda, 0) };
}

// ---------- 5.4 Moon ----------

export function moonPosition(jd) {
  const d = jd - 2451545;
  const L = 218.316 + 13.176396 * d;
  const Mm = 134.963 + 13.064993 * d;
  const F = 93.272 + 13.22935 * d;
  const D = 297.85 + 12.190749 * d;
  const Ms = 357.529 + 0.98560028 * d;
  // Section 5.4 terms, plus the next largest ones (Meeus ch. 47) to stay within ~0.3 deg.
  // Minus general precession so the result is J2000, matching the star catalogue.
  const lambda = wrap360(
    L + 6.289 * sin(Mm) + 1.274 * sin(2 * D - Mm) + 0.658 * sin(2 * D) +
      0.214 * sin(2 * Mm) - 0.186 * sin(Ms) - 0.114 * sin(2 * F) -
      0.059 * sin(2 * Mm - 2 * D) - 0.057 * sin(Mm - 2 * D + Ms) + 0.053 * sin(Mm + 2 * D) +
      0.046 * sin(2 * D - Ms) + 0.041 * sin(Mm - Ms) - 0.035 * sin(D) - 0.031 * sin(Mm + Ms) -
      0.015 * sin(2 * F - 2 * D) + 0.011 * sin(Mm - 4 * D) -
      1.3969 * (d / 36525)
  );
  const beta = 5.128 * sin(F) + 0.281 * sin(Mm + F) + 0.278 * sin(Mm - F) +
    0.173 * sin(2 * D - F) + 0.055 * sin(2 * D + F - Mm) + 0.046 * sin(2 * D - F - Mm) +
    0.033 * sin(F + 2 * D) + 0.017 * sin(2 * Mm + F);
  const sun = sunPosition(jd);
  const cosPsi = cos(beta) * cos(lambda - sun.lambda);
  const illum = (1 - cosPsi) / 2;
  return { lambda, beta, illum, ...eclipticToEquatorial(lambda, beta) };
}

/** Topocentric correction: lowers the Moon by horizontal parallax times cos(alt). */
export function moonTopocentric(altAz) {
  return { alt: altAz.alt - 0.95 * cos(altAz.alt), az: altAz.az };
}

// ---------- 5.5 Planets ----------

// [a, e, I, L, varpi, Omega] at J2000 and rates per Julian century (JPL, 1800-2050)
const ELEMENTS = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
            [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
          [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
          [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
         [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
            [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
           [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
};

const MAG = {
  mercury: (i) => -0.6 + 0.038 * i,
  venus: (i) => -4.4 + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i * i * i,
  mars: (i) => -1.5 + 0.016 * i,
  jupiter: (i) => -9.4 + 0.005 * i,
  saturn: (i) => -8.9 + 0.044 * i,
};

export const PLANETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];

function heliocentric(name, T) {
  const [e0, r] = ELEMENTS[name];
  const [a, e, I, L, varpi, Omega] = e0.map((v, k) => v + r[k] * T);
  const omega = varpi - Omega;
  let M = wrap360(L - varpi);
  if (M > 180) M -= 360;
  // Kepler's equation, E in degrees
  const eStar = e / RAD;
  let E = M + eStar * sin(M);
  for (let k = 0; k < 10; k++) {
    const dM = M - (E - eStar * sin(E));
    const dE = dM / (1 - e * cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  const xp = a * (cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * sin(E);
  const co = cos(omega), so = sin(omega), cO = cos(Omega), sO = sin(Omega), cI = cos(I), sI = sin(I);
  return [
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    so * sI * xp + co * sI * yp,
  ];
}

export function planetPosition(name, jd) {
  const T = (jd - 2451545) / 36525;
  const p = heliocentric(name, T);
  const earth = heliocentric('earth', T);
  const g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
  const ce = cos(OBLIQUITY), se = sin(OBLIQUITY);
  const eq = [g[0], g[1] * ce - g[2] * se, g[1] * se + g[2] * ce];
  const delta = Math.hypot(...eq);
  const rr = Math.hypot(...p);
  const R = Math.hypot(...earth);
  const i = Math.acos(Math.max(-1, Math.min(1, (rr * rr + delta * delta - R * R) / (2 * rr * delta)))) / RAD;
  return {
    ra: wrap360(atan2d(eq[1], eq[0])),
    dec: asind(eq[2] / delta),
    mag: MAG[name](i) + 5 * Math.log10(rr * delta),
    distance: delta,
  };
}

// ---------- Convenience ----------

/** Everything needed to draw one moment from one place. */
export function skyState(ms, lat, lon) {
  const jd = julianDate(ms);
  const L = lst(jd, lon);
  const m = horizonMatrix(L, lat);
  const sun = sunPosition(jd);
  const sunAltAz = vecToAltAz(applyMatrix(m, equatorialVector(sun.ra, sun.dec)));
  const moon = moonPosition(jd);
  const moonAltAz = moonTopocentric(vecToAltAz(applyMatrix(m, equatorialVector(moon.ra, moon.dec))));
  const planets = PLANETS.map((name) => {
    const p = planetPosition(name, jd);
    return { name, ...p, ...vecToAltAz(applyMatrix(m, equatorialVector(p.ra, p.dec))) };
  });
  return { jd, lst: L, sun: { ...sun, ...sunAltAz }, moon: { ...moon, ...moonAltAz }, planets };
}

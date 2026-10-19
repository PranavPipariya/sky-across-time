// Builds public/stars.json from d3-celestial's stars.6.json (section 4.3)
// and attaches the tap-able names with distances (section 4.4).
import { readFileSync, writeFileSync } from 'node:fs';

const dir = 'node_modules/d3-celestial/data/';
const stars = JSON.parse(readFileSync(dir + 'stars.6.json', 'utf8')).features;
const names = JSON.parse(readFileSync(dir + 'starnames.json', 'utf8'));

const LY = {
  Sirius: 8.6, Canopus: 310, Arcturus: 36.7, Vega: 25, Capella: 43, Rigel: 860, Procyon: 11.5,
  Betelgeuse: 550, Altair: 16.7, Aldebaran: 65, Spica: 250, Antares: 550, Pollux: 34,
  Fomalhaut: 25, Deneb: 2600, Regulus: 79, Castor: 51, Polaris: 433, Bellatrix: 250,
  Achernar: 139, Hamal: 66, Alpheratz: 97, Mirfak: 510, Dubhe: 123, Alkaid: 104, Denebola: 36,
  Algol: 90, Mizar: 83, Diphda: 96, Shaula: 570, Alnilam: 2000, Mirach: 197, Almach: 350,
};

// Fainter members of the clusters the story zooms into (Beehive, Pleiades), so they read
// as clusters in a binocular-like zoom. The NASA photo layer has these stars removed.
const CLUSTERS = [[130.1, 19.67], [56.75, 24.12]];
const near = ([ra, dec], [cr, cd], r) => {
  const k = Math.PI / 180;
  return Math.acos(Math.sin(dec * k) * Math.sin(cd * k) + Math.cos(dec * k) * Math.cos(cd * k) * Math.cos((ra - cr) * k)) / k < r;
};
const faint = JSON.parse(readFileSync(dir + 'stars.8.json', 'utf8')).features
  .filter((f) => f.properties.mag > 6.5 && CLUSTERS.some((c) => near(f.geometry.coordinates.map((x, i) => (i === 0 && x < 0 ? x + 360 : x)), c, 1.6)));

const rows = [...stars.filter((f) => f.properties.mag <= 6.5), ...faint]
  .map((f) => {
    let [ra, dec] = f.geometry.coordinates;
    if (ra < 0) ra += 360;
    const bv = parseFloat(f.properties.bv);
    return { id: f.id, ra: +ra.toFixed(4), dec: +dec.toFixed(4), mag: f.properties.mag, bv: isNaN(bv) ? 0.6 : bv };
  })
  .sort((a, b) => a.mag - b.mag);

const named = [];
rows.forEach((s, i) => {
  const n = names[s.id]?.name;
  if (n && LY[n] !== undefined && !named.find((x) => x.name === n)) named.push({ name: n, ly: LY[n], star: i });
});
// Pleiades: a cluster, not a single catalogue star. Centre of the cluster.
named.push({ name: 'Pleiades', ly: 444, ra: 56.75, dec: 24.12, sub: 'Star cluster' });

const missing = Object.keys(LY).filter((n) => !named.find((x) => x.name === n));
if (missing.length) console.warn('Missing names:', missing.join(', '));

writeFileSync(
  'public/stars.json',
  JSON.stringify({ stars: rows.map((s) => [s.ra, s.dec, s.mag, +s.bv.toFixed(2)]), names: named })
);
console.log(`wrote ${rows.length} stars, ${named.length} names`);

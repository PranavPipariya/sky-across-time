// Sections 6.4-6.5: bright stars and planets as point sprites with a soft PSF.
import { program } from './gl.js';
import { equatorialVector } from '../astro.js';

const VERT = `#version 300 es
precision highp float;
in vec3 aDir;      // equatorial unit vector
in float aMag;
in vec3 aColor;
in vec2 aTw;       // twinkle rate, phase (rate 0 = no twinkle)
uniform mat3 uMt;  // uploaded row-major, so v * uMt = M v
uniform vec3 uF, uR, uU;
uniform vec2 uCenter, uRes;
uniform float uS, uDpr, uLim, uHaze, uTime, uZoom, uAlpha, uPlanet;
out vec3 vColor;
out float vCore;   // core sigma, px
out float vHalo;   // halo strength
out float vSize;
void main() {
  vec3 p = aDir * uMt;
  float d = dot(p, uF);
  // extinction works in magnitudes: a star low in hazy air looks fainter, not just dimmer
  float up = max(p.z, 0.0);
  float airmass = 1.0 / max(0.06, up);
  float mag = aMag + 0.25 * (airmass - 1.0) * (1.0 + uHaze);
  float a = clamp((uLim - mag + 0.4) / 1.8, 0.0, 1.0);
  if (p.z < 0.0 || d < -0.6 || a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float k = 2.0 / (1.0 + d);
  vec2 s = uCenter + vec2(k * dot(p, uR), k * dot(p, uU)) * uS;
  gl_Position = vec4(s / uRes * 2.0 - 1.0, 0.0, 1.0);

  float tw = aTw.x > 0.0 ? 1.0 + (0.06 + 0.25 * (1.0 - up)) * sin(uTime * aTw.x + aTw.y) : 1.0;
  float bright = a * tw * uAlpha;

  float core = max(0.55, (5.2 - mag) * 0.38) * 1.25 * uZoom * (1.0 + 0.15 * uPlanet);
  float halo = mag < 2.2 ? min(1.0, (2.2 - mag) / 3.0) * a : 0.0;
  vCore = core * uDpr;
  vHalo = halo;
  vColor = aColor * bright;
  float extent = halo > 0.0 ? vCore * 7.0 : vCore * 3.2;
  vSize = max(2.0, extent * 2.0);
  gl_PointSize = vSize;
}
`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vCore;
in float vHalo;
in float vSize;
out vec4 fragColor;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * vSize;
  float r2 = dot(q, q);
  float sig = max(vCore * 0.62, 0.6);
  // brighter stars over-expose the core a little, like a camera does
  float core = exp(-r2 / (2.0 * sig * sig)) * (1.0 + 1.6 * vHalo);
  float r = sqrt(r2) / max(vCore, 0.5);
  float halo = vHalo * (0.22 * exp(-r * 1.1) + 0.05 * exp(-r * 0.45)) * (1.0 - smoothstep(4.5, 7.0, r));
  vec3 c = vColor * (core + halo);
  fragColor = vec4(c, 1.0);
}
`;

// B-V colour table (section 6.4), sRGB 0..1
const BV = [
  [-0.3, [0xaa, 0xc3, 0xff]], [0.0, [0xd4, 0xe0, 0xff]], [0.4, [0xfa, 0xf8, 0xf2]],
  [0.8, [0xff, 0xee, 0xd4]], [1.2, [0xff, 0xda, 0xb2]], [1.8, [0xff, 0xc0, 0x91]],
];
export function bvColor(bv) {
  if (bv <= BV[0][0]) return BV[0][1].map((c) => c / 255);
  for (let i = 1; i < BV.length; i++) {
    if (bv <= BV[i][0]) {
      const t = (bv - BV[i - 1][0]) / (BV[i][0] - BV[i - 1][0]);
      return BV[i][1].map((c, k) => (BV[i - 1][1][k] + (c - BV[i - 1][1][k]) * t) / 255);
    }
  }
  return BV[BV.length - 1][1].map((c) => c / 255);
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
export const PLANET_COLORS = {
  mercury: hex('#e9e2d6'), venus: hex('#fffaf0'), mars: hex('#ffb08a'), jupiter: hex('#fff3dc'), saturn: hex('#f4e3b8'),
};

export function createStars(ctx, catalogue) {
  const { gl } = ctx;
  const prog = program(ctx, VERT, FRAG);
  const STRIDE = 9;

  const n = catalogue.length;
  const data = new Float32Array(n * STRIDE);
  catalogue.forEach(([ra, dec, mag, bv], i) => {
    const v = equatorialVector(ra, dec);
    const c = bvColor(bv);
    // seeded by index so twinkle is stable between visits
    const rate = 1.3 + ((i * 0.6180339) % 1) * 2.4;
    const phase = ((i * 0.7548776) % 1) * 6.283;
    data.set([...v, mag, ...c, rate, phase], i * STRIDE);
  });
  const starBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  const planetBuf = gl.createBuffer();
  const planetData = new Float32Array(5 * STRIDE);

  function bind(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const F = 4 * STRIDE;
    const a = prog.a;
    gl.enableVertexAttribArray(a.aDir); gl.vertexAttribPointer(a.aDir, 3, gl.FLOAT, false, F, 0);
    gl.enableVertexAttribArray(a.aMag); gl.vertexAttribPointer(a.aMag, 1, gl.FLOAT, false, F, 12);
    gl.enableVertexAttribArray(a.aColor); gl.vertexAttribPointer(a.aColor, 3, gl.FLOAT, false, F, 16);
    gl.enableVertexAttribArray(a.aTw); gl.vertexAttribPointer(a.aTw, 2, gl.FLOAT, false, F, 28);
  }

  function setCommon(v, place) {
    const u = prog.u;
    gl.useProgram(prog.p);
    gl.uniformMatrix3fv(u.uMt, false, v.M);
    gl.uniform3fv(u.uF, v.f); gl.uniform3fv(u.uR, v.r); gl.uniform3fv(u.uU, v.u);
    gl.uniform2f(u.uCenter, v.cx, v.cy); gl.uniform2f(u.uRes, v.W, v.H);
    gl.uniform1f(u.uS, v.S); gl.uniform1f(u.uDpr, v.dpr); gl.uniform1f(u.uTime, v.time);
    gl.uniform1f(u.uZoom, v.zoom);
    gl.uniform1f(u.uLim, place.lim); gl.uniform1f(u.uHaze, place.haze);
  }

  return {
    /** v: view (camera, matrix), place: { lim, haze }, planets: [{ name, ra, dec, mag }], bodyAlpha */
    draw(v, place, planets, bodyAlpha) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      setCommon(v, place);
      gl.uniform1f(prog.u.uAlpha, v.fade);
      gl.uniform1f(prog.u.uPlanet, 0);
      bind(starBuf);
      gl.drawArrays(gl.POINTS, 0, n);

      if (bodyAlpha > 0.001) {
        planets.forEach((p, i) => {
          planetData.set([...equatorialVector(p.ra, p.dec), p.mag, ...PLANET_COLORS[p.name], 0, 0], i * STRIDE);
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, planetBuf);
        gl.bufferData(gl.ARRAY_BUFFER, planetData, gl.DYNAMIC_DRAW);
        gl.uniform1f(prog.u.uAlpha, bodyAlpha * v.fade);
        gl.uniform1f(prog.u.uPlanet, 1);
        bind(planetBuf);
        gl.drawArrays(gl.POINTS, 0, planets.length);
      }
      gl.disable(gl.BLEND);
    },
  };
}

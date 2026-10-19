// Section 6.6: the Moon, with correct phase and orientation, texture, earthshine and halo.
import { program, blankTexture, textureFromImage, loadImage } from './gl.js';

const VERT = `#version 300 es
precision highp float;
in vec2 aPos;          // -1..1 quad
uniform vec2 uPos;     // centre, device px (GL y-up)
uniform float uExtent; // half-size of the quad, px
uniform vec2 uRes;
out vec2 vQ;
void main() {
  vQ = aPos * uExtent;
  gl_Position = vec4((uPos + vQ) / uRes * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vQ;
uniform float uRadius;  // px
uniform vec2 uNorth;    // screen unit vector to celestial north
uniform vec2 uSun;      // screen unit vector towards the Sun
uniform float uCosI;    // cos(phase angle)
uniform float uIllum;
uniform float uAlpha;
uniform float uHasTex;
uniform sampler2D uTex;
out vec4 fragColor;
void main() {
  float r = length(vQ) / uRadius;
  // halo: scales with illuminated fraction
  float halo = uIllum * (0.22 * exp(-(r - 1.0) * 1.6) + 0.06 * exp(-(r - 1.0) * 0.35)) * step(1.0, r);
  vec3 col = vec3(0.85, 0.88, 0.95) * halo * 0.5;
  float edge = 1.0 - smoothstep(1.0 - 1.2 / uRadius, 1.0 + 1.2 / uRadius, r);
  if (edge > 0.0) {
    vec2 q = vQ / uRadius;
    vec2 east = vec2(uNorth.y, -uNorth.x); // screen right when north is up = sky west = lunar east
    float a = dot(q, east), b = dot(q, uNorth);
    float c = sqrt(max(0.0, 1.0 - a * a - b * b));
    vec2 s2 = vec2(dot(uSun, east), dot(uSun, uNorth));
    float sinI = sqrt(max(0.0, 1.0 - uCosI * uCosI));
    vec3 L = vec3(s2 * sinI, uCosI);
    float lit = smoothstep(-0.04, 0.06, dot(vec3(a, b, c), L));
    vec3 albedo = mix(vec3(0.984, 0.973, 0.941), vec3(0.851, 0.831, 0.776), r * r);
    if (uHasTex > 0.5) {
      float lat = asin(clamp(b, -1.0, 1.0));
      float lon = atan(a, c);
      vec3 t = texture(uTex, vec2(0.5 + lon / 6.2831853, 0.5 - lat / 3.14159265)).rgb;
      float lum = dot(t, vec3(0.3, 0.55, 0.15));
      albedo *= 0.55 + 0.75 * lum;
    }
    // limb darkening, slight
    albedo *= 0.88 + 0.12 * c;
    vec3 earthshine = vec3(0.55, 0.6, 0.7) * 0.15 * (0.4 + 0.6 * dot(albedo, vec3(0.33)));
    col = mix(col, albedo * lit + earthshine * (1.0 - lit) * (1.0 - uIllum), edge);
  }
  fragColor = vec4(col * uAlpha, 1.0);
}
`;

export function createMoon(ctx) {
  const { gl } = ctx;
  const prog = program(ctx, VERT, FRAG);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  let tex = blankTexture(ctx);
  let hasTex = false;
  loadImage('moon.jpg').then((img) => { tex = textureFromImage(ctx, img); hasTex = true; }).catch(() => {});

  return {
    /** m: { x, y (GL px), radius, north:[x,y], sun:[x,y], cosI, illum, alpha } */
    draw(v, m) {
      if (!m || m.alpha <= 0.001) return;
      gl.useProgram(prog.p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const u = prog.u;
      gl.uniform2f(u.uPos, m.x, m.y);
      gl.uniform1f(u.uExtent, m.radius * 4 + 40 * v.dpr);
      gl.uniform2f(u.uRes, v.W, v.H);
      gl.uniform1f(u.uRadius, m.radius);
      gl.uniform2fv(u.uNorth, m.north);
      gl.uniform2fv(u.uSun, m.sun);
      gl.uniform1f(u.uCosI, m.cosI);
      gl.uniform1f(u.uIllum, m.illum);
      gl.uniform1f(u.uAlpha, m.alpha * v.fade);
      gl.uniform1f(u.uHasTex, hasTex ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u.uTex, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(prog.a.aPos);
      gl.vertexAttribPointer(prog.a.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    },
  };
}

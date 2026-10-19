// Shared by the sky and horizon passes: inverse stereographic projection (section 6.2).
uniform vec2 uCenter;   // projection centre, device px, GL convention (y up)
uniform float uS;       // px per projection unit
uniform vec3 uF;        // camera forward (E,N,U)
uniform vec3 uR;        // camera right
uniform vec3 uU;        // camera up
uniform vec3 uSkyglow;  // haze * rgb(0.30, 0.17, 0.09)
uniform float uHaze;

vec3 pixelDir() {
  float X = (gl_FragCoord.x - uCenter.x) / uS;
  float Y = (gl_FragCoord.y - uCenter.y) / uS;
  float s = X * X + Y * Y;
  float k = 1.0 / (4.0 + s);
  return normalize(4.0 * X * k * uR + 4.0 * Y * k * uU + (4.0 - s) * k * uF);
}

float hash11(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453123); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 encodeSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

// Section 6.3: night sky background, skyglow, Milky Way photo, moonlight, twilight.
uniform mat3 uMt;          // ENU -> equatorial (transpose of the 5.2 matrix)
uniform sampler2D uTile0;  // u 0..0.5
uniform sampler2D uTile1;  // u 0.5..1
uniform sampler2D uPreview;
uniform float uTiled;
uniform float uMw;         // Milky Way strength
uniform float uNight;
uniform float uDay;
uniform float uMoonGlow;
uniform vec3 uMoonDir;
uniform float uFade;       // global fade, for reduced motion
uniform float uSeed;
// A real survey photograph of one small patch (the Beehive), gnomonic, north up, east left.
uniform sampler2D uPatch;
uniform vec3 uPatchC, uPatchE, uPatchN; // centre and tangent basis, equatorial
uniform float uPatchT;                   // tan(half width)
uniform float uPatchA;                   // fades in as she zooms
uniform float uZoomDark;                 // magnification spreads skyglow thin: background darkens

const float PI = 3.14159265359;

vec3 decode(vec3 c) { return c * c * (0.3 + 0.7 * c); } // ~ sRGB -> linear, cheap

vec3 milkyWay(vec3 p) {
  vec3 q = uMt * p;
  float ra = atan(q.y, q.x);                       // radians
  float dec = asin(clamp(q.z, -1.0, 1.0));
  float u = fract(0.5 - ra / (2.0 * PI));
  float v = (0.5 * PI - dec) / PI;
  // Derivatives that ignore the wrap at RA 0h, so mip selection doesn't seam there.
  float uAlt = fract(u + 0.5);
  vec2 dx = vec2(dFdx(u), dFdx(v));
  vec2 dy = vec2(dFdy(u), dFdy(v));
  float dxa = dFdx(uAlt), dya = dFdy(uAlt);
  if (abs(dxa) < abs(dx.x)) dx.x = dxa;
  if (abs(dya) < abs(dy.x)) dy.x = dya;
  vec3 c;
  if (uTiled > 0.5) {
    vec2 g = vec2(2.0, 1.0);
    if (u < 0.5) c = textureGrad(uTile0, vec2(u * 2.0, v), dx * g, dy * g).rgb;
    else c = textureGrad(uTile1, vec2(u * 2.0 - 1.0, v), dx * g, dy * g).rgb;
  } else {
    c = textureGrad(uPreview, vec2(u, v), dx, dy).rgb;
  }
  return decode(c);
}

void main() {
  vec3 p = pixelDir();
  float a = clamp(p.z, 0.0, 1.0);
  float t = pow(1.0 - a, 4.0);
  vec3 col = mix(vec3(0.006, 0.009, 0.022), vec3(0.028, 0.036, 0.066), t);
  col += uSkyglow * (0.55 * exp(-7.0 * a) + 0.10 * exp(-1.5 * a) + 0.03);

  float altDeg = degrees(asin(clamp(p.z, -1.0, 1.0)));
  col += milkyWay(p) * uMw * uNight * smoothstep(0.0, 0.35, altDeg) * (1.0 - 0.85 * uMoonGlow);

  col *= 1.0 - uZoomDark;
  if (uPatchA > 0.001) {
    vec3 q = uMt * p;
    float d = dot(q, uPatchC);
    if (d > 0.9) {
      vec2 g = vec2(dot(q, uPatchE), dot(q, uPatchN)) / d / uPatchT; // -1..1 across the photo
      vec2 uv = vec2(0.5 - 0.5 * g.x, 0.5 - 0.5 * g.y);
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        float edge = 1.0 - smoothstep(0.7, 1.0, length(g));
        float k = uPatchA * edge * smoothstep(0.0, 8.0, altDeg);
        vec3 ph = texture(uPatch, uv).rgb;
        col += ph * ph * 1.15 * k;
      }
    }
  }

  col += uMoonGlow * (vec3(0.05, 0.075, 0.12) * 0.45 * (0.6 + 0.4 * t) + vec3(0.10, 0.12, 0.15) * pow(max(dot(p, uMoonDir), 0.0), 40.0));

  vec3 day = mix(vec3(0.16, 0.36, 0.70), vec3(0.62, 0.76, 0.90), t);
  col = mix(col, day, uDay);

  if (p.z < 0.0) col = vec3(0.006, 0.007, 0.010) + uSkyglow * 0.05;

  vec3 o = encodeSRGB(col * uFade);
  o += (hash21(gl_FragCoord.xy + uSeed) - 0.5) / 255.0;
  fragColor = vec4(o, 1.0);
}

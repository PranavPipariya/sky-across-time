// Section 6.7 (revised): a clean horizon. The ground is a smooth arc with a thin, softly
// glowing edge, warm under Delhi's skyglow and cool under Roorkee's darker sky.
uniform float uTree;    // 0 = Delhi look, 1 = Roorkee look (cross-fades)
uniform float uFade;

void main() {
  vec3 p = pixelDir();
  float alt = degrees(asin(clamp(p.z, -1.0, 1.0)));
  float px = max(fwidth(alt), 1e-4); // degrees per pixel

  // ground coverage, antialiased
  float cov = 1.0 - smoothstep(-0.5 * px, 0.5 * px, alt);

  // the edge: a crisp 1px line plus a soft bloom just above and below it
  vec3 edgeCol = mix(vec3(1.0, 0.72, 0.48), vec3(0.62, 0.72, 0.95), uTree);
  float line = exp(-pow(alt / (0.9 * px), 2.0));
  float bloom = exp(-abs(alt) / (3.0 * px)) * 0.25 + exp(-abs(alt) / 0.8) * 0.02;
  float edgeA = (0.16 + 0.08 * uHaze) * line + bloom * (0.12 + 0.1 * uHaze);

  vec3 fill = vec3(0.004, 0.005, 0.009) + uSkyglow * 0.035;
  // ground gets very slightly lighter towards the edge, like distant land catching glow
  fill += uSkyglow * 0.05 * exp(alt / 2.5);

  vec3 col = mix(vec3(0.0), fill, cov) + edgeCol * edgeA * 0.22;
  if (cov <= 0.0 && edgeA < 0.002) discard;
  // premultiplied: the ground occludes (alpha = coverage), the edge glow just adds light
  fragColor = vec4(encodeSRGB(col * uFade), cov);
}

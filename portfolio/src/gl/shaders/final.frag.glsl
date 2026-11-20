// Final grade: subtle chromatic aberration → ACES → sRGB → background glow,
// vignette and film grain (in display space so the page colour matches CSS).
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime;
uniform float uGrain;
uniform float uExposure;

varying vec2 vUv;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  vec2 off = d * r2 * 0.016;
  vec3 col = vec3(
    texture2D(tDiffuse, uv + off).r,
    texture2D(tDiffuse, uv).g,
    texture2D(tDiffuse, uv - off).b
  );
  col = toSRGB(aces(col * uExposure));

  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec3 bg = vec3(0.027, 0.031, 0.043);
  vec2 g1 = (uv - vec2(0.84, 0.88)) * asp;
  vec2 g2 = (uv - vec2(0.08, 0.06)) * asp;
  bg += vec3(1.0, 0.42, 0.17) * 0.04 * exp(-dot(g1, g1) * 2.4);
  bg += vec3(0.56, 0.82, 1.0) * 0.025 * exp(-dot(g2, g2) * 2.2);
  col = bg + col * (1.0 - bg);

  col *= 1.0 - smoothstep(0.38, 1.3, length(d * asp)) * 0.42;
  col += (hash(uv * uRes + fract(uTime * 7.13) * 91.7) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}

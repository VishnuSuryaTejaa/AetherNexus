#version 300 es
// Final grade: scene + bloom → ACES → sRGB → background glow, vignette and
// film grain (in display space so the page colour matches the CSS).
precision highp float;

uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uGrain;
uniform float uExposure;

in vec2 vUv;
out vec4 fragColor;

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
  vec3 col = texture(tScene, vUv).rgb;
  if (uBloom > 0.0) col += texture(tBloom, vUv).rgb * uBloom;
  col = toSRGB(aces(col * uExposure));

  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 d = vUv - 0.5;
  vec3 bg = vec3(0.0196, 0.0275, 0.051);
  vec2 g1 = (vUv - vec2(0.84, 0.88)) * asp;
  vec2 g2 = (vUv - vec2(0.08, 0.06)) * asp;
  bg += vec3(0.55, 0.42, 1.0) * 0.045 * exp(-dot(g1, g1) * 2.4);
  bg += vec3(0.36, 0.62, 1.0) * 0.03 * exp(-dot(g2, g2) * 2.2);
  col = bg + col * (1.0 - bg);

  col *= 1.0 - smoothstep(0.38, 1.3, length(d * asp)) * 0.42;
  col += (hash(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5) * uGrain;
  fragColor = vec4(col, 1.0);
}

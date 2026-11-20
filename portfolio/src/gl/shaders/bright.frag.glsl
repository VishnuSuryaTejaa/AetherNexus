#version 300 es
// Bloom step 1: 4-tap box downsample to quarter resolution + soft threshold.
precision mediump float;

uniform sampler2D tSrc;
uniform vec2 uTexel; // 1 / source size
uniform float uThreshold;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec3 c = texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  c *= smoothstep(uThreshold, uThreshold + 0.45, l);
  fragColor = vec4(c, 1.0);
}

#version 300 es
// Bloom step 2: separable 9-tap Gaussian using linear sampling (5 fetches).
precision mediump float;

uniform sampler2D tSrc;
uniform vec2 uDir; // texel size × direction × spread

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec3 c = texture(tSrc, vUv).rgb * 0.2270270270;
  c += texture(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  fragColor = vec4(c, 1.0);
}

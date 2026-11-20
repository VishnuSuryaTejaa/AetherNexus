#version 300 es
// Ambient nano dust: infinite field with depth-based scroll parallax.
precision highp float;

uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uScroll;
uniform float uPixelRatio;
uniform float uCamZ;
uniform float uTanHalf;
uniform float uAspect;
uniform float uMotion;
uniform float uFade;
uniform vec3 uIce;
uniform vec3 uAccent;

layout(location = 0) in vec3 aN; // xy normalised to the frustum, z = world depth
layout(location = 1) in vec4 aSeed; // x: size, y: twinkle speed, z: warm flag, w: phase

out vec3 vColor;
out float vAlpha;

void main() {
  float depth = clamp((aN.z + 8.0) / 12.0, 0.0, 1.0);
  float hh = (uCamZ - aN.z) * uTanHalf;
  float hw = hh * uAspect;
  float ny = aN.y + uScroll * (0.36 + depth * 1.0);
  ny = mod(ny + 1.15, 2.3) - 1.15;
  float drift = uTime * uMotion;
  vec3 p = vec3(
    aN.x * hw + sin(drift * 0.11 + aSeed.w * 6.2831) * 0.3,
    ny * hh + cos(drift * 0.09 + aSeed.w * 4.0) * 0.2,
    aN.z
  );
  vec4 mv = uView * vec4(p, 1.0);
  gl_Position = uProj * mv;
  float ps = (0.9 + aSeed.x * 2.0) * uPixelRatio * (uCamZ / -mv.z);
  gl_PointSize = max(ps, 1.0);
  float tw = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed.y * 1.4) * uMotion + aSeed.w * 6.2831);
  vAlpha = (0.2 + 0.8 * depth) * tw * 0.55 * uFade * clamp(ps / 1.2, 0.3, 1.0);
  vColor = aSeed.z > 0.82 ? uAccent : mix(uIce, vec3(1.0), 0.35);
}

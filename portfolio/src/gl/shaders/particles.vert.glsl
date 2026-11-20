// Nano-particle morph — every transition is a diffusion step:
//   x = mix(A, B, ease(t_i)) + sigma(t) * eps_i
uniform float uTime;
uniform float uMorph;
uniform float uSigma;
uniform float uPixelRatio;
uniform float uCamZ;
uniform float uSizes[5];
uniform float uGains[5];
uniform vec3 uOff[5];
uniform float uScl[5];
uniform mat3 uRot[5];
uniform sampler2D uTouch;
uniform vec2 uPointer;
uniform float uTouchAmt;
uniform float uMotion;
uniform float uFade;
uniform vec3 uPal[4];

attribute vec3 aP1;
attribute vec3 aP2;
attribute vec3 aP3;
attribute vec3 aP4;
attribute vec4 aColor;
attribute vec4 aTone;
attribute vec4 aRand;
attribute vec3 aEps;

varying vec3 vColor;
varying float vAlpha;

const float PI = 3.141592653589793;

vec3 palette(float t) {
  vec3 c = mix(uPal[0], uPal[1], smoothstep(0.0, 0.34, t));
  c = mix(c, uPal[2], smoothstep(0.34, 0.68, t));
  return mix(c, uPal[3], smoothstep(0.68, 1.0, t));
}

// Bridge particles flow from the research nebula to the production lattice
float bridgeS(vec3 p) {
  return fract(p.x + uTime * 0.045 * uMotion);
}

vec3 bridge(vec3 p) {
  float s = bridgeS(p);
  float env = sin(s * PI);
  float x = mix(-0.66, 0.66, s);
  float y = p.z * env * 0.85 + sin(s * 9.0 + p.y + uTime * 0.8 * uMotion) * 0.035 * env;
  float z = cos(s * 7.0 + p.y) * 0.16 * env;
  return vec3(x, y, z);
}

vec3 rawPos(int i) {
  if (i == 0) return position; // portrait (formation 0) doubles as `position`
  if (i == 1) return aRand.w > 0.5 ? bridge(aP1) : aP1;
  if (i == 2) return aP2;
  if (i == 3) return aP3;
  return aP4;
}

vec3 baseColor(int i) {
  if (i == 0) return aColor.rgb;
  if (i == 1) return aRand.w > 0.5 ? palette(mix(0.3, 0.98, bridgeS(aP1))) : palette(aTone.x);
  if (i == 2) return palette(aTone.y);
  if (i == 3) return palette(aTone.z);
  return palette(aTone.w);
}

float baseBright(int i) {
  if (i == 0) return aColor.a;
  return 0.45 + 0.55 * aRand.y;
}

float baseSize(int i) {
  if (i == 0) return mix(0.42, 1.0, aColor.a);
  return 0.55 + 0.9 * aRand.y * aRand.y;
}

void main() {
  float m = clamp(uMorph, 0.0, 4.0);
  int a = int(min(floor(m), 3.0));
  int b = a + 1;
  float t = m - float(a);
  float d = aRand.x * 0.42;
  float st = smoothstep(d, d + 0.58, t);
  float e = st * st * (3.0 - 2.0 * st);

  float ph = aRand.z * 6.2831853;
  vec3 jit = vec3(sin(uTime * 1.9 + ph), sin(uTime * 1.45 + ph * 1.7), cos(uTime * 1.2 + ph * 2.3));
  vec3 eps = aEps + jit * 0.4 * uMotion;
  float sigma = uSigma + sin(st * PI) * 0.6 * uMotion;

  vec3 breathe = vec3(sin(uTime * 0.7 + ph), cos(uTime * 0.6 + ph * 1.3), sin(uTime * 0.5 + ph * 0.7)) * 0.006 * uMotion;
  vec3 pa = rawPos(a) + eps * sigma + breathe;
  vec3 pb = rawPos(b) + eps * sigma + breathe;
  vec3 wa = uRot[a] * pa * uScl[a] + uOff[a];
  vec3 wb = uRot[b] * pb * uScl[b] + uOff[b];
  vec3 pos = mix(wa, wb, e);

  // Noise brush (screen space)
  vec4 c0 = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  vec2 suv = c0.xy / c0.w * 0.5 + 0.5;
  float tch = smoothstep(0.05, 0.85, texture2D(uTouch, suv).r) * uTouchAmt;
  float scl = mix(uScl[a], uScl[b], e);
  vec2 away = pos.xy - uPointer;
  pos.xy += normalize(away + 1e-4) * tch * 0.16 * scl;
  pos += eps * tch * 0.1 * scl;

  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = mix(uSizes[a] * baseSize(a), uSizes[b] * baseSize(b), e);
  float ps = size * uPixelRatio * (uCamZ / -mv.z) * (1.0 + tch * 0.5);
  float tw = 1.0 - 0.22 * uMotion * (0.5 + 0.5 * sin(uTime * (1.1 + aRand.y * 2.4) + ph));
  float bright = mix(baseBright(a) * uGains[a], baseBright(b) * uGains[b], e);
  float noiseDim = mix(1.0, 1.0 / (1.0 + sigma * 1.4), 0.65);
  vAlpha = bright * tw * noiseDim * uFade * (1.0 + tch * 0.9) * clamp(ps / 1.5, 0.3, 1.0);
  gl_PointSize = max(ps, 1.5);

  vec3 col = mix(baseColor(a), baseColor(b), e);
  col = mix(col, uPal[3] * 1.3, clamp(tch * 0.7 + sigma * 0.12, 0.0, 0.85));
  vColor = col;
}

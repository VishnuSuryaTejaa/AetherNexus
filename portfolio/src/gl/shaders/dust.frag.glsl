varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = (exp(-r2 * 5.0) + exp(-r2 * 1.6) * 0.12) * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}

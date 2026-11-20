varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 6.5);
  float halo = exp(-r2 * 2.0) * 0.16;
  float a = (core + halo) * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}

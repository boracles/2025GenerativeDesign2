// rd_init.frag.glsl
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform float uThreshold;
uniform float uTime;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  float n = hash(vUv + fract(uTime * 0.001));
  float U = 1.0;
  float V = step(uThreshold, n);
  outColor = vec4(U, V, 0.0, 1.0); // RG = U,V
}

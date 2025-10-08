precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform float uThreshold; // 0.97~0.995 권장
uniform float uTime;

const float PI = 3.141592653589793;

// 주기적(타일러블) 난수: uv 0과 1에서 값이 일치 → Seamless
float periodicNoise(vec2 uv) {
  vec2 sx = vec2(sin(2.0 * PI * uv.x), cos(2.0 * PI * uv.x));
  vec2 sy = vec2(sin(2.0 * PI * uv.y), cos(2.0 * PI * uv.y));
  float n = dot(vec4(sx, sy), vec4(12.9898, 78.233, 45.164, 94.673));
  return fract(sin(n) * 43758.5453);
}

void main() {
  // 시간으로 시드 바꿔도 주기성 유지 (원하면 고정해도 됨)
  float t = fract(uTime * 0.001);
  float n = periodicNoise(vUv + vec2(t, 0.0));

  float U = 1.0;
  float V = step(uThreshold, n); // 1~5% 시드 목표면 uThreshold 0.98±

  outColor = vec4(U, V, 0.0, 1.0); // RG=U,V 저장
}

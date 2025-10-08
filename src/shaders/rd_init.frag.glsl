precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform float uThreshold;  // 0.97~0.995 권장 (점 밀도 제어)
uniform float uTime;       // R키로 재시드 만들 때 살짝 바꿔줌

// 좌표 기반 난수
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  float n = hash(vUv + fract(uTime * 0.001));
  float U = 1.0;                 // 영양분 가득
  float V = step(uThreshold, n); // 임계값 이상인 픽셀만 V=1 (드문 점)
  outColor = vec4(U, V, 0.0, 1.0); // RG=U,V 저장
}
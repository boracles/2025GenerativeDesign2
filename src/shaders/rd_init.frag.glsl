precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform float uCells;      // 가로 셀 개수 (예: 110)
uniform float uRadiusPx;   // 점 반경(픽셀) (예: 3.5)
uniform float uDensity;    // 점 채우는 비율 0~1 (예: 0.65)
uniform float uSeedShift;  // reseed 때마다 바뀌는 난수 시프트

// 간단 해시
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

void main() {
  // 셀 좌표(각 셀에서 최대 1개의 점)
  float cells = max(uCells, 1.0);
  vec2 g = vUv * cells;
  vec2 id = floor(g);
  vec2 f = fract(g);

  // 셀별 난수
  float rCell = hash(id + uSeedShift);

  // 밀도 필터: uDensity 비율로만 점 활성
  float keep = step(0.92, rCell); // 8% 확률만 시드 생성

  // 셀 중앙에서 약간 흔든 위치
  vec2 jitter = vec2(hash(id + 11.1 + uSeedShift), hash(id + 27.7 + uSeedShift)) - 0.5;
  vec2 center = 0.5 + 0.35 * jitter;

  // 소프트 디스크 반경(셀 좌표계 기준)
  float radUV = max((uRadiusPx / max(uCells, 1.0)) * 2.0, 1e-4);
  float d = length(f - center);

// ✅ edge0 < edge1 로 순서 수정
  float disk = smoothstep(radUV * 0.55, radUV, d);

// 안쪽(원)에서 1, 바깥 0
  float Vseed = (1.0 - disk) * keep;

  outColor = vec4(1.0, Vseed, 0.0, 1.0);

}

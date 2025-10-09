precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uState;   // RG=(U,V)
uniform vec2 uTexel;       // 1.0 / textureSize(uState, 0)
uniform float uDu;          // 0.16~0.18
uniform float uDv;          // 0.08~0.09
uniform float uF;           // base feed
uniform float uK;           // base kill
uniform float uDt;          // 1.0

// --- 로제트 제어용 보로노이 파라미터 ---
uniform float uVoronoiCells;   // 가로 기준 셀 수 (예: 12.0)
uniform float uJitter;         // seed 지터 (0~0.5, 예: 0.35)
uniform float uCenterBoost;    // 중심 feed 가중 (예: 0.6)
uniform float uEdgeBoost;      // 경계 feed 가중 (예: 0.8)
uniform float uEdgeWidth;      // 경계 링 너비 (0.05~0.2, 예: 0.12)

// 8-이웃 라플라시안
vec2 laplace(vec2 uv) {
  vec2 c = texture(uState, uv).rg;
  vec2 n = texture(uState, uv + vec2(0.0, uTexel.y)).rg;
  vec2 s = texture(uState, uv + vec2(0.0, -uTexel.y)).rg;
  vec2 e = texture(uState, uv + vec2(uTexel.x, 0.0)).rg;
  vec2 w = texture(uState, uv + vec2(-uTexel.x, 0.0)).rg;
  vec2 ne = texture(uState, uv + vec2(uTexel.x, uTexel.y)).rg;
  vec2 nw = texture(uState, uv + vec2(-uTexel.x, uTexel.y)).rg;
  vec2 se = texture(uState, uv + vec2(uTexel.x, -uTexel.y)).rg;
  vec2 sw = texture(uState, uv + vec2(-uTexel.x, -uTexel.y)).rg;
  return (n + s + e + w) * 0.2 + (ne + nw + se + sw) * 0.05 - c;
}

// 타일러블 해시
float hash12(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

// 타일러블 보로노이: uv∈[0,1], 셀 당 1개 시드(지터)
float voronoiDist(vec2 uv, float cells, float jitter) {
  vec2 g = uv * cells;                 // 셀 좌표
  vec2 id = floor(g);
  vec2 f = fract(g);
  float dmin = 1e9;
  // 주기성 보장을 위해 3x3 이웃 검사
  for(int j = -1; j <= 1; j++) {
    for(int i = -1; i <= 1; i++) {
      vec2 nid = id + vec2(float(i), float(j));
      // 주기적 시프트
      vec2 rnd = vec2(hash12(nid + 11.1), hash12(nid + 27.7));
      vec2 p = vec2(float(i), float(j)) + rnd - 0.5;
      p *= jitter;
      vec2 seed = vec2(float(i), float(j)) + rnd + p;
      dmin = min(dmin, distance(f, seed));
    }
  }
  // 한 셀 대각선의 최대거리 ~1.414, 정규화 감각적으로 0~1대역
  float n = hash12(id + f * 100.0);        // 셀 내부 노이즈
  return (dmin + 0.03 * n) * 1.2;
}

void main() {
  // 현재 상태
  vec2 UV = texture(uState, vUv).rg;
  float U = UV.r, V = UV.g;

  vec2 L = laplace(vUv);

  // ----- 보로노이 기반 로제트 마스크 -----
  float d = voronoiDist(vUv, max(uVoronoiCells, 1.0), clamp(uJitter, 0.0, 0.5)); // 0(센터)~1(셀 경계)
  // 중심/경계 마스크
  float center = 1.0 - smoothstep(0.20, 0.45, d);                              // 셀 중심
  float edge = smoothstep(0.55 - uEdgeWidth, 0.55, d) *
    (1.0 - smoothstep(0.55, 0.55 + uEdgeWidth, d));               // 링

  // 로컬 feed 가중치: 중심·경계에서 성장 유도
  float F_loc = uF * (1.0 + uCenterBoost * center + uEdgeBoost * edge);

  // Gray–Scott
  float UVV = U * V * V;
  float dU = uDu * L.r - UVV + F_loc * (1.0 - U);
  float dV = uDv * L.g + UVV - (F_loc + uK) * V;

  U = clamp(U + dU * uDt, 0.0, 1.0);
  V = clamp(V + dV * uDt, 0.0, 1.0);

  outColor = vec4(U, V, 0.0, 1.0);
}

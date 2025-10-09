precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uState;  // RG=(U,V)
uniform vec2 uTiles;      // ⬅︎ float가 아니라 vec2(가로,세로)

// 텍셀 크기
vec2 texel() {
  ivec2 s = textureSize(uState, 0);
  return 1.0 / vec2(s);
}

void main() {
  // 타일 반복
  vec2 tiles = max(uTiles, vec2(1.0));
  vec2 uv = fract(vUv * tiles);

  // 타일 수가 늘어나면 이웃 샘플 간 간격도 그만큼 작아져야 한다
  vec2 px = texel() / tiles;

  // --------- 여기 아래는 너의 기존 색(핵/경계) 계산 그대로 ----------
  float V = texture(uState, uv).g;

  // 그래디언트
  float gx = texture(uState, uv + vec2(px.x, 0.0)).g - texture(uState, uv - vec2(px.x, 0.0)).g;
  float gy = texture(uState, uv + vec2(0.0, px.y)).g - texture(uState, uv - vec2(0.0, px.y)).g;
  float grad = length(vec2(gx, gy));

  // 라플라시안 (핵)
  float Ve = texture(uState, uv + vec2(px.x, 0.0)).g;
  float Vw = texture(uState, uv - vec2(px.x, 0.0)).g;
  float Vn = texture(uState, uv + vec2(0.0, px.y)).g;
  float Vs = texture(uState, uv - vec2(0.0, px.y)).g;
  float Vne = texture(uState, uv + px).g;
  float Vnw = texture(uState, uv - px).g;
  float lap = (Vn + Vs + Ve + Vw) * 0.25 + (Vne + Vnw) * 0.125 - V;

  // 핵(WHITE): V가 충분히 낮고(U가 높을 때만)
  float U = texture(uState, uv).r;
  float coreV = smoothstep(0.08, 0.02, V);   // V↓ → 1
  float coreU = smoothstep(0.60, 0.90, U);   // U↑ → 1
  float core = coreV * coreU;               // 둘 다 만족할 때 흰 핵

  // 경계(RED): 중간대 + 큰 그래디언트
  float mid = 1.0 - smoothstep(0.20, 0.00, abs(V - 0.5)); // 0.5±0.20
  float edge = smoothstep(0.06, 0.14, grad) * mid;

  // --- 기존 색 합성 ---
  vec3 TEAL = vec3(11.0 / 255.0, 104.0 / 255.0, 133.0 / 255.0);
  vec3 RED = vec3(0.90, 0.12, 0.20);

// ⛔ WHITE 섞던 줄은 지웁니다.
// col = mix(col, WHITE, clamp(core, 0.0, 1.0));

// ✅ 흰색은 '투명' 처리: 색은 TEAL↔RED만 쓰고, 알파는 core 마스크로
  vec3 col = mix(TEAL, RED, clamp(edge * 0.8, 0.0, 1.0));

// core를 조금 더 안정적으로(깜빡임 방지 여유 구간)
  float coreMask = clamp(core, 0.0, 1.0);
// 투명화에 소량 히스테리시스(여유) 부여
  float alpha = 1.0 - smoothstep(0.08, 0.22, coreMask); // core↑ → alpha↓(투명)

  outColor = vec4(col, alpha);
}

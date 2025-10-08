#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D tMask;
uniform vec2 texel;
uniform float uSea;

// Plant (salt-tolerant vegetation)
uniform float tH_lo;   // H < sea + tH_lo
uniform float tS_lo;   // S < tS_lo
uniform float tC_lo;   // C < tC_lo

// Crab (salt crab)
uniform float tH_bandLo; // sea + tH_bandLo <= H
uniform float tH_bandHi; // H <= sea + tH_bandHi
uniform float tS_midLo;  // tS_midLo <= S
uniform float tS_midHi;  // S <= tS_midHi
uniform float tC_hi;     // C > tC_hi

// Aspect
uniform float aSouth; // center (0..1) — 남향은 0.25
uniform float aWidth; // 허용 반폭 (0..1), 0.1~0.2 권장

// dots
uniform float stride; // 픽셀 격자 간격
uniform float rDot;   // 셀 내부 반지름 (0..0.5)

float aspectMatch(float a, float center, float width) {
  float d = abs(a - center);
  d = min(d, 1.0 - d);         // 원형 거리
  return smoothstep(0.0, width, width - d); // center 근처일수록 1
}

void main() {
  // 셀 중심 샘플링
  vec2 p = gl_FragCoord.xy / stride;
  vec2 cell = floor(p) + 0.5;
  vec2 uv = cell * stride * texel;

  // 마스크 읽기
  vec4 m = texture2D(tMask, uv);
  float H = m.r, S = m.g, C = m.b, A = m.a;

  // 규칙
  bool plantOn = (H < uSea + tH_lo) &&
    (S < tS_lo) &&
    (C < tC_lo) &&
    (aspectMatch(A, aSouth, aWidth) > 0.5);

  bool crabOn = (uSea + tH_bandLo <= H && H <= uSea + tH_bandHi) &&
    (tS_midLo <= S && S <= tS_midHi) &&
    (C > tC_hi) &&
    (aspectMatch(A, aSouth, aWidth) > 0.5);

  // 셀 내부 원형 점 마스크
  vec2 q = fract(p) - 0.5;
  float dotMask = step(length(q), rDot);

  // 색상/알파
  vec3 colPlant = vec3(0.95, 0.78, 0.38);
  vec3 colCrab = vec3(0.69, 0.34, 0.35);
  float fp = plantOn ? 1.0 : 0.0;
  float fc = crabOn ? 1.0 : 0.0;
  vec3 col = fp * colPlant + fc * colCrab;
  float vis = clamp(fp + fc, 0.0, 1.0) * dotMask;

  gl_FragColor = vec4(col, vis); // 투명도 기반 오버레이 가능
}

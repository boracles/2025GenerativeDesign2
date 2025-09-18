#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D tMask;
uniform vec2 texel;
uniform float uSea;

// 기존 임계값들 …
uniform float tH_lo, tS_lo, tC_lo;
uniform float tH_bandLo, tH_bandHi, tS_midLo, tS_midHi, tC_hi;
uniform float aSouth, aWidth;
uniform float stride, rDot;

// ★ 블루노이즈 우승자 방식 유니폼
uniform float uRpx;   // 픽셀 단위 최소 간격
uniform float uSeed;  // 우승자 섞기용 시드

// ---- 앵커 [A]: Noise Filtering uniforms ----
uniform bool uUseNoise;      // [true|false]
uniform float uNoiseScale;    // [기본 1.0]  0.05~8.0
uniform float uNoiseAmp;      // [기본 0.5]  0.0~2.0
uniform float uNoiseBias;     // [기본 0.0]  -1.0~1.0
uniform float uNoiseSeed;     // [기본 랜덤], reseed로 갱신

// 해시
float hash12(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.0);
  return fract(p.x * p.y);
}

// Aspect 매칭
float aspectMatch(float a, float center, float width) {
  float d = abs(a - center);
  d = min(d, 1.0 - d);
  float t = 1.0 - clamp(d / max(1e-6, width), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// 후보(규칙 통과) 판정
bool eligible(vec2 uv) {
  vec4 m = texture2D(tMask, uv);
  float H = m.r, S = m.g, C = m.b, A = m.a;
  float aM = aspectMatch(A, aSouth, aWidth);

  bool plant = (H < uSea + tH_lo) && (S < tS_lo) && (C < tC_lo) && (aM > 0.5);
  bool crab = (uSea + tH_bandLo <= H && H <= uSea + tH_bandHi) &&
    (tS_midLo <= S && S <= tS_midHi) &&
    (C > tC_hi) && (aM > 0.5);
  return plant || crab;
}

// ---- 앵커 [B]: Noise 함수 정의 ----
float hash21(vec2 p) {
  p = fract(p * vec2(443.8975, 441.423));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for(int i = 0; i < 5; i++) {
    v += a * valueNoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return clamp(v, 0.0, 1.0);
}

void main() {
  // 셀 좌표/중심
  vec2 p = gl_FragCoord.xy / stride;
  vec2 cell = floor(p) + 0.5;
  vec2 uv = cell * stride * texel;

  // 후보가 아니면 즉시 투명
  if(!eligible(uv))
    discard;

  // 내 우선순위(블루노이즈 우승자)
  float myPriority = hash12(cell + uSeed);

  // 반경 rpx를 셀 단위로 환산
  float rCells = uRpx / stride;
  int R = int(ceil(rCells));
  const int MAX_R = 16; // 루프 상한

  // 주변 셀 검사
  for(int jy = -MAX_R; jy <= MAX_R; ++jy) {
    for(int ix = -MAX_R; ix <= MAX_R; ++ix) {
      if(ix == 0 && jy == 0)
        continue;
      if(abs(ix) > R || abs(jy) > R)
        continue;

      vec2 cellN = cell + vec2(float(ix), float(jy));
      vec2 uvN = cellN * stride * texel;

      // 반경 체크(픽셀)
      vec2 dpx = vec2(float(ix), float(jy)) * stride;
      if(dot(dpx, dpx) > uRpx * uRpx)
        continue;

      if(!eligible(uvN))
        continue;

      float pr = hash12(cellN + uSeed);
      if(pr > myPriority)
        discard; // 이웃이 우승 → 탈락
    }
  }

  // 우승 셀 → 점 그리기(원형)
  vec2 q = fract(p) - 0.5;
  float dotMask = step(length(q), rDot);

  // 색 계산 (식물/게)
  vec4 m = texture2D(tMask, uv);
  float H = m.r, S = m.g, C = m.b, A = m.a;
  float aM = aspectMatch(A, aSouth, aWidth);
  bool plant = (H < uSea + tH_lo) && (S < tS_lo) && (C < tC_lo) && (aM > 0.5);
  bool crab = (uSea + tH_bandLo <= H && H <= uSea + tH_bandHi) &&
    (tS_midLo <= S && S <= tS_midHi) &&
    (C > tC_hi) && (aM > 0.5);

  vec3 colPlant = vec3(0.95, 0.78, 0.38);
  vec3 colCrab = vec3(0.69, 0.34, 0.35);
  vec3 col = (plant ? colPlant : vec3(0.0)) + (crab ? colCrab : vec3(0.0));

  float vis = dotMask; // 기본 가시도

  // ---- 앵커 [C]: Noise Filtering 적용 (vis 수정) ----
  if(uUseNoise) {
    vec2 nUV = uv * uNoiseScale + vec2(uNoiseSeed * 0.123, uNoiseSeed * 0.789);
    float n01 = fbm(nUV);           // 0..1
    float n11 = n01 * 2.0 - 1.0;    // -1..1
    float gain = clamp(1.0 + uNoiseBias + uNoiseAmp * n11, 0.0, 2.0);
    vis = clamp(vis * gain, 0.0, 1.0);

    // (옵션: 확률적 Threshold 방식)
    // float thresh = clamp(0.5 + 0.5*uNoiseBias + 0.5*uNoiseAmp*n11, 0.0, 1.0);
    // vis = (vis > 0.0 && n01 > thresh) ? vis : 0.0;
  }

  gl_FragColor = vec4(col, vis);
}

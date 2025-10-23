//common.glsl
precision highp float;
          #ifdef GL_OES_standard_derivatives
          #extension GL_OES_standard_derivatives : enable
          #endif
uniform float bumpAmp, bumpScale, bumpSpeed, time, stainAmp, grainAmp, stainScale, grainScale, stainSpeed;
uniform float rimHeightScale, microFactor, fractureFreq, cellJitter, terrAmp, growthPhase;
uniform float stepVar, minStep, stepContrast, bevel, bevelGain, oxideHalo;
uniform float macroFreq2, macroMix, bandJitter, rimNoiseAmp, seaLevel, macroGain, ridgeGain, rimWidth, rimGain, wallSharp, macroFreq;
uniform vec3 colCrust, colMud, waterDeep, colPoolLo, colPoolHi, colRim, colDry, colOxide1, colOxide2;
uniform sampler2D rdTex;
uniform vec2 texel;
uniform float seed;
uniform float ventAmp, ventFreq, ventGrow;
uniform float bulgeWidth, bulgeGain, rimAlphaCore, rimAlphaBulge, rimWhite, rimWhitePow;
uniform int bands;
uniform float sideWhite, sideStart, sideEnd, sideSharp;
uniform vec3 sideTint;
uniform sampler2D normalTex;
uniform sampler2D heightTexSharp;
uniform sampler2D heightTexBlur;

uniform float sideRad;
uniform float sideA, sideB;
uniform float crestLo, crestHi;
uniform float toneLow, toneHigh, toneGamma;
uniform float baseDarkMin, baseDarkMax, baseDarkEnd;
uniform float bandToneFeather;

// ───── Noise & FBM ─────
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) +
    (c - a) * u.y * (1.0 - u.x) +
    (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for(int i = 0; i < 6; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// ───── Voronoi helper (global) ─────
vec3 voro(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float md = 1e9;
  vec2 id = vec2(0.0);
  for(int y = -1; y <= 1; y++) {
    for(int x = -1; x <= 1; x++) {
      vec2 g = i + vec2(x, y);
      vec2 r = vec2(hash(g + 13.1), hash(g + 91.7)) - 0.5;
      vec2 c = g + r;
      vec2 d = (i + f) - c;
      float dist = dot(d, d);
      if(dist < md) {
        md = dist;
        id = g;
      }
    }
  }
  return vec3(id, sqrt(md)); // xy: cell id, z: distance to border
}

float idxAt(vec2 q) {
  vec2 w1q = vec2(fbm(q * 1.8 + seed * 0.11), fbm(q * 1.8 - seed * 0.28));
  vec2 w2q = vec2(fbm(q * 3.6 - seed * 0.47), fbm(q * 3.6 + seed * 0.62));
  vec2 pq = q + 0.65 * (w1q - 0.5) + 0.30 * (w2q - 0.5);
  float f0q = fbm(pq * macroFreq2);
  float f1q = fbm(pq * macroFreq2 * 1.7);
  float ridq = abs(2.0 * fbm(pq * macroFreq2 * 0.85) - 1.0);
  float fq = 0.55 * f0q + 0.25 * f1q + 0.20 * ridq;
  float rampq = 0.65 * (q.y - 0.5) + 0.25 * (q.x - 0.5);
  fq = mix(fq, clamp(rampq + 0.5, 0.0, 1.0), 0.28);
  fq = clamp((fq - 0.03) / (0.97 - 0.03), 0.0, 1.0);
  float gammaMapq = mix(0.75, 1.45, fbm(pq * 1.1 + seed * 0.24));
  fq = pow(fq, gammaMapq);
  fq = mix(fq, fq + 0.04 * (texture2D(rdTex, q).g - 0.5), ridgeGain);
  float Nq = float(bands);
  float idx0 = floor(fq * Nq);
  vec3 vcellq = voro(pq * 12.0);
  float rq = hash(vcellq.xy + seed * 3.7);
  float offq = 0.35 * (fbm(pq * 0.9 + seed * 2.1) - 0.5) + 0.15 * (rq - 0.5);
  offq = clamp(offq, -0.45, 0.45);
  return clamp(idx0 + offq, 0.0, Nq - 1.0);
}

float topDistAt(vec2 q, float Nmaj) { /* (기존 코드 그대로) */
  vec2 w1 = vec2(fbm(q * 1.8 + seed * 0.11), fbm(q * 1.8 - seed * 0.28));
  vec2 w2 = vec2(fbm(q * 3.6 - seed * 0.47), fbm(q * 3.6 + seed * 0.62));
  vec2 p = q + 0.65 * (w1 - 0.5) + 0.30 * (w2 - 0.5);
  float f0 = fbm(p * macroFreq2);
  float f1 = fbm(p * macroFreq2 * 1.7);
  float rd = abs(2.0 * fbm(p * macroFreq2 * 0.85) - 1.0);
  float field = 0.55 * f0 + 0.25 * f1 + 0.20 * rd;
  float ramp = 0.65 * (q.y - 0.5) + 0.25 * (q.x - 0.5);
  field = mix(field, clamp(ramp + 0.5, 0.0, 1.0), 0.28);
  field = clamp((field - 0.03) / (0.97 - 0.03), 0.0, 1.0);
  float gmap = mix(0.75, 1.45, fbm(p * 1.1 + seed * 0.24));
  field = pow(field, gmap);
  field = mix(field, field + 0.04 * (texture2D(rdTex, q).g - 0.5), ridgeGain);
  float f = fract(field * Nmaj);
  float dist = min(f, 1.0 - f);
  return dist;
}

void terracing(vec2 uv, out float h, out float hBase, out float rim, out vec3 col) {
  vec2 w1 = vec2(fbm(uv * 1.8 + seed * 0.11), fbm(uv * 1.8 - seed * 0.28));
  vec2 w2 = vec2(fbm(uv * 3.6 - seed * 0.47), fbm(uv * 3.6 + seed * 0.62));
  vec2 p = uv + 0.65 * (w1 - 0.5) + 0.30 * (w2 - 0.5);
  float f0 = fbm(p * macroFreq2);
  float f1 = fbm(p * macroFreq2 * 1.7);
  float rid = abs(2.0 * fbm(p * macroFreq2 * 0.85) - 1.0);
  float field = 0.55 * f0 + 0.25 * f1 + 0.20 * rid;

  // 곡선형 경계 유도: field에 미세 워프
  vec2 warpN = vec2(fbm(p * 5.0 + seed * 0.35) - 0.5, fbm(p * 5.0 - seed * 0.72) - 0.5);
  field += 0.05 * (warpN.x + warpN.y);

 // --- irregular multi-basin bowl (non-circular)
  vec2 c = vec2(0.5) + 0.030 * vec2(fbm(vec2(seed * 0.13, 0.0) + uv * 0.7) - 0.5, fbm(vec2(0.0, seed * 0.19) + uv * 0.7) - 0.5);

// 1) 각도 기반 반경 프로파일 (원형 깨기)
  vec2 q = uv - c;
  float r = length(q);
  float th = atan(q.y, q.x);

// θ에 의존하는 변조(저·중·고주파 + FBM)
  float rBase = 0.62;
  float rVar = 0.10 * sin(th * 3.0 + seed * 0.7) +
    0.06 * sin(th * 7.0 - seed * 1.3) +
    0.06 * (fbm(vec2(cos(th), sin(th)) * 2.3 + seed * 0.21) - 0.5);

// 반경 목표값
  float rTarget = rBase + rVar;

// 2) 반경에 추가 워프(라디얼 노이즈)로 울퉁불퉁
  float warpR = 0.10 * (fbm(uv * 2.0 + seed * 0.31) - 0.5);

// 첫 번째 분지
  float bowl1 = smoothstep(rTarget - 0.12, rTarget + 0.14, r + warpR);

// 3) 보조 중심(두 번째 분지) 추가 → 한쪽이 패이거나 늘어진 느낌
  vec2 c2 = c + 0.18 * vec2(fbm(uv * 1.1 + seed * 3.1) - 0.5, fbm(uv * 1.1 - seed * 2.7) - 0.5);
  float r2 = length(uv - c2);
  float bowl2 = smoothstep(rTarget - 0.10, rTarget + 0.16, r2 + warpR * 0.7);

// 분지들을 합성: 가장 낮은 쪽을 채택(비원형, 군데군데 파임)
  float bowl = min(bowl1, bowl2);

// 원래 field와 섞기 — 과하면 동그랗게 보이므로 0.18~0.24 권장
  field = mix(field, bowl, 0.22);

  field = clamp((field - 0.03) / (0.97 - 0.03), 0.0, 1.0);
  float gammaMap = mix(0.75, 1.45, fbm(p * 1.1 + seed * 0.24));
  field = pow(field, gammaMap);
  float V = texture2D(rdTex, uv).g;
  field = mix(field, field + 0.04 * (V - 0.5), ridgeGain);
  hBase = clamp(macroGain * field, 0.0, 1.0);

  float Nmaj = float(bands);
  float raw = field * Nmaj;
  float idx0 = floor(raw);
  float frac = fract(raw);
  float f = fract(field * Nmaj);

 // 수정
  float fw = clamp(fwidth(raw) * 0.5, 0.002, 0.15);
  float smoothIdx = idx0 + smoothstep(0.5 - fw, 0.5 + fw, frac);

  vec3 vcell = voro(p * 12.0);
  float rHash = hash(vcell.xy + seed * 3.7);      // 이름 변경!
  float off = 0.35 * (fbm(p * 0.9 + seed * 2.1) - 0.5) + 0.15 * (rHash - 0.5);

  off = clamp(off, -0.45, 0.45);

  float idx = clamp(smoothIdx + off, 0.0, Nmaj - 1.0);

  float span = 1.0;
  float g = smoothstep(-span, 1.0 - span, growthPhase - idx);
  float gRim = smoothstep(-span, 1.0 - span, growthPhase - (idx - 0.35));

  float aa = max(fwidth(uv.x) + fwidth(uv.y), 1e-5);
  float rimW = mix(0.045, 0.12, clamp((rimWidth - 0.02) / (0.18 - 0.02), 0.0, 1.0));
  float rimWpx = max(rimW, 2.0 * aa);

  float rimMask = 1.0; // 연속값 기반 에지로만 처리

   // 밴드 경계까지의 거리(곡선형): FBM 워프 + smoothstep
  float bandPhase = fract(raw);                          // 0..1
  float baseEdge = min(bandPhase, 1.0 - bandPhase);     // 경계까지 값거리
  float warpEdge = 0.05 * (fbm(p * 4.0 + seed * 0.7) - 0.5) + 0.03 * (fbm(p * 8.0 - seed * 1.9) - 0.5); // 곡률 왜곡
  float dEdge = smoothstep(0.02, 0.25, abs(baseEdge + warpEdge));

  float core = 1.0 - smoothstep(rimWpx - aa, rimWpx + aa * 3.0, dEdge);
  float sigma = rimWpx * bulgeWidth;
  float bulge = exp(-(dEdge * dEdge) / (2.0 * sigma * sigma));
  core *= gRim * rimMask;
  bulge *= gRim * rimMask;

 // --- 단마다 높이 랜덤하게 변형 ---
  float stepH = 1.0 / Nmaj;

// 밴드 인덱스별 변조값 (FBM으로)
  float bandNoise = fbm(vec2(idx * 0.37 + seed * 1.7, seed * 2.3)) * 0.6 + 0.7;
// 0.7~1.3 배 정도로 단마다 높이 차이

  float plate = (idx + bandNoise) / Nmaj;

  float base0 = (idx < 0.5) ? (0.35 * stepH) : 0.0;
  float hPlate = g * (plate + base0);

  float rimProfile = max(core, bulge * bulgeGain);
  float roundRadius = rimWpx * (2.0 + 2.5 * bevel);

  float tB = smoothstep(0.0, roundRadius, dEdge);
  tB = tB * tB * (3.0 - 2.0 * tB); // Hermite^2

      // 목표 높이: 계단 중앙선(plate mid)
  float midPlate = (idx + 0.5) / float(bands);
  float hBevel = g * mix((plate + base0), midPlate, tB);

      // 림 기여는 유지하되, 베벨 진행에 비례해 살짝 줄임(과도한 날카로움 억제)
  float rimAtten = mix(1.0, 0.6, tB);
  float hRim = g * rimAtten * (terrAmp * rimHeightScale * (rimGain * stepH) * rimProfile);
  float hTmp = clamp(g * (0.10 * hBase) + hBevel + hRim, 0.0, 1.0);

  float topMaskH = smoothstep(0.02, 0.15, dEdge);
  float tb = fbm(uv * bumpScale);
  h = clamp(hTmp + topMaskH * bumpAmp * (tb - 0.5), 0.0, 1.0);

  float height01 = clamp((idx + 1.0) / Nmaj, 0.0, 1.0);
  vec3 waterGrad = mix(colPoolLo, colPoolHi, smoothstep(0.00, 0.50, height01));
  vec3 landGrad = mix(colDry, colMud, smoothstep(0.50, 1.00, height01));
  float tcol = smoothstep(0.40, 0.58, height01);
  col = mix(waterGrad, landGrad, tcol);

  rim = clamp(rimAlphaCore * core + rimAlphaBulge * bulge, 0.0, 1.0);
}
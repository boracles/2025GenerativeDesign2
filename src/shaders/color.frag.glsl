//color.frag.glsl
void main() {
    vec2 uv = gl_FragCoord.xy * texel;
    float h, hBase, r;
    vec3 col;
    terracing(uv, h, hBase, r, col);

    // ======= replace BEGIN =======
// continuous (pre-terrace) height to avoid pixel-quantized edges
    float N = float(bands);
    float rawBase = hBase * N;

// --- STATIC, WORLD-STABLE JITTER (no time, no screen-derivatives) ---
    float pxEdge = max(texel.x, texel.y);           // size of one texel in UV
    vec2 cellId = floor(uv / pxEdge);              // stable texel index in texture space
// interleaved gradient noise (IGL) style hash — WebGL1 safe
    float ign = fract(sin(dot(cellId, vec2(127.1, 311.7))) * 43758.5453123);

    float jitter = (ign - 0.5) * 0.35;                 // 0.25~0.45로 조절
    float edgeVal = abs(fract(rawBase + jitter) - 0.5); // 0..0.5, 경계까지의 위상 거리

// screen-space edge width (use fwidth + a bit of base slope)
    float dfBase = max(length(vec2(dFdx(rawBase), dFdy(rawBase))), 1e-4);
    float edgeW = clamp(0.5 * dfBase + 0.75 * length(vec2(dFdx(hBase), dFdy(hBase))), 0.75 * pxEdge, 0.25);

// soft contour mask (1 = step crest, 0 = plateaus)
    float rim = 1.0 - smoothstep(0.30 * edgeW, 2.50 * edgeW, edgeVal);
// ======= replace END =======

    float t = 0.0;

    float macro = fbm(uv * stainScale + vec2(t * 0.11, -t * 0.07));
    float micro = noise(uv * grainScale + vec2(-t * 1.3, t * 1.1));

    float stain = (0.8 * macro + 0.2 * micro - 0.5) * 2.0;
    col = clamp(col * (1.0 + stainAmp * stain) + (micro - 0.5) * grainAmp, 0.0, 1.0);

      // ── Band-quantized tone (층마다 확실한 톤 차이)
    float idx = floor(h * N);                     // 밴드 인덱스(0..N-1)
    float band01 = clamp(idx / max(N - 1.0, 1.0), 0.0, 1.0);

      // 층계별 톤: toneLow → toneHigh 사이 보간
    float toneBand = mix(toneLow, toneHigh, pow(band01, toneGamma));

    float f2 = fract(h * N);
    float distToStep2 = min(f2, 1.0 - f2);

    float px = max(texel.x, texel.y) * bandToneFeather;

    float soften = smoothstep(0.0, px, distToStep2);

      // 밴드톤 ↔ 일반 톤을 섞어서 경계가 부드럽게
    col *= mix(toneBand, mix(toneLow, toneHigh, pow(h, toneGamma)), 1.0 - soften);

    float w = pow(clamp(r, 0.0, 1.0), rimWhitePow);
    w *= rim;                                           // 림 마스크
    float aw = max(fwidth(w), max(texel.x, texel.y));
    w = smoothstep(0.0, aw * 3.0, w);
    vec3 colOut = mix(col, vec3(1.0), rimWhite * w);

// 화면미분 경사: 블러(안정) + 샤프(예민) 하이브리드
    float hB = texture2D(heightTexBlur, uv).r;
    float hS = texture2D(heightTexSharp, uv).r;
    float gB = length(vec2(dFdx(hB), dFdy(hB)));
    float gS = length(vec2(dFdx(hS), dFdy(hS)));
    float gradH = mix(gB, gS, 0.6);  // 0.4~0.7 사이로 조정 가능

// ❶ 경사 임계를 더 예민하게 (옆면 더 쉽게 잡힘)
    float sideH = smoothstep(sideA * 0.6, sideB * 0.8, gradH);

    vec3 n = texture2D(normalTex, uv).xyz * 2.0 - 1.0;
    n = normalize(n);
    float slopeN = 1.0 - clamp(n.z, 0.0, 1.0);
    float sideN = smoothstep(sideStart, sideEnd, slopeN);

    // ❷ 스무스폭 줄이고(덜 퍼지게), 감마는 확장 쪽(0.85)으로
    float sideMask = max(sideH, sideN);
    float af = 0.9 * fwidth(sideMask);                 // 1.5 → 0.9
    sideMask = smoothstep(-af, 1.0 + 0.5 * af, sideMask);
    sideMask = pow(clamp(sideMask, 0.0, 1.0), 0.85);   // sideSharp 대신 0.85로 확장

    float edgeNear = 1.0 - smoothstep(0.10, 0.24, abs(fract(rawBase + jitter) - 0.5));

// 옆면×경계 게인 ↑
    float sideEdge = clamp(sideMask * edgeNear * 1.85, 0.0, 1.0);  // 1.6~2.2 사이에서 조정

      // ── Crest (라플라시안도 샤프)
    float hCsharp = texture2D(heightTexSharp, uv).r;

    float hL2 = texture2D(heightTexSharp, uv - vec2(texel.x, 0.0)).r;
    float hR2 = texture2D(heightTexSharp, uv + vec2(texel.x, 0.0)).r;
    float hD2 = texture2D(heightTexSharp, uv - vec2(0.0, texel.y)).r;
    float hU2 = texture2D(heightTexSharp, uv + vec2(0.0, texel.y)).r;
    float hLU = texture2D(heightTexSharp, uv + vec2(-texel.x, texel.y)).r;
    float hRU = texture2D(heightTexSharp, uv + vec2(texel.x, texel.y)).r;
    float hLD = texture2D(heightTexSharp, uv + vec2(-texel.x, -texel.y)).r;
    float hRD = texture2D(heightTexSharp, uv + vec2(texel.x, -texel.y)).r;

      // 등방성 3x3 라플라시안 (교차=1, 대각=0.25, 중심= -5)
    float lap = (hL2 + hR2 + hU2 + hD2 + 0.25 * (hLU + hRU + hLD + hRD)) - 5.0 * hCsharp;

      // 음의 라플라시안(볼록)을 양수로 뒤집어 임계 적용
    float lapNeg = max(0.0, -lap);
    float crest = smoothstep(crestLo, crestHi, lapNeg);

      // 옆면이 아니라 "윗면"만 잡도록 정리: 위쪽을 향한 노멀일수록 가중
    crest *= smoothstep(0.70, 0.95, n.z);

      // 벽(옆면)에서 과도 중복 방지: 옆면 마스크가 강한 곳은 조금 줄임(선택)
    crest *= (1.0 - 0.5 * sideMask);

    float rimSideMask = max(w, sideEdge);
    rimSideMask = max(rimSideMask, crest);

// 옆면 띠 밝기/면적 살짝 보강
    rimSideMask = clamp(pow(rimSideMask, 0.75) * 1.20, 0.0, 1.0);

// 화이트 블렌딩 (sideWhite가 1.0이면 충분, 부족하면 GUI에서 ↑)
    colOut = mix(colOut, vec3(1.0), sideWhite * rimSideMask);

    gl_FragColor = vec4(colOut, 1.0);
}
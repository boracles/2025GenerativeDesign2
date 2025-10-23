void main() {
    vec2 uv = gl_FragCoord.xy * texel;
    float h, hBase, r;
    vec3 col;
    terracing(uv, h, hBase, r, col);

              // 림 마스크 (h 기반)
    float N = float(bands);
    float f = h * N;
    float frac = fract(f);
    float distToStep = min(frac, 1.0 - frac);
    float texelSize = max(texel.x, texel.y);
    float rim = 1.0 - smoothstep(texelSize, texelSize * 3.0, distToStep);

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

      // ── Side whitening (gradient용은 샤프)
    float rpx = max(texel.x, texel.y) * sideRad;
    float hL = texture2D(heightTexSharp, uv - vec2(rpx, 0.0)).r;
    float hR = texture2D(heightTexSharp, uv + vec2(rpx, 0.0)).r;
    float hD = texture2D(heightTexSharp, uv - vec2(0.0, rpx)).r;
    float hU = texture2D(heightTexSharp, uv + vec2(0.0, rpx)).r;

    float gradH = length(vec2(hL - hR, hD - hU));
    float sideH = smoothstep(sideA, sideB, gradH);

    vec3 n = texture2D(normalTex, uv).xyz * 2.0 - 1.0;
    n = normalize(n);
    float slopeN = 1.0 - clamp(n.z, 0.0, 1.0);
    float sideN = smoothstep(sideStart, sideEnd, slopeN);

    float sideMask = max(sideH, sideN);
    float af = 1.5 * fwidth(sideMask);
    sideMask = smoothstep(0.0 - af, 1.0 + af, sideMask);
    sideMask = pow(clamp(sideMask, 0.0, 1.0), max(0.001, sideSharp));

      // ── Crest (라플라시안도 샤프)
    float hC = texture2D(heightTexSharp, uv).r;
    float hL2 = texture2D(heightTexSharp, uv - vec2(texel.x, 0.0)).r;
    float hR2 = texture2D(heightTexSharp, uv + vec2(texel.x, 0.0)).r;
    float hD2 = texture2D(heightTexSharp, uv - vec2(0.0, texel.y)).r;
    float hU2 = texture2D(heightTexSharp, uv + vec2(0.0, texel.y)).r;
    float hLU = texture2D(heightTexSharp, uv + vec2(-texel.x, texel.y)).r;
    float hRU = texture2D(heightTexSharp, uv + vec2(texel.x, texel.y)).r;
    float hLD = texture2D(heightTexSharp, uv + vec2(-texel.x, -texel.y)).r;
    float hRD = texture2D(heightTexSharp, uv + vec2(texel.x, -texel.y)).r;

      // 등방성 3x3 라플라시안 (교차=1, 대각=0.25, 중심= -5)
    float lap = (hL2 + hR2 + hU2 + hD2 + 0.25 * (hLU + hRU + hLD + hRD)) - 5.0 * hC;

      // 음의 라플라시안(볼록)을 양수로 뒤집어 임계 적용
    float lapNeg = max(0.0, -lap);
    float crest = smoothstep(crestLo, crestHi, lapNeg);

      // 옆면이 아니라 "윗면"만 잡도록 정리: 위쪽을 향한 노멀일수록 가중
    crest *= smoothstep(0.70, 0.95, n.z);

      // 벽(옆면)에서 과도 중복 방지: 옆면 마스크가 강한 곳은 조금 줄임(선택)
    crest *= (1.0 - 0.5 * sideMask);

    float rimSideMask = max(w, sideMask);
    rimSideMask = max(rimSideMask, crest);

    float contrast = pow(clamp(h, 0.0, 1.0), toneGamma);
      // 곱해지는 최종 계수
    float tone = mix(toneLow, toneHigh, contrast);
    col = pow(col, vec3(0.8)) * tone;

      // 흰색 블렌딩
    colOut = mix(colOut, sideTint, sideWhite * rimSideMask);

    gl_FragColor = vec4(colOut, 1.0);
}
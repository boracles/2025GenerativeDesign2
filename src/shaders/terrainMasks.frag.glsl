/* === terrainMasks.frag.glsl (patched) ===
   - 기존 유니폼/로직 보존 + 감도/대비 파라미터 추가
*/
precision highp float;

uniform sampler2D heightTex;
uniform vec2 texel;
uniform float slopeScale;     // [기존] 경사 스케일(큼 → 더 밝음)
uniform float curvScale;      // [기존] 커브 스케일(미사용 유지로 기존 결과 보존)

// ── NEW: 감도/대비 조절 파라미터 ──────────────────────────────────────────────
// Height 감마(>1 진해짐, <1 밝아짐)
uniform float uHeightGamma;   // 기본 1.0
// Height 바이어스(+ 더 밝음, - 더 어두움)
uniform float uHeightBias;    // 기본 0.0
// Slope 대비 가중(큼 → 급경사 더 하얗게)
uniform float uSlopeGain;     // 기본 1.0
// Curvature 대비 가중(큼 → 양/음 라플라시안 대비 증가)
uniform float uCurvGain;      // 기본 1.0
// Aspect 날카로움(>1 축 방향으로 강조, =1 원래값)
uniform float uAspectSharpen; // 기본 1.0
// ────────────────────────────────────────────────────────────────────────────

float heightAt(vec2 uv) {
  return texture2D(heightTex, uv).r;
}

void main() {
  // [좌표계] gl_FragCoord * texel 사용
  vec2 uv = gl_FragCoord.xy * texel;

  // 샘플링
  float hc = heightAt(uv);
  float hl = heightAt(uv - vec2(texel.x, 0.0));
  float hr = heightAt(uv + vec2(texel.x, 0.0));
  float hd = heightAt(uv - vec2(0.0, texel.y));
  float hu = heightAt(uv + vec2(0.0, texel.y));

  // 중앙차분 gradient
  float hx = (hr - hl) * 0.5;   // ∂h/∂x
  float hy = (hu - hd) * 0.5;   // ∂h/∂y

  // --- Height ---
  // 감마/바이어스 적용: >gamma → 더 대비 강함 / +bias → 전체 밝아짐
  float H = clamp(pow(max(hc, 0.0), max(uHeightGamma, 1e-6)) + uHeightBias, 0.0, 1.0);
  float heightMask = H;

  // --- Slope ---
  // slopeScale*[NEW]uSlopeGain 로 대비 조절(큼 → 급경사(벽) 더 하얗게)
  float slope = length(vec2(hx, hy)) * slopeScale * uSlopeGain;
  float slopeMask = clamp(slope, 0.0, 1.0);

  // --- Curvature (Laplacian) ---
  // 기존 20.0 스케일 유지(기존 결과 보존), 여기에 [NEW]uCurvGain만 반영
  float lap = (hl + hr + hu + hd - 4.0 * hc);
  float curvMask = clamp(0.5 + lap * (20.0 * uCurvGain), 0.0, 1.0);

  // --- Aspect (낙하 방향의 방위각) ---
  // 방향 벡터(경사 하강쪽)
  vec2 g = normalize(vec2(-hx, -hy));
  // [선택] 방향성 날카로움: 축방향 강조(Sharpen>1), 1이면 원래값
  vec2 gSharpen = sign(g) * pow(abs(g), vec2(uAspectSharpen));
  // uAspectSharpen==1.0이면 gSharpen==g
  float theta = atan(gSharpen.y, gSharpen.x); // [-PI, PI]
  float aspectMask = (theta + 3.14159265) / (2.0 * 3.14159265); // [0,1]

  gl_FragColor = vec4(heightMask, slopeMask, curvMask, aspectMask);
}

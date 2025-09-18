// === terrain_masks.frag.glsl ===
// 입력: heightTex (R에 높이 0~1), texel (1/size), slopeScale는 경사 스케일 튜닝
precision highp float;
uniform sampler2D heightTex;
uniform vec2 texel;
uniform float slopeScale;   // 예: 50.0 ~ 200.0 (지형 스케일에 맞춰)
uniform float curvScale;    // 예: 1.0 ~ 4.0 (보기 좋게 리매핑)

float heightAt(vec2 uv) {
  return texture2D(heightTex, uv).r;
}

void main() {
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
  float heightMask = clamp(hc, 0.0, 1.0);

  // --- Slope ---
  // 지형 실제 스케일에 맞춰 보기 좋은 범위로 스케일 → 0~1로 압축
  float slope = length(vec2(hx, hy)) * slopeScale;
  float slopeMask = clamp(slope, 0.0, 1.0);

  float lap = (hl + hr + hu + hd - 4.0 * hc);
  float curvMask = clamp(0.5 + lap * 20.0, 0.0, 1.0);

  // --- Aspect (낙하 방향의 방위각) ---
  // 경사가 가파를수록 방향 뚜렷, 완만하면 의미 약함 → 원하면 slope로 가중도 가능
  float theta = atan(-hy, -hx);                 // [-PI, PI]
  float aspectMask = (theta + 3.14159265) / (2.0 * 3.14159265); // [0,1]

  gl_FragColor = vec4(heightMask, slopeMask, curvMask, aspectMask);
}

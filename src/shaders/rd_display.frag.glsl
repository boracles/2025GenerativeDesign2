precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uState;     // RG=U,V (G=seed)
uniform float uTiles;     // 화면 타일 미리보기
uniform vec2 uViewport;  // 종횡비 보정
uniform float uAccentRatio;   // 와인색 점 비율(0..1)
uniform float uPointRadiusPx; // 점 반경(픽셀 단위, 2.0~6.0 추천)

const vec3 BG = vec3(11.0 / 255.0, 104.0 / 255.0, 133.0 / 255.0); // #0B6885
const vec3 WHITE = vec3(1.0);
const vec3 WINE = vec3(130.0 / 255.0, 16.0 / 255.0, 43.0 / 255.0);  // #82102B
const float PI = 3.141592653589793;

// 타일러블 난수 (uv가 0과 1에서 연속)
float periodicNoise(vec2 uv) {
  vec2 sx = vec2(sin(2.0 * PI * uv.x), cos(2.0 * PI * uv.x));
  vec2 sy = vec2(sin(2.0 * PI * uv.y), cos(2.0 * PI * uv.y));
  float n = dot(vec4(sx, sy), vec4(12.9898, 78.233, 45.164, 94.673));
  return fract(sin(n) * 43758.5453);
}

void main() {
  // 1) 종횡비 보정 + 타일 미리보기
  float aspect = uViewport.x / uViewport.y;
  vec2 uvSq = vUv - 0.5;
  uvSq.x *= aspect;
  vec2 tileUv = fract(uvSq * max(uTiles, 1.0) + 0.5);

  // 2) 텍셀/반경 세팅
  ivec2 szI = textureSize(uState, 0);
  vec2 sz = vec2(szI);
  vec2 texel = 1.0 / sz;
  int steps = int(ceil(uPointRadiusPx)); // 픽셀 반경만큼 샘플

  // 3) 두 개의 독립 마스크(RED/WHITE)로 확장
  float redA = 0.0;
  float whiteA = 0.0;

  // 원형 방향으로 스캔(정사각 네모 방지)
  const int DIRS = 16;
  for(int i = 0; i < DIRS; i++) {
    float ang = (float(i) / float(DIRS)) * 2.0 * PI;
    vec2 dir = vec2(cos(ang), sin(ang)) * texel;

    for(int s = 0; s <= steps; s++) {
      vec2 nb = tileUv + dir * float(s);
      float v = texture(uState, nb).g;   // seed 여부
      if(v > 0.0) {
        // 이 이웃 '점(셀)'의 색을 결정 (점 단위 고정)
        vec2 cell = floor(nb * sz) / sz;
        float r = periodicNoise(cell + vec2(0.37, 0.61));
        // 거리 페이드(부드러운 원): 중심에서 멀어질수록 약해짐
        float falloff = 1.0 - float(s) / float(max(steps, 1));
        float sizeBoost = (r < uAccentRatio) ? 1.5 : 1.0; // 와인색 30% 더 넓게
        if(r < uAccentRatio)
          redA = max(redA, v * falloff * sizeBoost);
        else
          whiteA = max(whiteA, v * falloff);
      }
    }
  }

  // 4) 색 합성: 배경 → 흰 점 → 와인 점 (겹치면 더 강한 쪽이 보이게)
  vec3 col = BG;
  col = mix(col, WHITE, clamp(whiteA, 0.0, 1.0));
  col = mix(col, WINE, clamp(redA, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}

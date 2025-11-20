//terrain.vert.glsl
precision mediump float;

uniform float uAmp;
uniform float uFreq;

// ----- varying -----
varying float vH;       // 높이(변위) 전달

// ---- 간단한 2D value noise (Perlin-like) ----
float hash(vec2 p) {
  // 작은 해시: -1 ~ 1
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y) * 2.0 - 1.0;
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  float a = hash(i + vec2(0.0, 0.0));
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float acc = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  // 4 옥타브: 완만하고 유기적인 반복
  for(int i = 0; i < 4; i++) {
    acc += noise2(p * freq) * amp;
    freq *= 2.0;
    amp *= 0.5;
  }
  return acc;
}

void main() {
  // Three.js 내장 attribute 사용 (재선언 금지)
  vec3 p = position;

  // PlaneGeometry를 XZ 평면으로 사용하므로 x,z를 샘플링
  vec2 uv2 = vec2(p.x, p.z) * uFreq;

  float t = 0.0;  // ★ 0이면 정지, 0.02면 아주 느리게
  float h = fbm(uv2);
  h += 0.1 * sin((p.x + p.z) * 0.03); 

  // 높이 변위
  float disp = (h - 0.5) * 2.0 * uAmp;
  p.y += disp;

  vH = clamp(h, 0.0, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}

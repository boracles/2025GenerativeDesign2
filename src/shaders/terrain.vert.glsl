precision highp float;

uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform float uSpeed;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

// -------------------------
// Simplex-ish noise (2D)
// -------------------------
vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise2D(vec2 p) {
  const float K1 = 0.366025404; // (sqrt(3)-1)/2
  const float K2 = 0.211324865; // (3-sqrt(3))/6

  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;

  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n = h * h * h * h * vec3(dot(hash(i + 0.0), a), dot(hash(i + o), b), dot(hash(i + 1.0), c));
  return dot(n, vec3(70.0));
}

float fbm(vec2 p) {
  float f = 0.0;
  float a = 0.5;
  float fr = 1.0;
  for(int i = 0; i < 5; i++) {
    f += a * noise2D(p * fr);
    fr *= 2.0;
    a *= 0.5;
  }
  return f;
}

// Three.js가 아래 변수/행렬/속성은 자동 주입하므로 재선언 금지!
// - attribute: position, normal
// - uniform: modelMatrix, modelViewMatrix, projectionMatrix, normalMatrix

void main() {
  // xz에서 흐르는 노이즈 + 약간의 인공 밴딩
  vec2 p = position.xz * uFreq + vec2(uTime * uSpeed, 0.0);
  float band = 0.08 * sin(position.x * 0.07 + uTime * 0.4);

  float h = fbm(p) + band;
  float y = h * uAmp;
  vec3 displaced = vec3(position.x, y, position.z);

  // 월드 좌표 & 노멀
  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = worldPos.xyz;

  // 간단: 원 노멀 사용 (정밀은 미분 노멀 계산)
  vNormal = normalize(normalMatrix * normal);
  vHeight = y;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}

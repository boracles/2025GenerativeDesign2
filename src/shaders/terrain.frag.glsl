precision highp float;

uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uLightDir;

// 커스텀 안개
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

float lambert(vec3 n, vec3 l) {
  return max(dot(normalize(n), normalize(l)), 0.0);
}

void main() {
  // 고도 기반 색 혼합
  float h = clamp((vHeight + 4.0) / 8.0, 0.0, 1.0);
  vec3 baseCol = mix(uColorA, uColorB, smoothstep(0.0, 1.0, h));

  // 간단 조명
  float diff = lambert(vNormal, uLightDir);
  float amb = 0.35;
  vec3 color = baseCol * (amb + 0.9 * diff);

  // 커스텀 안개 (월드 원점 기준 근사)
  float dist = length(vWorldPos);
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  color = mix(color, uFogColor, fogF);

  gl_FragColor = vec4(color, 1.0);
}

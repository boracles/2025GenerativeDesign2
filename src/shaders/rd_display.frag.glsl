precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uState;  // RG=U,V

void main() {
  vec2 uv = texture(uState, vUv).rg; // U,V
  float U = uv.r;
  float V = uv.g;
  // V가 있는 곳을 밝게 보여줌 (시드 점 확인용)
  float c = mix(0.12, 1.0, V);
  outColor = vec4(vec3(c), 1.0);
}
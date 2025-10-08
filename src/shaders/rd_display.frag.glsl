// rd_display.frag.glsl  (청록 팔레트)
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uState; // RG=U,V

const vec3 TEAL_LIGHT = vec3(1.0, 1.0, 1.0); // 흰색
const vec3 TEAL_DARK = vec3(11.0 / 255.0, 104.0 / 255.0, 133.0 / 255.0); // #0B6885

void main() {
  vec2 uv = texture(uState, vUv).rg; // U,V
  float V = uv.g;
  vec3 col = mix(TEAL_DARK, TEAL_LIGHT, smoothstep(0.0, 1.0, V));
  outColor = vec4(col, 1.0);
}

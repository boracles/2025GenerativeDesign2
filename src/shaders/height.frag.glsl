//height.frag.glsl
#ifdef GL_ES
precision highp float;
#endif

void main() {
  vec2 uv = gl_FragCoord.xy * texel;
  float h, hBase, r;
  vec3 col;
  terracing(uv, h, hBase, r, col);
  gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
}

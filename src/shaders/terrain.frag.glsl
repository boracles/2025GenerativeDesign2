//terrain.frag.glsl
precision mediump float;

uniform vec3 uTintA;
uniform vec3 uTintB;
uniform vec3 uTintC;
varying float vH;

void main() {
  // 분포 밝게 펴주기
  float h = pow(clamp(vH, 0.0, 1.0), 0.85);  // 0.85~0.9 권장

  vec3 c1 = mix(uTintA, uTintB, smoothstep(0.15, 0.75, h));
  vec3 c2 = mix(c1, uTintC, smoothstep(0.55, 0.95, h));

  gl_FragColor = vec4(c2, 1.0);
}

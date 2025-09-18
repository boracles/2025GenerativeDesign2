precision highp float;
uniform sampler2D heightTex;
uniform sampler2D heightTexBlur;
uniform vec2 texel;
uniform float strength;
uniform int bands;

void main() {
  vec2 uv = gl_FragCoord.xy * texel;

  // 샤프 높이와 블러 높이
  float hs = texture2D(heightTex, uv).r;
  float hb = texture2D(heightTexBlur, uv).r;

  // 밴드 경계 마스크: 경계 가까울수록 1
  float N = float(bands);
  float d = min(fract(hs * N), 1.0 - fract(hs * N));
  float k = 1.0 - smoothstep(0.0, fwidth(hs * N) * 4.0, d);

  // 에지일 때만 블러 쪽으로 70% 섞기
  float hC = mix(hs, hb, 0.7 * k);

  float hL = mix(texture2D(heightTex, uv - vec2(texel.x, 0.0)).r, texture2D(heightTexBlur, uv - vec2(texel.x, 0.0)).r, 0.7 * k);
  float hR = mix(texture2D(heightTex, uv + vec2(texel.x, 0.0)).r, texture2D(heightTexBlur, uv + vec2(texel.x, 0.0)).r, 0.7 * k);
  float hD = mix(texture2D(heightTex, uv - vec2(0.0, texel.y)).r, texture2D(heightTexBlur, uv - vec2(0.0, texel.y)).r, 0.7 * k);
  float hU = mix(texture2D(heightTex, uv + vec2(0.0, texel.y)).r, texture2D(heightTexBlur, uv + vec2(0.0, texel.y)).r, 0.7 * k);

  vec3 n = normalize(vec3((hL - hR) * strength, (hD - hU) * strength, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
precision highp int;
#else
precision mediump float;
precision mediump int;
#endif

uniform bool uCAEnable;
uniform int uCABirthMask;
uniform int uCASurviveMask;
uniform int uCANeigh;         // 0=Moore, 1=vonNeumann
uniform int uCAIterations;    // JS 핑퐁
uniform float uCAThreshold;     // 0..1
uniform float uCAJitter;        // 0..1
uniform float uCASeed;
uniform vec2 uTexel;
// ★ 상태 채널: 0=alpha, 1=luma
uniform int uCAStateChan;

uniform sampler2D uSource;
uniform sampler2D uPrev;

float hash21(vec2 p) {
  p = fract(p * vec2(443.8975, 441.423));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

int state01(sampler2D tex, vec2 uv, float th) {
  vec4 t = texture2D(tex, uv);
  float v;
  if(uCAStateChan == 1 && uCAIterations == 1) {
    // 첫 스텝에서만 루마 사용 (초기 scatter → 상태화)
    v = luma(t.rgb);
  } else {
    // 이후 스텝은 항상 알파(=CA 상태) 사용
    v = t.a;
  }
  return (v >= th) ? 1 : 0;
}

int neighSum(sampler2D tex, vec2 uv, int mode, float th, vec2 texel) {
  int s = 0;
  if(mode == 0) {
    vec2 o[8];
    o[0] = vec2(-texel.x, -texel.y);
    o[1] = vec2(0.0, -texel.y);
    o[2] = vec2(texel.x, -texel.y);
    o[3] = vec2(-texel.x, 0.0);
    o[4] = vec2(texel.x, 0.0);
    o[5] = vec2(-texel.x, texel.y);
    o[6] = vec2(0.0, texel.y);
    o[7] = vec2(texel.x, texel.y);
    for(int i = 0; i < 8; i++) s += state01(tex, uv + o[i], th);
  } else {
    vec2 o4[4];
    o4[0] = vec2(0.0, -texel.y);
    o4[1] = vec2(-texel.x, 0.0);
    o4[2] = vec2(texel.x, 0.0);
    o4[3] = vec2(0.0, texel.y);
    for(int i = 0; i < 4; i++) s += state01(tex, uv + o4[i], th);
  }
  return s;
}

int bitOn(int mask, int k) {
#if __VERSION__ >= 300
  return (mask >> k) & 1;
#else
  int sh = int(exp2(float(k)));
  return (mask / sh) % 2;
#endif
}

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 srcRGB = texture2D(uSource, uv).rgb;

  int s0 = state01(uPrev, uv, uCAThreshold);
  int n = neighSum(uPrev, uv, uCANeigh, uCAThreshold, uTexel);
  int b = bitOn(uCABirthMask, n);
  int sv = bitOn(uCASurviveMask, n);

  int s1;
  if(s0 == 0) {
    if(b == 1) {
      if(uCAJitter > 0.0) {
        float r = hash21(uv * 1237.123 + uCASeed);
        s1 = (r > uCAJitter) ? 1 : 0;
      } else
        s1 = 1;
    } else
      s1 = 0;
  } else {
    s1 = (sv == 1) ? 1 : 0;
  }

  gl_FragColor = vec4(srcRGB, float(s1));
}

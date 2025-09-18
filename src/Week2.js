import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "https://cdn.jsdelivr.net/npm/lil-gui@0.18/+esm";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1.0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const SIZE = 3.4 * 3;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8cd1e4);
scene.fog = new THREE.Fog(0x8cd1e4, SIZE * 0.05, SIZE * 1.2);

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;

const camera = new THREE.PerspectiveCamera(
  60,
  innerWidth / innerHeight,
  0.1,
  300
);
camera.position.set(3.2, 2.2, 3.2);

const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
  samples: renderer.capabilities.isWebGL2 ? 4 : 0,
});
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));

const fxaa = new ShaderPass(FXAAShader);
fxaa.material.uniforms["resolution"].value.set(1 / innerWidth, 1 / innerHeight);
composer.addPass(fxaa);

const smaaPass = new SMAAPass(innerWidth, innerHeight);
composer.addPass(smaaPass);

const aniso = 1;

// BGM
const BGM_SRC = new URL("./assets/audio/Hilighter.mp3", import.meta.url).href;

const bgm = new Audio();
bgm.src = BGM_SRC;
bgm.preload = "auto";
bgm.loop = true;
bgm.volume = 0.35;
bgm.setAttribute("playsinline", "");
document.body.appendChild(bgm);

// 디버그
bgm.addEventListener("error", () => console.warn("[bgm error]", bgm.error));

// “소리 켜기” 프롬프트
const promptBtn = document.createElement("button");
promptBtn.textContent = "🔊 소리 켜기";
Object.assign(promptBtn.style, {
  position: "fixed",
  left: "50%",
  top: "20px",
  transform: "translateX(-50%)",
  padding: "8px 12px",
  borderRadius: "10px",
  border: "none",
  background: "rgba(0,0,0,.55)",
  color: "#fff",
  fontSize: "14px",
  zIndex: 9999,
  display: "none",
  cursor: "pointer",
});
document.body.appendChild(promptBtn);

function showPrompt() {
  promptBtn.style.display = "block";
}
function hidePrompt() {
  promptBtn.style.display = "none";
}

async function tryPlay(tag) {
  try {
    await bgm.play();
    // console.log("[bgm]", tag, "OK");
    hidePrompt();
    return true;
  } catch (e) {
    // console.warn("[bgm]", tag, e?.name || e);
    return false;
  }
}

// 1) muted 자동재생 트릭: 일부 브라우저에서 허용됨
(async () => {
  bgm.muted = true;
  const ok = await tryPlay("autoplay-muted");
  // 재생이 돌기 시작했으면 살짝 뒤에 언뮤트 시도
  if (ok)
    setTimeout(() => {
      bgm.muted = false;
    }, 120);
  else showPrompt(); // 막히면 버튼 보이기
})();

// 2) 로드/탭 복귀 때 재시도
addEventListener("load", () => tryPlay("load"));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tryPlay("visible");
});

// 3) 어떤 제스처든 재시도(마우스/터치/키보드)
function gestureStart() {
  bgm.muted = false; // 제스처 순간에 언뮤트+재생
  tryPlay("gesture");
  hidePrompt();
}
["pointerdown", "click", "keydown", "touchstart"].forEach((ev) => {
  addEventListener(ev, gestureStart, { passive: true });
});

// 4) 프롬프트 직접 클릭
promptBtn.addEventListener("click", gestureStart);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
controls.update();

const hud = document.getElementById("hud");

let frames = 0;
let lastTime = performance.now();
let fps = 0;

function updateFPS() {
  const now = performance.now();
  frames++;
  if (now - lastTime >= 1000) {
    // 1초마다 계산
    fps = frames;
    frames = 0;
    lastTime = now;
    hud.textContent = `FPS: ${fps} · G: 패널 · R: 리시드`;
  }
}

scene.add(new THREE.AmbientLight(0x3a5060, 1.25));
scene.add(new THREE.HemisphereLight(0x96c8ff, 0x0b1a22, 0.9));
const dir = new THREE.DirectionalLight(0xffffff, 2.6);
dir.position.set(5, 6, 3);
dir.castShadow = false;
dir.shadow.mapSize.set(1024, 1024);
dir.shadow.bias = -0.0005;
scene.add(dir);

/* ─ Params ─ */
const SIM_SIZE = 512;
const params = {
  colCrust: "#DBE3EC",
  colMud: "#FFFFFF",
  waterDeep: "#0DABB3",
  colPoolLo: "#0DABB3",
  colPoolHi: "#92CED8",
  colRim: "#FFFFFF",
  colDry: "#F2F5F9",
  colOxide1: "#C86C1F",
  colOxide2: "#7D3F12",
  Du: 0.16,
  Dv: 0.08,
  F: 0.036,
  K: 0.06,
  stepsPerFrame: 1,
  bands: 10,
  rimWidth: 0.25,
  rimGain: 0.8,
  rimHeightScale: 0.08,
  terrAmp: 1.6,
  macroGain: 0.9,
  macroFreq: 0.52,
  ridgeGain: 0.0,
  seaLevel: 0.48,
  fractureFreq: 9.0,
  cellJitter: 0.6,
  rimMicro: 5.0,
  growSpeed: 0.2,
  disp: 1.6,
  stepContrast: 0.2,
  stepVar: 0.45,
  minStep: 0.028,
  bevel: 0.9,
  bevelGain: 0.8,
  oxideHalo: 0.35,
  bandJitter: 0.18,
  rimNoiseAmp: 0.05,
  macroFreq2: 0.55,
  macroMix: 0.68,
  ventAmp: 0.0,
  ventFreq: 9.0,
  ventGrow: 0.22,
  bulgeWidth: 4.6,
  bulgeGain: 3.1,
  rimAlphaCore: 1.0,
  rimAlphaBulge: 0.55,
  stainAmp: 0.12,
  stainScale: 6.0,
  grainAmp: 0.02,
  grainScale: 90.0,
  stainSpeed: 0.06,
  bumpAmp: 0.003,
  bumpScale: 55.0,
  bumpSpeed: 0.08,
  rimWhite: 1.0,
  rimWhitePow: 0.8,
  sideWhite: 1.0, // 옆면 화이트 강도(0~1)
  sideStart: 0.1, // 슬로프 시작(0=수평, 1=수직)에서 서서히 하양
  sideEnd: 0.55, // 슬로프 끝(더 가파를수록 1에 가까움)
  sideTint: "#FFFFFF", // 옆면 틴트 컬러
  sideSharp: 1.2,
  normStrength: 10.0, // 노멀 강도(경사 민감도)
  sideRad: 4.0, // 옆면 감지 반경(텍셀 단위, 2.0~4.0 권장)
  sideA: 0.02, // height 기울기 마스크 시작 임계
  sideB: 0.1, // height 기울기 마스크 끝 임계 (강해짐)
  crestLo: 0.004, // 능선 감지 하한(작게)  → 낮을수록 더 많이 잡음
  crestHi: 0.03, // 능선 감지 상한(크게)  → 높을수록 더 세게 잡음
  toneLow: 0.3, // 하부 어두움 강도
  toneHigh: 1.6, // 상부 밝음 강도
  toneGamma: 1.2,
  baseDarkMin: 0.4, // 하부 색 배율 (낮을수록 더 어두움)
  baseDarkMax: 1.0, // 정상 색 배율
  baseDarkEnd: 0.25, // 어두움 적용이 끝나는 높이 (0~1)
  bandToneFeather: 1.2,
};
let seed = Math.random() * 1000;

/* ───────── Ping-Pong (U,V) ───────── */
const isWebGL2 = renderer.capabilities.isWebGL2;
const rtType = isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
function makeRT() {
  return new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
    type: rtType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
}
let rdA = makeRT(),
  rdB = makeRT();

const fsScene = new THREE.Scene();
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.MeshBasicMaterial()
);
fsScene.add(fsQuad);

/* GLSL Noise */
const GLSL_NOISE = `
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
          float noise(vec2 p){
            vec2 i=floor(p), f=fract(p);
            float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
            vec2 u=f*f*(3.0-2.0*f);
            return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
          }
          float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<6;i++){ v+=a*noise(p); p*=2.0; a*=0.5; } return v; }`;

/* ───────── Init (seed & coast) ───────── */
const initMat = new THREE.ShaderMaterial({
  uniforms: {
    resolution: { value: new THREE.Vector2(SIM_SIZE, SIM_SIZE) },
    seaLevel: { value: params.seaLevel },
    seed: { value: seed },
  },
  vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
              precision highp float;
      uniform vec2  resolution;
      uniform float seaLevel;
      uniform float seed;
      ${GLSL_NOISE}
      void main(){
        vec2 uv = gl_FragCoord.xy / resolution;

        float U = 1.0, V = 0.0;
        float m = fbm(uv*0.9 + seed*0.01);
        float coast = 1.0 - smoothstep(0.0, 0.10, abs(m - seaLevel));

        // ★ r1, r2 다시 정의
        float r1 = noise(uv*53.1 + seed*0.37);
        float r2 = noise(uv*71.7 + seed*1.23);

        // ★ 소프트 임계 (해상도 기반)
        float t1 = mix(0.84, 0.74, coast);
        vec2 texel = 1.0 / resolution;
        float aa = max(texel.x, texel.y) * 1.5;

        float v1 = smoothstep(t1 - 3.0*aa, t1 + 3.0*aa, r1);
        float v2 = smoothstep(0.92 - 3.0*aa, 0.92 + 3.0*aa, r2);

        V = clamp(max(v1, v2), 0.0, 1.0);
        U = 1.0 - V;

        gl_FragColor = vec4(U, V, 0.0, 1.0);
      }
            `,
});

const blurMat = new THREE.ShaderMaterial({
  uniforms: {
    tex: { value: rdA.texture },
    texel: { value: new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE) },
  },
  vertexShader: `void main(){ gl_Position=vec4(position,1.0); }`,
  fragmentShader: `
          uniform sampler2D tex; uniform vec2 texel;
          void main(){
            vec2 uv = gl_FragCoord.xy * texel;
            vec4 c  = texture2D(tex, uv) * 0.4;
            c += 0.1 * texture2D(tex, uv + vec2( texel.x, 0.0));
            c += 0.1 * texture2D(tex, uv + vec2(-texel.x, 0.0));
            c += 0.1 * texture2D(tex, uv + vec2(0.0,  texel.y));
            c += 0.1 * texture2D(tex, uv + vec2(0.0, -texel.y));
            c += 0.05* texture2D(tex, uv + vec2( texel.x,  texel.y));
            c += 0.05* texture2D(tex, uv + vec2( texel.x, -texel.y));
            c += 0.05* texture2D(tex, uv + vec2(-texel.x,  texel.y));
            c += 0.05* texture2D(tex, uv + vec2(-texel.x, -texel.y));
            gl_FragColor = c;
          }`,
});

function blurOnce() {
  fsQuad.material = blurMat;
  renderer.setRenderTarget(rdB);
  renderer.render(fsScene, fsCam);
  renderer.setRenderTarget(null);
  const t = rdA;
  rdA = rdB;
  rdB = t; // swap
}

function runInit() {
  fsQuad.material = initMat;
  renderer.setRenderTarget(rdA);
  renderer.render(fsScene, fsCam);
  renderer.setRenderTarget(null);
}
runInit();
blurOnce();

/* ─ RD Step ─ */
const simMat = new THREE.ShaderMaterial({
  uniforms: {
    prevTex: { value: rdA.texture },
    texel: { value: new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE) },
    Du: { value: params.Du },
    Dv: { value: params.Dv },
    F: { value: params.F },
    K: { value: params.K },
    seed: { value: seed },
  },
  vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
  fragmentShader: `
            precision highp float;
            uniform sampler2D prevTex;
            uniform vec2 texel;
            uniform float Du,Dv,F,K,seed;
            ${GLSL_NOISE}
            void main(){
              vec2 uv = gl_FragCoord.xy * texel;
              vec4 c = texture2D(prevTex, uv);
              float U=c.r, V=c.g;

              // 기존 4방향 샘플 외에 대각선 샘플 추가
              float Ulu = texture2D(prevTex, uv + vec2(-texel.x,  texel.y)).r;
              float Uru = texture2D(prevTex, uv + vec2( texel.x,  texel.y)).r;
              float Uld = texture2D(prevTex, uv + vec2(-texel.x, -texel.y)).r;
              float Urd = texture2D(prevTex, uv + vec2( texel.x, -texel.y)).r;

              float Vlu = texture2D(prevTex, uv + vec2(-texel.x,  texel.y)).g;
              float Vru = texture2D(prevTex, uv + vec2( texel.x,  texel.y)).g;
              float Vld = texture2D(prevTex, uv + vec2(-texel.x, -texel.y)).g;
              float Vrd = texture2D(prevTex, uv + vec2( texel.x, -texel.y)).g;

              // 4방향 샘플 추가
      float Ul = texture2D(prevTex, uv - vec2(texel.x, 0.0)).r;
      float Ur = texture2D(prevTex, uv + vec2(texel.x, 0.0)).r;
      float Uu = texture2D(prevTex, uv + vec2(0.0, texel.y)).r;
      float Ud = texture2D(prevTex, uv - vec2(0.0, texel.y)).r;

      float Vl = texture2D(prevTex, uv - vec2(texel.x, 0.0)).g;
      float Vr = texture2D(prevTex, uv + vec2(texel.x, 0.0)).g;
      float Vu = texture2D(prevTex, uv + vec2(0.0, texel.y)).g;
      float Vd = texture2D(prevTex, uv - vec2(0.0, texel.y)).g;

      // Laplacian
      float lapU = (Ul+Ur+Uu+Ud + 0.25*(Ulu+Uru+Uld+Urd)) - 5.0*U;
      float lapV = (Vl+Vr+Vu+Vd + 0.25*(Vlu+Vru+Vld+Vrd)) - 5.0*V;


              float fVar=fbm(uv*0.6 + seed*0.013);
              float kVar=fbm(uv*0.6 - seed*0.011);
              float Fxy=F + (fVar-0.5)*0.010;
              float Kxy=K + (kVar-0.5)*0.010;

              float uvv = U*V*V;
              float Un = U + (Du*lapU - uvv + Fxy*(1.0-U));
              float Vn = V + (Dv*lapV + uvv - (Fxy+Kxy)*V);
              gl_FragColor = vec4(clamp(Un,0.0,1.0), clamp(Vn,0.0,1.0), 0.0, 1.0);
            }`,
});
function stepRD() {
  for (let s = 0; s < params.stepsPerFrame; s++) {
    simMat.uniforms.prevTex.value = rdA.texture;
    fsQuad.material = simMat;
    renderer.setRenderTarget(rdB);
    renderer.render(fsScene, fsCam);
    renderer.setRenderTarget(null);
    const t = rdA;
    rdA = rdB;
    rdB = t;
  }
}

/* ─ Bake RTs ─ */
function makeBakeRT(format, colorSpace) {
  return new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
    type: THREE.UnsignedByteType,
    format,
    colorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

let tmpA = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  colorSpace: THREE.NoColorSpace,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
});
let tmpB = tmpA.clone();

// ── generic copy material (blit)
const copyMat = new THREE.ShaderMaterial({
  uniforms: {
    tex: { value: null },
    texel: { value: new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE) },
  },
  vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
  fragmentShader: `
          uniform sampler2D tex; uniform vec2 texel;
          void main(){
            vec2 uv = gl_FragCoord.xy * texel;
            gl_FragColor = texture2D(tex, uv);
          }`,
});

function blurRTInPlace(rt, passes = 2) {
  // 입력 텍스처 체인
  let srcTex = rt.texture;

  for (let i = 0; i < passes; i++) {
    // pass i: srcTex -> tmpA
    blurMat.uniforms.tex.value = srcTex;
    fsQuad.material = blurMat;
    renderer.setRenderTarget(tmpA);
    renderer.render(fsScene, fsCam);
    renderer.setRenderTarget(null);

    // 다음 패스 입력 준비 (ping-pong)
    srcTex = tmpA.texture;

    const t = tmpA;
    tmpA = tmpB;
    tmpB = t;
  }

  copyMat.uniforms.tex.value = srcTex;
  fsQuad.material = copyMat;
  renderer.setRenderTarget(rt);
  renderer.render(fsScene, fsCam);
  renderer.setRenderTarget(null);

  rt.texture.needsUpdate = true;
}

const heightRT = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  colorSpace: THREE.NoColorSpace,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  wrapS: THREE.ClampToEdgeWrapping,
  wrapT: THREE.ClampToEdgeWrapping,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
});

const heightBlurRT = new THREE.WebGLRenderTarget(SIM_SIZE >> 1, SIM_SIZE >> 1, {
  type: THREE.UnsignedByteType,
  format: THREE.RGBAFormat,
  colorSpace: THREE.NoColorSpace,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  wrapS: THREE.ClampToEdgeWrapping,
  wrapT: THREE.ClampToEdgeWrapping,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
});

const heightRT_smooth = heightRT.clone();

const edgeSoftenMat = new THREE.ShaderMaterial({
  uniforms: {
    heightTex: { value: heightRT.texture },
    texel: { value: new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE) },
    bands: { value: params.bands },
    radius: { value: 1.0 }, // 1.0~1.5 권장
    edgeBoost: { value: 2.5 }, // fwidth 계수
    mixAmt: { value: 0.75 }, // 경계에서 섞는 비율
  },
  vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D heightTex;
    uniform vec2  texel;
    uniform int   bands;
    uniform float radius, edgeBoost, mixAmt;
    void main(){
      vec2 uv = gl_FragCoord.xy * texel;
      float h  = texture2D(heightTex, uv).r;
      float N = float(bands);
      float d = min(fract(h*N), 1.0 - fract(h*N));
      float wpx = fwidth(h*N) * edgeBoost;
      float k = 1.0 - smoothstep(0.0, wpx, d);

      vec2 o[8];
      o[0]=vec2( texel.x, 0.0); o[1]=vec2(-texel.x, 0.0);
      o[2]=vec2(0.0,  texel.y); o[3]=vec2(0.0, -texel.y);
      o[4]=vec2( texel.x,  texel.y); o[5]=vec2( texel.x, -texel.y);
      o[6]=vec2(-texel.x,  texel.y); o[7]=vec2(-texel.x, -texel.y);

      float acc = h, wsum = 1.0;
      for(int i=0;i<8;i++){
        float hi = texture2D(heightTex, uv + o[i]*radius).r;
        float di = min(fract(hi*N), 1.0 - fract(hi*N));
        float wi = 1.0 - smoothstep(0.0, wpx, di);
        acc += hi * wi;
        wsum += wi;
      }
      float hEdge = acc / max(wsum, 1e-4);
      float hOut = mix(h, hEdge, mixAmt * k);
      gl_FragColor = vec4(hOut, 0.0, 0.0, 1.0);
    }`,
});

const colorRT = makeBakeRT(THREE.RGBAFormat, THREE.NoColorSpace);

// Normal map bake targets & material
const normalRT = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
  type: THREE.UnsignedByteType,
  format: THREE.RGBAFormat,
  colorSpace: THREE.NoColorSpace,
});

/* ─ Bake Shaders ─ */

// ① 파일 로더
async function loadShader(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + " load fail " + r.status);
  return r.text();
}

// ② 외부 GLSL 로드
const [COMMON, FRAG_HEIGHT, FRAG_NORMAL, FRAG_COLOR] = await Promise.all([
  loadShader("./src/shaders/common.glsl"),
  loadShader("./src/shaders/height.frag.glsl"),
  loadShader("./src/shaders/normal.frag.glsl"),
  loadShader("./src/shaders/color.frag.glsl"),
]);

const bakeUniforms = {
  time: { value: 0.0 },
  stainAmp: { value: params.stainAmp },
  grainAmp: { value: params.grainAmp },
  stainScale: { value: params.stainScale },
  grainScale: { value: params.grainScale },
  stainSpeed: { value: params.stainSpeed },
  rimHeightScale: { value: params.rimHeightScale },
  growthPhase: { value: 0.0 },
  microFactor: { value: params.rimMicro },
  stepContrast: { value: params.stepContrast },
  stepVar: { value: params.stepVar },
  minStep: { value: params.minStep },
  bevel: { value: params.bevel },
  bevelGain: { value: params.bevelGain },
  oxideHalo: { value: params.oxideHalo },
  macroFreq2: { value: params.macroFreq2 },
  macroMix: { value: params.macroMix },
  bandJitter: { value: params.bandJitter },
  rimNoiseAmp: { value: params.rimNoiseAmp },
  colCrust: { value: new THREE.Color(params.colCrust) },
  colMud: { value: new THREE.Color(params.colMud) },
  waterDeep: { value: new THREE.Color(params.waterDeep) },
  rdTex: { value: rdA.texture },
  texel: { value: new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE) },
  seed: { value: seed },
  seaLevel: { value: params.seaLevel },
  macroGain: { value: params.macroGain },
  ridgeGain: { value: params.ridgeGain },
  bands: { value: params.bands },
  rimWidth: { value: params.rimWidth },
  rimGain: { value: params.rimGain },
  wallSharp: { value: 2.4 },
  colPoolLo: { value: new THREE.Color(params.colPoolLo) },
  colPoolHi: { value: new THREE.Color(params.colPoolHi) },
  colRim: { value: new THREE.Color(params.colRim) },
  colDry: { value: new THREE.Color(params.colDry) },
  colOxide1: { value: new THREE.Color(params.colOxide1) },
  colOxide2: { value: new THREE.Color(params.colOxide2) },
  macroFreq: { value: params.macroFreq },
  ventAmp: { value: params.ventAmp },
  ventFreq: { value: params.ventFreq },
  ventGrow: { value: params.ventGrow },
  terrAmp: { value: params.terrAmp },
  fractureFreq: { value: params.fractureFreq },
  cellJitter: { value: params.cellJitter },
  bulgeWidth: { value: params.bulgeWidth },
  bulgeGain: { value: params.bulgeGain },
  rimAlphaCore: { value: params.rimAlphaCore },
  rimAlphaBulge: { value: params.rimAlphaBulge },
  bumpAmp: { value: params.bumpAmp },
  bumpScale: { value: params.bumpScale },
  bumpSpeed: { value: params.bumpSpeed },
  rimWhite: { value: params.rimWhite },
  rimWhitePow: { value: params.rimWhitePow },
  sideWhite: { value: params.sideWhite },
  sideStart: { value: params.sideStart },
  sideEnd: { value: params.sideEnd },
  sideTint: { value: new THREE.Color(params.sideTint) },
  sideSharp: { value: params.sideSharp },
  sideRad: { value: params.sideRad },
  sideA: { value: params.sideA },
  sideB: { value: params.sideB },
  crestLo: { value: params.crestLo },
  crestHi: { value: params.crestHi },
  toneLow: { value: params.toneLow },
  toneHigh: { value: params.toneHigh },
  toneGamma: { value: params.toneGamma },
  toneLow: { value: params.toneLow },
  toneHigh: { value: params.toneHigh },
  toneGamma: { value: params.toneGamma },
  baseDarkMin: { value: params.baseDarkMin },
  baseDarkMax: { value: params.baseDarkMax },
  baseDarkEnd: { value: params.baseDarkEnd },
  bandToneFeather: { value: params.bandToneFeather },
};

const heightMat = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.clone(bakeUniforms),
  vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
  fragmentShader: COMMON + "\n" + FRAG_HEIGHT,
});

const colorMat = new THREE.ShaderMaterial({
  uniforms: Object.assign(THREE.UniformsUtils.clone(bakeUniforms), {
    normalTex: { value: normalRT.texture },
    heightTexSharp: { value: heightRT.texture }, // 샤프
    heightTexBlur: { value: heightBlurRT.texture }, // 블러
  }),
  vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
  fragmentShader: COMMON + "\n" + FRAG_COLOR,
});

const normalMat = new THREE.ShaderMaterial({
  uniforms: {
    heightTex: { value: heightRT.texture },
    heightTexBlur: { value: heightBlurRT.texture },
    texel: { value: new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE) },
    strength: { value: 1.0 },
    bands: { value: params.bands },
  },
  vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
  fragmentShader: FRAG_NORMAL,
});

function blurInto(srcTex, dstRT, passes = 2) {
  let src = srcTex;
  for (let i = 0; i < 1; i++) {
    blurMat.uniforms.tex.value = src;
    fsQuad.material = blurMat;
    renderer.setRenderTarget(tmpA);
    renderer.render(fsScene, fsCam);
    renderer.setRenderTarget(null);
    src = tmpA.texture;
    const t = tmpA;
    tmpA = tmpB;
    tmpB = t;
  }
  copyMat.uniforms.tex.value = src;
  fsQuad.material = copyMat;
  renderer.setRenderTarget(dstRT);
  renderer.render(fsScene, fsCam);
  renderer.setRenderTarget(null);
  dstRT.texture.needsUpdate = true;
  dstRT.texture.generateMipmaps = false;
  dstRT.texture.minFilter = THREE.LinearFilter;
}

/* ───────── Bake Runner ───────── */
const bakeScene = new THREE.Scene();
const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), heightMat);
bakeScene.add(bakeQuad);

const GROW_SPAN = 0.8; // terracing()에서 쓰는 span과 동일
let growthPhase = -GROW_SPAN;
let blurTimer = 0;
let frameCount = 0;
function bake(dt) {
  const mats = [heightMat, colorMat];
  for (const m of mats) {
    m.uniforms.time.value = performance.now() * 0.001;
    m.uniforms.stainAmp.value = params.stainAmp;
    m.uniforms.stainScale.value = params.stainScale;
    m.uniforms.grainAmp.value = params.grainAmp;
    m.uniforms.grainScale.value = params.grainScale;
    m.uniforms.stainSpeed.value = params.stainSpeed;
    m.uniforms.rimHeightScale.value = params.rimHeightScale;
    m.uniforms.microFactor.value = params.rimMicro;
    m.uniforms.terrAmp.value = params.terrAmp;
    m.uniforms.stepContrast.value = params.stepContrast;
    m.uniforms.stepVar.value = params.stepVar;
    m.uniforms.minStep.value = params.minStep;
    m.uniforms.bevel.value = params.bevel;
    m.uniforms.bevelGain.value = params.bevelGain;
    m.uniforms.oxideHalo.value = params.oxideHalo;
    m.uniforms.macroFreq2.value = params.macroFreq2;
    m.uniforms.macroMix.value = params.macroMix;
    m.uniforms.bandJitter.value = params.bandJitter;
    m.uniforms.rimNoiseAmp.value = params.rimNoiseAmp;
    m.uniforms.colCrust.value.set(params.colCrust);
    m.uniforms.colMud.value.set(params.colMud);
    m.uniforms.waterDeep.value.set(params.waterDeep);
    m.uniforms.rdTex.value = rdA.texture;
    m.uniforms.seed.value = seed;
    m.uniforms.seaLevel.value = params.seaLevel;
    m.uniforms.macroGain.value = params.macroGain;
    m.uniforms.ridgeGain.value = params.ridgeGain;
    m.uniforms.bands.value = params.bands;
    m.uniforms.rimWidth.value = params.rimWidth;
    m.uniforms.rimGain.value = params.rimGain;
    m.uniforms.colPoolLo.value.set(params.colPoolLo);
    m.uniforms.colPoolHi.value.set(params.colPoolHi);
    m.uniforms.colRim.value.set(params.colRim);
    m.uniforms.colDry.value.set(params.colDry);
    m.uniforms.colOxide1.value.set(params.colOxide1);
    m.uniforms.colOxide2.value.set(params.colOxide2);
    m.uniforms.ventAmp.value = params.ventAmp;
    m.uniforms.ventFreq.value = params.ventFreq;
    m.uniforms.ventGrow.value = params.ventGrow;
    m.uniforms.bulgeWidth.value = params.bulgeWidth;
    m.uniforms.bulgeGain.value = params.bulgeGain;
    m.uniforms.rimAlphaCore.value = params.rimAlphaCore;
    m.uniforms.rimAlphaBulge.value = params.rimAlphaBulge;
    m.uniforms.bumpAmp.value = params.bumpAmp;
    m.uniforms.bumpScale.value = params.bumpScale;
    m.uniforms.bumpSpeed.value = params.bumpSpeed;
    m.uniforms.rimWhite.value = params.rimWhite;
    m.uniforms.rimWhitePow.value = params.rimWhitePow;
    m.uniforms.macroFreq.value = params.macroFreq;
    m.uniforms.growthPhase.value = growthPhase;
    m.uniforms.sideWhite.value = params.sideWhite;
    m.uniforms.sideStart.value = params.sideStart;
    m.uniforms.sideEnd.value = params.sideEnd;
    m.uniforms.sideTint.value.set(params.sideTint);
    m.uniforms.sideSharp.value = params.sideSharp;
    m.uniforms.sideRad.value = params.sideRad;
    m.uniforms.sideA.value = params.sideA;
    m.uniforms.sideB.value = params.sideB;
    m.uniforms.crestLo.value = params.crestLo;
    m.uniforms.crestHi.value = params.crestHi;
    m.uniforms.baseDarkMin.value = params.baseDarkMin;
    m.uniforms.baseDarkMax.value = params.baseDarkMax;
    m.uniforms.baseDarkEnd.value = params.baseDarkEnd;
    m.uniforms.bandToneFeather.value = params.bandToneFeather;
  }

  // 1) 샤프 높이 굽기
  renderer.setRenderTarget(heightRT);
  bakeQuad.material = heightMat;
  renderer.render(bakeScene, fsCam);
  renderer.setRenderTarget(null);

  // 1.5) ★ 경계 소프트닝(후처리)
  edgeSoftenMat.uniforms.heightTex.value = heightRT.texture;
  edgeSoftenMat.uniforms.bands.value = params.bands;
  // 필요하면 라디오/엣지 계수도 소스 파라미터로 연결
  edgeSoftenMat.uniforms.radius.value = 1.0;
  edgeSoftenMat.uniforms.edgeBoost.value = 3.0;

  bakeQuad.material = edgeSoftenMat;
  renderer.setRenderTarget(heightRT_smooth);
  renderer.render(bakeScene, fsCam);

  // heightRT_smooth → heightRT 로 복사(치환)
  copyMat.uniforms.tex.value = heightRT_smooth.texture;
  fsQuad.material = copyMat;
  renderer.setRenderTarget(heightRT);
  renderer.render(fsScene, fsCam);
  renderer.setRenderTarget(null);

  blurInto(heightRT.texture, heightBlurRT, 1);
  if (frameCount % 2 === 0) {
    blurRTInPlace(heightRT, 1); // 2프레임에 한 번만
  }
  heightRT.texture.needsUpdate = true;
  heightRT.texture.magFilter = THREE.LinearFilter;
  colorRT.texture.anisotropy = aniso;

  // normal
  renderer.setRenderTarget(normalRT);
  normalMat.uniforms.strength.value = params.normStrength;
  normalMat.uniforms.heightTex.value = heightRT.texture; // 샤프
  normalMat.uniforms.heightTexBlur.value = heightBlurRT.texture;
  normalMat.uniforms.bands.value = params.bands;
  bakeQuad.material = normalMat;
  renderer.render(bakeScene, fsCam);
  normalRT.texture.needsUpdate = true;

  // color
  renderer.setRenderTarget(colorRT);
  bakeQuad.material = colorMat;
  // 최신 노멀 바인딩 보장
  colorMat.uniforms.normalTex.value = normalRT.texture;

  colorMat.uniforms.heightTexSharp.value = heightRT.texture; // 샤프(기울기/능선)
  normalMat.uniforms.heightTexBlur.value = heightBlurRT.texture;

  normalRT.texture.minFilter = THREE.LinearFilter;

  renderer.render(bakeScene, fsCam);
  colorRT.texture.anisotropy = aniso;
  colorRT.texture.needsUpdate = true;

  renderer.setRenderTarget(null);

  terrainMat.displacementMap = heightRT.texture;
}

/* ─ Terrain ─ */
const DIV = 512;
const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, DIV, DIV);
terrainGeo.rotateX(-Math.PI / 2);

const terrainMat = new THREE.MeshStandardMaterial({
  map: colorRT.texture,
  displacementMap: heightRT.texture,
  displacementScale: 0.0,
  roughness: 1.0,
  metalness: 0.0,
  transparent: true,
  alphaTest: 0.0,
  emissive: 0x0,
  emissiveIntensity: 0.0,
});
terrainMat.envMapIntensity = 0.3;
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.castShadow = true;
terrain.receiveShadow = true;
scene.add(terrain);

/* ───────── GUI ───────── */
const gui = new GUI({ title: "GPU RD Terraces" });
gui.hide();
gui.add(params, "rimWidth", 0.02, 0.2, 0.002).name("rim width");
gui.add(params, "rimGain", 0.2, 1.2, 0.02).name("rim height");
gui.add(params, "rimAlphaCore", 0.6, 1.5, 0.02).name("rim alpha core");
gui.add(params, "rimAlphaBulge", 0.2, 1.0, 0.02).name("rim alpha bulge");
gui.add(params, "rimWhite", 0.0, 1.0, 0.01).name("rim whiten");
gui.add(params, "rimWhitePow", 0.6, 3.0, 0.05).name("rim whiten gamma");
gui.add(params, "terrAmp", 1.0, 2.2, 0.05).name("height amp");
gui.add(params, "disp", 0.5, 3.0, 0.01).name("displacement");
gui.add(params, "growSpeed", 0.05, 1.5, 0.01).name("growth speed");
gui.add(params, "macroFreq", 0.18, 0.4, 0.005);
gui.add(params, "macroFreq2", 0.3, 1.2, 0.01).name("macro freq (field)");
gui.add(params, "seaLevel", 0.4, 0.55, 0.005);
gui.add(params, "stainAmp", 0.0, 0.2, 0.005);
gui.add(params, "stainScale", 1.0, 15.0, 0.1);
gui.add(params, "grainAmp", 0.0, 0.08, 0.002);
gui.add(params, "grainScale", 20.0, 200.0, 1.0);
gui.add(params, "stainSpeed", 0.0, 0.3, 0.005);
gui.add(params, "normStrength", 1.0, 20.0, 0.5).name("normal strength");
gui.add(params, "sideRad", 1.0, 5.0, 0.1).name("side radius");
gui.add(params, "sideA", 0.005, 0.05, 0.002).name("sideA (grad)");
gui.add(params, "sideB", 0.03, 0.2, 0.005).name("sideB (grad)");
gui.add(params, "crestLo", 0.001, 0.02, 0.001).name("crest lo");
gui.add(params, "crestHi", 0.005, 0.05, 0.001).name("crest hi");
gui.add(params, "toneLow", 0.2, 1.0, 0.05).name("tone low");
gui.add(params, "toneHigh", 1.0, 2.0, 0.05).name("tone high");
gui.add(params, "toneGamma", 0.3, 1.5, 0.05).name("tone gamma");

addEventListener("keydown", (e) => {
  const k = (e.key || "").toLowerCase();
  if (k === "g") {
    gui._hidden ? gui.show() : gui.hide();
    gui._hidden = !gui._hidden;
  }
  if (k === "r") {
    seed = Math.random() * 1000;
    initMat.uniforms.seed.value = seed;
    simMat.uniforms.seed.value = seed;
    heightMat.uniforms.seed.value = seed;
    colorMat.uniforms.seed.value = seed;
    runInit();
  }
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  fxaa.material.uniforms["resolution"].value.set(
    1 / innerWidth,
    1 / innerHeight
  );
});

/* ─ Loop ─ */
const clock = new THREE.Clock();
// 최초 한 번 굽고 시작(노멀/컬러 비어있는 상태 방지)
stepRD();
bake();

function animate() {
  const dt = clock.getDelta();
  frameCount++;

  growthPhase = Math.min(params.bands, growthPhase + params.growSpeed * dt);

  terrainMat.displacementScale = params.disp;
  terrainMat.map = colorRT.texture;
  terrainMat.map.colorSpace = THREE.NoColorSpace;
  terrainMat.roughness = 1.0;
  terrainMat.metalness = 0.0;
  terrainMat.normalMap = normalRT.texture;
  terrainMat.normalMap.colorSpace = THREE.NoColorSpace;
  terrainMat.normalScale.set(6.0, -6.0);

  let bakedHeightFrame = -999,
    bakedNormalFrame = -999;
  if (frameCount % 3 === 0) stepRD();
  if (frameCount % 8 === 0) bake();

  controls.update();
  composer.render();

  updateFPS();
  requestAnimationFrame(animate);
}
animate();

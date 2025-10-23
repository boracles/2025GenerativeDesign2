import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "https://cdn.jsdelivr.net/npm/lil-gui@0.18/+esm";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { LOD } from "three";

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setSize(innerWidth, innerHeight);

const DPR = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);

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
  samples: 0,
});
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));

const fxaa = new ShaderPass(FXAAShader);
fxaa.material.uniforms["resolution"].value.set(1 / innerWidth, 1 / innerHeight);

const smaaPass = new SMAAPass(innerWidth, innerHeight);
composer.addPass(smaaPass);
smaaPass.setSize(innerWidth * DPR, innerHeight * DPR);

const aniso = 1;

const bgm = /** @type {HTMLAudioElement} */ (document.getElementById("bgm"));

const bgmUrl = new URL("../assets/audio/Hilighter.mp3?v=3", import.meta.url);
bgm.src = bgmUrl.href;

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

const showPrompt = () => (promptBtn.style.display = "block");
const hidePrompt = () => (promptBtn.style.display = "none");

async function unlockAudio() {
  try {
    bgm.muted = false;
    if (bgm.paused) await bgm.play();
    hidePrompt();
    removeUnlockers();
  } catch {
    showPrompt();
  }
}

function addUnlockers() {
  const opts = { once: true, passive: true };
  addEventListener("pointerdown", unlockAudio, opts);
  addEventListener("touchstart", unlockAudio, opts);
  addEventListener("click", unlockAudio, opts);
  addEventListener("keydown", unlockAudio, opts);
  promptBtn.addEventListener("click", unlockAudio, { once: true });
}
function removeUnlockers() {
  removeEventListener("pointerdown", unlockAudio);
  removeEventListener("touchstart", unlockAudio);
  removeEventListener("click", unlockAudio);
  removeEventListener("keydown", unlockAudio);
  promptBtn.removeEventListener("click", unlockAudio);
}

addUnlockers();
showPrompt();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !bgm.muted && bgm.paused) {
    bgm.play().catch(showPrompt);
  }
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted && !bgm.muted && bgm.paused) {
    bgm.play().catch(showPrompt);
  }
});

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
  growSpeed: 0.4,
  disp: 2.0,
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
  bandToneFeather: 1.8,
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

// ─── 파일 상단 전역 ───
let needBake = false;

// 안전 큐잉 함수
const queueBake = () => {
  needBake = true;
};

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

// 디스플레이스 전용: 풀해상도 블러 높이
const heightDispRT = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
  type: THREE.HalfFloatType, // heightRT와 동일
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

const [
  COMMON,
  FRAG_HEIGHT,
  FRAG_NORMAL,
  FRAG_COLOR,
  MASK_FRAG,
  SCATTER_FRAG_GLSL,
  CA_FRAG_GLSL, // ← 추가
] = await Promise.all([
  loadShader("./src/shaders/common.glsl"),
  loadShader("./src/shaders/height.frag.glsl"),
  loadShader("./src/shaders/normal.frag.glsl"),
  loadShader("./src/shaders/color.frag.glsl"),
  loadShader("./src/shaders/terrainMasks.frag.glsl"),
  loadShader("./src/shaders/scatter.frag.glsl"),
  loadShader("./src/shaders/ca.frag.glsl"), // ← 추가
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

const maskMat = new THREE.ShaderMaterial({
  uniforms: {
    heightTex: { value: heightRT.texture }, // heightRT_smooth 복사 후의 heightRT
    texel: { value: new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE) },
    slopeScale: { value: 120.0 },
    curvScale: { value: 2.0 },
  },
  vertexShader: `void main(){ gl_Position=vec4(position,1.0); }`,
  fragmentShader: MASK_FRAG,
});

const maskRT = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
});
maskRT.texture.colorSpace = THREE.NoColorSpace;
maskRT.texture.generateMipmaps = false;
maskRT.texture.minFilter = THREE.LinearFilter;
maskRT.texture.magFilter = THREE.LinearFilter;

// 파일 위쪽(전역)에 한 번만
const __ray = new THREE.Raycaster();
const __vFrom = new THREE.Vector3();
const __vDir = new THREE.Vector3(0, -1, 0);

// === PDS: density 읽기 준비 ===
const pdsBuf = new Uint8Array(SIM_SIZE * SIM_SIZE * 4);

function sstep(edge, width, x) {
  const e0 = edge - width;
  const e1 = edge + width;
  // THREE의 smoothstep은 [e0, e1]에서 0→1 이라서, 1-… 로 뒤집어줍니다.
  return 1.0 - THREE.MathUtils.smoothstep(e0, e1, x);
}

function readMaskToDensity(species /* 'plant' | 'crab' */, scale /* 0..1 */) {
  // maskRT 최신 내용을 CPU 버퍼로 읽음
  renderer.readRenderTargetPixels(maskRT, 0, 0, SIM_SIZE, SIM_SIZE, pdsBuf);

  function aspectMatch(a, center, width) {
    const d = Math.min(Math.abs(a - center), 1.0 - Math.abs(a - center));
    // center 부근일수록 1, 폭은 width
    const t = 1.0 - THREE.MathUtils.clamp(d / (width + 1e-6), 0, 1);
    return t * t * (3.0 - 2.0 * t); // smooth
  }

  return function densityAt(ix, iy) {
    const idx = (iy * SIM_SIZE + ix) * 4;
    const H = pdsBuf[idx + 0] / 255;
    const S = pdsBuf[idx + 1] / 255;
    const C = pdsBuf[idx + 2] / 255;
    const A = pdsBuf[idx + 3] / 255;

    const aM = aspectMatch(A, aSouth, aWidth);

    if (species === "plant") {
      const kH = 0.05,
        kS = 0.12,
        kC = 0.12; // 완화 폭
      const pH = sstep(sea + hL, kH, H); // sea+hL 아래일수록 1
      const pS = sstep(sL, kS, S); // sL 아래일수록 1
      const pC = sstep(cL, kC, C); // cL 아래일수록 1
      const density = THREE.MathUtils.clamp(pH * pS * pC * aM, 0, 1);
      return scale * density;
    } else {
      const mid = sea + 0.5 * (hbL + hbH);
      const sigma = Math.max(1e-3, 0.9 * (hbH - hbL));
      const pH = Math.exp(-0.5 * Math.pow((H - mid) / sigma, 2.0)); // 0..1
      const pS = THREE.MathUtils.clamp(
        1.0 - Math.abs((S - (smL + smH) / 2) / ((smH - smL) / 2 + 1e-6)),
        0,
        1
      );
      const kC = 0.1;
      const pC = 1.0 - THREE.MathUtils.smoothstep(cH - kC, cH + kC, C); // cH보다 클수록 1
      const density = THREE.MathUtils.clamp(pH * pS * pC * aM, 0, 1);
      return scale * density;
    }
  };
}

// 결과 그리기용 그룹 & 포인트 빌더
let pdsGroup = new THREE.Group();
scene.add(pdsGroup);

function buildPoints(
  points,
  color /* THREE.Color */,
  heightAt /*fn or null*/,
  snapToMesh = true
) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(points.length * 3);

  for (let i = 0; i < points.length; i++) {
    const ix = points[i].x | 0;
    const iy = points[i].y | 0;
    const x = (ix / SIM_SIZE - 0.5) * SIZE;
    const z = (iy / SIM_SIZE - 0.5) * SIZE;

    let y;
    if (snapToMesh) {
      // 위에서 아래로 레이캐스트 (충분히 높은 y에서 쏘기)
      __vFrom.set(x, 10.0, z);
      __ray.set(__vFrom, __vDir);
      const hit = __ray.intersectObject(terrain, true);
      if (hit && hit.length) {
        y = hit[0].point.y + 0.001; // 표면 살짝 띄우기
      } else {
        // 혹시 못 맞추면 heightRT 기반으로 폴백
        const h = heightAt ? heightAt(ix, iy) : 0.0;
        y = h * params.disp + 0.001;
      }
    } else {
      // 기존 heightRT 기반
      const h = heightAt ? heightAt(ix, iy) : 0.0;
      y = h * params.disp + 0.001;
    }

    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }

  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  // 원형 알파 스프라이트 텍스처 생성
  const circle = document.createElement("canvas");
  circle.width = circle.height = 64;
  const ctx = circle.getContext("2d");
  ctx.clearRect(0, 0, 64, 64);
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = "white";
  ctx.fill();
  const circleTex = new THREE.CanvasTexture(circle);
  circleTex.minFilter = THREE.LinearFilter;
  circleTex.magFilter = THREE.LinearFilter;

  const mat = new THREE.PointsMaterial({
    size: 6.0,
    sizeAttenuation: true, // 거리 감쇠 켬
    map: circleTex, // 원형 알파맵
    color,
    alphaTest: 0.5, // 네모 모서리 제거
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  return new THREE.Points(geom, mat);
}

let __scatterOn = false;
let caAccumTex = null; // 현재 프레임에 쓸 입력(이전 CA 결과)
let caWasEnabled = false; // 직전 프레임의 on/off 기억

const __emPrev = { color: new THREE.Color(0x000000), intensity: 0 };

const scatterRT = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
});
scatterRT.texture.colorSpace = THREE.NoColorSpace;

let showScatter = false;

// 셰이더 재사용 로더와 동일한 스타일로 재사용 가능:
// 여기서는 위에서 문자열로 임베드한 SCATTER_FRAG_GLSL을 곧바로 사용
const scatterMat = new THREE.ShaderMaterial({
  uniforms: {
    tMask: { value: maskRT.texture },
    texel: { value: new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE) },
    uSea: { value: params.seaLevel },

    // 식물(염생식물) — 저지대·평지·오목·남향
    tH_lo: { value: 0.005 }, // H < sea + 0.03
    tS_lo: { value: 0.22 }, // S < 0.25
    tC_lo: { value: 0.54 }, // C < 0.45

    // 동물(소금게) — 중간 고도 밴드·약간 경사·볼록·남향
    tH_bandLo: { value: 0 }, // sea+0.02 ≤ H
    tH_bandHi: { value: 0.2 }, // H ≤ sea+0.12
    tS_midLo: { value: 0.1 }, // 0.30 ≤ S
    tS_midHi: { value: 0.9 }, // S ≤ 0.60
    tC_hi: { value: 0.5 }, // C > 0.55

    // Aspect(남향 중심/폭)
    aSouth: { value: 0.29 }, // 남향: 0=동, 0.25=남, 0.5=서, 0.75=북
    aWidth: { value: 0.17 }, // 허용 반폭

    // 점/격자
    stride: { value: 4.0 }, // ↑ → 점수↓ 성능↑
    rDot: { value: 0.24 }, // 0..0.5 권장

    uUseNoise: { value: true },
    uNoiseScale: { value: 2.0 }, // ↑ 셀 대비 노이즈 변화를 크게
    uNoiseAmp: { value: 0.9 }, // ↑ 효과 확실
    uNoiseBias: { value: 0.0 },
    uNoiseSeed: { value: Math.random() * 1000.0 },
  },
  vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
  fragmentShader: SCATTER_FRAG_GLSL, // ← 로드한 문자열 사용
  transparent: true,
});

const caRT_A = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  wrapS: THREE.ClampToEdgeWrapping,
  wrapT: THREE.ClampToEdgeWrapping,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
});
caRT_A.texture.colorSpace = THREE.NoColorSpace;
const caRT_B = caRT_A.clone();

const caMat = new THREE.ShaderMaterial({
  uniforms: {
    uCAEnable: { value: false },
    uCABirthMask: { value: 8 }, // B3
    uCASurviveMask: { value: 12 }, // S23
    uCANeigh: { value: 0 }, // 0=Moore, 1=vonNeumann
    uCAIterations: { value: 2 },
    uCAThreshold: { value: 0.5 },
    uCAJitter: { value: 0.0 },
    uCASeed: { value: Math.random() * 1000.0 },
    uTexel: { value: new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE) },
    uSource: { value: null },
    uPrev: { value: null },
    uCAStateChan: { value: 1 }, // 0=alpha, 1=luma(기본)
    uUseLumaForPrev: { value: true },
  },
  vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
  fragmentShader: CA_FRAG_GLSL, // ← Promise.all에서 읽어온 문자열 사용
  transparent: true,
});

const CA_DEFAULTS = {
  enable: false,
  birthMask: 8, // 예 B3 → 8
  surviveMask: 12, // 예 S23 → 12
  neigh: 0,
  iterations: 2,
  threshold: 0.5,
  jitter: 0.0,
  reseed: () => (caMat.uniforms.uCASeed.value = Math.random() * 1000.0),
};

// 초기 반영(선택)
caMat.uniforms.uCAEnable.value = CA_DEFAULTS.enable;
caMat.uniforms.uCABirthMask.value = CA_DEFAULTS.birthMask;
caMat.uniforms.uCASurviveMask.value = CA_DEFAULTS.surviveMask;
caMat.uniforms.uCANeigh.value = CA_DEFAULTS.neigh;
caMat.uniforms.uCAIterations.value = CA_DEFAULTS.iterations;
caMat.uniforms.uCAThreshold.value = CA_DEFAULTS.threshold;
caMat.uniforms.uCAJitter.value = CA_DEFAULTS.jitter;

function runScatterAndCA() {
  // 1) scatter 갱신 (항상 최신으로)
  fsQuad.material = scatterMat;
  renderer.setRenderTarget(scatterRT);
  renderer.render(fsScene, fsCam);
  renderer.setRenderTarget(null);

  const enabled = !!caMat.uniforms.uCAEnable.value;
  const texel = 1 / SIM_SIZE;

  if (!enabled) {
    // OFF → 누적 해제
    caAccumTex = null;
    terrainMat.emissiveMap = scatterRT.texture;
    terrainMat.emissive.set(0xffffff);
    terrainMat.emissiveIntensity = Math.max(terrainMat.emissiveIntensity, 3.0);

    if (typeof applyScatterOverlay === "function") {
      if (showScatter) applyScatterOverlay(true);
      else applyScatterOverlay(false);
    }
    terrainMat.needsUpdate = true;
    caWasEnabled = false;
    return;
  }

  // ON
  caMat.uniforms.uTexel.value.set(texel, texel);
  caMat.uniforms.uSource.value = scatterRT.texture;

  // 첫 프레임 ON: scatter에서 시작
  if (!caWasEnabled || !caAccumTex) {
    caAccumTex = scatterRT.texture;
    caMat.uniforms.uUseLumaForPrev.value = true; // ★ 초기화는 루마
  } else {
    caMat.uniforms.uUseLumaForPrev.value = false; // ★ 이후는 알파(누적)
  }
  // --- 누적 입력 = 직전 프레임 결과 ---
  caMat.uniforms.uPrev.value = caAccumTex;

  const maxI = Math.min(caMat.uniforms.uCAIterations.value | 0, 16);
  let ping = true;
  for (let i = 0; i < maxI; i++) {
    caMat.uniforms.uCAIterations.value = i + 1;
    fsQuad.material = caMat;
    renderer.setRenderTarget(ping ? caRT_A : caRT_B);
    renderer.render(fsScene, fsCam);
    renderer.setRenderTarget(null);

    // 다음 스텝의 입력으로 방금 결과 연결
    caMat.uniforms.uPrev.value = (ping ? caRT_A : caRT_B).texture;
    ping = !ping;
  }

  // 이번 프레임 최종 출력
  const outTex = (!ping ? caRT_A : caRT_B).texture;

  // 다음 프레임의 입력으로 "축적"
  caAccumTex = outTex;

  // 시각화
  terrainMat.emissiveMap = outTex;
  terrainMat.emissive.set(0xffffff);
  terrainMat.emissiveIntensity = Math.max(terrainMat.emissiveIntensity, 3.0);

  // overlay가 덮지 않게 OFF 유지
  if (typeof applyScatterOverlay === "function") applyScatterOverlay(false);

  terrainMat.needsUpdate = true;
  caWasEnabled = true;
}

const sea = params.seaLevel;
const hL = scatterMat.uniforms.tH_lo.value;
const sL = scatterMat.uniforms.tS_lo.value;
const cL = scatterMat.uniforms.tC_lo.value;
const hbL = scatterMat.uniforms.tH_bandLo.value;
const hbH = scatterMat.uniforms.tH_bandHi.value;
const smL = scatterMat.uniforms.tS_midLo.value;
const smH = scatterMat.uniforms.tS_midHi.value;
const cH = scatterMat.uniforms.tC_hi.value;
const aSouth = scatterMat.uniforms.aSouth.value;
const aWidth = scatterMat.uniforms.aWidth.value;

Object.assign(scatterMat.uniforms, {
  uRpx: { value: 12.0 }, // 최소 간격(픽셀)
  uSeed: { value: Math.random() * 1000.0 },
});

function applyScatterOverlay(on) {
  if (on) {
    // 켜기로 전환되는 '순간'에만 백업 + 적용
    if (!__scatterOn) {
      __emPrev.color.copy(terrainMat.emissive);
      __emPrev.intensity = terrainMat.emissiveIntensity;
    }
    terrainMat.emissive.set(0xffffff);
    terrainMat.emissiveIntensity = Math.max(terrainMat.emissiveIntensity, 3.0);
    terrainMat.emissiveMap = scatterRT.texture;
    __scatterOn = true;
  } else {
    // 끄기로 전환되는 '순간'에만 원복
    if (__scatterOn) {
      terrainMat.emissiveMap = null;
      terrainMat.emissive.copy(__emPrev.color);
      terrainMat.emissiveIntensity = __emPrev.intensity;

      // 완전 소거하고 싶으면 아래 주석 해제:
      // terrainMat.emissive.set(0x000000);
      // terrainMat.emissiveIntensity = 0.0;
    }
    __scatterOn = false;
  }
  terrainMat.needsUpdate = true;
}

const heightBuf = new Uint16Array(SIM_SIZE * SIM_SIZE * 4);

function readHeightToSampler() {
  renderer.readRenderTargetPixels(
    heightRT,
    0,
    0,
    SIM_SIZE,
    SIM_SIZE,
    heightBuf
  );

  const fromHalf =
    THREE.DataUtils && THREE.DataUtils.fromHalfFloat
      ? THREE.DataUtils.fromHalfFloat
      : (h) => {
          // 폴백: half->float 디코더
          const s = (h & 0x8000) >> 15;
          let e = (h & 0x7c00) >> 10;
          let f = h & 0x03ff;
          if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
          if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
          return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
        };

  return function heightAt(ix, iy) {
    const idx = (iy * SIM_SIZE + ix) * 4;
    const h = fromHalf(heightBuf[idx + 0]);
    return h;
  };
}

// === Mask Viewer (채널별 흑백/색상화) ===
const maskView = { channel: 1 }; // 1=Height, 2=Slope, 3=Curvature, 4=Aspect
const maskViewRT = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
});
maskViewRT.texture.colorSpace = THREE.NoColorSpace;

const maskViewMat = new THREE.ShaderMaterial({
  uniforms: {
    tMask: { value: maskRT.texture },
    channel: { value: maskView.channel }, // 1..4
  },
  vertexShader: `void main(){ gl_Position=vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tMask;
    uniform int channel;
    void main(){
      vec2 uv = gl_FragCoord.xy / vec2(${SIM_SIZE}.0, ${SIM_SIZE}.0);
      vec4 m  = texture2D(tMask, uv);
      float v = (channel==1)? m.r : (channel==2)? m.g : (channel==3)? m.b : m.a;
      v = (v - 0.4) * 4.0;   // offset + scale
v = clamp(v, 0.0, 1.0);

      // Aspect(4)는 색상환으로, 나머지는 흑백
      vec3 hue;
      if (channel==4) {
        float h = v; // 0..1
        float r = clamp(abs(h*6.0-3.0)-1.0, 0.0, 1.0);
        float g = clamp(2.0-abs(h*6.0-2.0), 0.0, 1.0);
        float b = clamp(2.0-abs(h*6.0-4.0), 0.0, 1.0);
        hue = vec3(r,g,b);
      } else {
        hue = vec3(v);
      }
      gl_FragColor = vec4(hue, 1.0);
    }`,
});

// maskRT → maskViewRT에 굽기
function updateMaskViewRT() {
  maskViewMat.uniforms.channel.value = maskView.channel | 0;
  fsQuad.material = maskViewMat;
  renderer.setRenderTarget(maskViewRT);
  renderer.render(fsScene, fsCam);
  renderer.setRenderTarget(null);
}

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

  copyMat.uniforms.tex.value = heightRT.texture;
  fsQuad.material = copyMat;
  renderer.setRenderTarget(heightDispRT);
  renderer.render(fsScene, fsCam);
  renderer.setRenderTarget(null);

  // 부드러운 실루엣을 위해 2패스 정도 블러
  blurRTInPlace(heightDispRT, 3);

  // 1.5) ★ 경계 소프트닝(후처리)
  edgeSoftenMat.uniforms.heightTex.value = heightRT.texture;
  edgeSoftenMat.uniforms.bands.value = params.bands;
  // 필요하면 라디오/엣지 계수도 소스 파라미터로 연결

  edgeSoftenMat.uniforms.radius.value = 1.5;
  edgeSoftenMat.uniforms.mixAmt.value = 0.9;
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

  // normal
  renderer.setRenderTarget(normalRT);
  normalMat.uniforms.strength.value = params.normStrength;
  normalMat.uniforms.heightTex.value = heightRT.texture; // 샤프
  normalMat.uniforms.heightTexBlur.value = heightBlurRT.texture;
  normalMat.uniforms.bands.value = params.bands;
  bakeQuad.material = normalMat;
  renderer.render(bakeScene, fsCam);

  normalRT.texture.generateMipmaps = true;
  normalRT.texture.minFilter = THREE.LinearMipmapLinearFilter;
  normalRT.texture.magFilter = THREE.LinearFilter;
  normalRT.texture.needsUpdate = true;

  // color
  renderer.setRenderTarget(colorRT);
  bakeQuad.material = colorMat;

  colorMat.uniforms.normalTex.value = normalRT.texture;
  colorMat.uniforms.heightTexSharp.value = heightRT.texture; // 샤프(기울기/능선)
  normalMat.uniforms.heightTexBlur.value = heightBlurRT.texture;

  renderer.render(bakeScene, fsCam);
  colorRT.texture.anisotropy = aniso;
  colorRT.texture.generateMipmaps = true;
  colorRT.texture.minFilter = THREE.LinearMipmapLinearFilter;
  colorRT.texture.magFilter = THREE.LinearFilter;
  colorRT.texture.needsUpdate = true;

  renderer.setRenderTarget(maskRT);
  fsQuad.material = maskMat;
  renderer.render(fsScene, fsCam);
  renderer.setRenderTarget(null);

  renderer.setRenderTarget(null);
  terrainMat.displacementMap = heightDispRT.texture; // ★ 블러 높이 유지
  applyBaseView();
}

/* ─ Terrain ─ */
const DIV = 2048;

const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, DIV, DIV);
terrainGeo.rotateX(-Math.PI / 2);

const terrainMat = new THREE.MeshStandardMaterial({
  map: colorRT.texture,
  displacementMap: heightDispRT.texture, // ★ 블러 높이 사용
  displacementScale: 0.0,
  roughness: 1.0,
  metalness: 0.0,
  transparent: false,
  alphaTest: 0.0,
  emissive: 0x0,
  emissiveIntensity: 0.0,
});
terrainMat.envMapIntensity = 0.3;

// LOD 구성
const lod = new LOD();
function makeMesh(div) {
  const g = new THREE.PlaneGeometry(SIZE, SIZE, div, div);
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, terrainMat);
}
lod.addLevel(makeMesh(2048), 0);
lod.addLevel(makeMesh(1024), 12);
lod.addLevel(makeMesh(512), 24);
scene.add(lod);

// 레이캐스트 등에서 사용할 공용 참조
const terrain = lod;

let _pdsModulePromise = null;

// ───────── GUI ─────────
// HMR/리로드 시 기존 lil-gui 패널 제거
document.querySelectorAll(".lil-gui").forEach((el) => el.remove());

const gui = new GUI({ title: "GPU RD Terraces" });
gui.hide();

// maskMat uniforms 확장
Object.assign(maskMat.uniforms, {
  uHeightGamma: { value: 1.0 },
  uHeightBias: { value: 0.0 },
  uSlopeGain: { value: 1.0 },
  uCurvGain: { value: 1.0 },
  uAspectSharpen: { value: 1.0 },
});

// 리사이즈 시 texel 유지
addEventListener("resize", () => {
  maskMat.uniforms.texel.value.set(1 / SIM_SIZE, 1 / SIM_SIZE);
});

// 폴더/슬라이더 중복 방지
if (!window.__MASKS_FOLDER_INIT__) {
  const f = gui.addFolder("Masks");
  f.add(maskMat.uniforms.uHeightGamma, "value", 0.5, 2.0, 0.05).name(
    "Height Gamma"
  );
  f.add(maskMat.uniforms.uHeightBias, "value", -0.25, 0.25, 0.01).name(
    "Height Bias"
  );
  f.add(maskMat.uniforms.uSlopeGain, "value", 0.25, 4.0, 0.05).name(
    "Slope Gain"
  );
  f.add(maskMat.uniforms.uCurvGain, "value", 0.25, 4.0, 0.05).name("Curv Gain");
  f.add(maskMat.uniforms.uAspectSharpen, "value", 0.5, 4.0, 0.05).name(
    "Aspect Sharpen"
  );

  window.__MASKS_FOLDER_INIT__ = true;
}

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

const fCA = gui.addFolder("Cellular Automata");

// Neighborhood / Threshold / Reseed 바꿀 때 초기화 한 프레임 루마
const markInit = () => {
  caAccumTex = null;
  caWasEnabled = false;
  runScatterAndCA();
};

fCA
  .add(caMat.uniforms.uCAEnable, "value")
  .name("Enable CA")
  .onChange(runScatterAndCA);

fCA
  .add(caMat.uniforms.uCABirthMask, "value", 0, 255, 1)
  .name("Birth Mask")
  .onChange(runScatterAndCA);

fCA
  .add(caMat.uniforms.uCASurviveMask, "value", 0, 255, 1)
  .name("Survive Mask")
  .onChange(runScatterAndCA);

fCA
  .add(caMat.uniforms.uCANeigh, "value", { Moore: 0, vonNeumann: 1 })
  .name("Neighborhood")
  .onChange(markInit);

fCA
  .add(caMat.uniforms.uCAIterations, "value", 0, 16, 1)
  .name("Iterations")
  .onChange(runScatterAndCA);

fCA
  .add(caMat.uniforms.uCAThreshold, "value", 0.0, 1.0, 0.01)
  .name("Threshold")
  .onChange(markInit);

fCA
  .add(caMat.uniforms.uCAJitter, "value", 0.0, 1.0, 0.01)
  .name("Jitter")
  .onChange(runScatterAndCA);

fCA
  .add(caMat.uniforms.uCAStateChan, "value", { Alpha: 0, Luma: 1 })
  .name("State From")
  .onChange(runScatterAndCA);

fCA.add(
  {
    Reseed: () => {
      caMat.uniforms.uCASeed.value = Math.random() * 1000;
      markInit();
    },
  },
  "Reseed"
);

// 앵커 [E]: GUI — Noise Filter 폴더
const fNoise = gui.addFolder("Noise Filter");

fNoise
  .add(scatterMat.uniforms.uUseNoise, "value")
  .name("Enable Noise")
  .onChange(() => {
    if (typeof queueBake === "function") queueBake();
  });

fNoise
  .add(scatterMat.uniforms.uNoiseScale, "value", 0.05, 8.0, 0.05)
  .name("Noise Scale")
  .onChange(() => {
    if (typeof queueBake === "function") queueBake();
  });

fNoise
  .add(scatterMat.uniforms.uNoiseAmp, "value", 0.0, 2.0, 0.01)
  .name("Noise Amp")
  .onChange(() => {
    if (typeof queueBake === "function") queueBake();
  });

fNoise
  .add(scatterMat.uniforms.uNoiseBias, "value", -1.0, 1.0, 0.01)
  .name("Noise Bias")
  .onChange(() => {
    if (typeof queueBake === "function") queueBake();
  });

fNoise
  .add(
    {
      Reseed: () => {
        scatterMat.uniforms.uNoiseSeed.value = Math.random() * 1000.0;
        if (typeof queueBake === "function") queueBake();
      },
    },
    "Reseed"
  )
  .name("▶ Reseed");

const fBN = gui.addFolder("Scatter • Blue-Noise PDS");
fBN.add(scatterMat.uniforms.uRpx, "value", 2.0, 32.0, 1.0).name("radius (px)");
fBN.add(
  {
    Reshuffle: () => {
      scatterMat.uniforms.uSeed.value = Math.random() * 1000.0;
    },
  },
  "Reshuffle"
);

const scatterFolder = gui.addFolder("Static Scatter");
scatterFolder
  .add(
    {
      get show() {
        return showScatter;
      },
      set show(v) {
        showScatter = v;
        applyScatterOverlay(v);
      },
    },
    "show"
  )
  .name("Show Scatter");

// Plant
scatterFolder
  .add(scatterMat.uniforms.tH_lo, "value", 0.0, 0.08, 0.005)
  .name("Plant H_lo");
scatterFolder
  .add(scatterMat.uniforms.tS_lo, "value", 0.05, 0.5, 0.01)
  .name("Plant S_lo");
scatterFolder
  .add(scatterMat.uniforms.tC_lo, "value", 0.3, 0.6, 0.01)
  .name("Plant C_lo");

// Crab
scatterFolder
  .add(scatterMat.uniforms.tH_bandLo, "value", 0.0, 0.1, 0.005)
  .name("Crab H_bandLo");
scatterFolder
  .add(scatterMat.uniforms.tH_bandHi, "value", 0.06, 0.2, 0.005)
  .name("Crab H_bandHi");
scatterFolder
  .add(scatterMat.uniforms.tS_midLo, "value", 0.1, 0.5, 0.01)
  .name("Crab S_midLo");
scatterFolder
  .add(scatterMat.uniforms.tS_midHi, "value", 0.4, 0.9, 0.01)
  .name("Crab S_midHi");
scatterFolder
  .add(scatterMat.uniforms.tC_hi, "value", 0.5, 0.7, 0.01)
  .name("Crab C_hi");

// Aspect
scatterFolder
  .add(scatterMat.uniforms.aSouth, "value", 0.0, 1.0, 0.01)
  .name("Aspect South");
scatterFolder
  .add(scatterMat.uniforms.aWidth, "value", 0.05, 0.3, 0.01)
  .name("Aspect Width");

// Dots
scatterFolder
  .add(scatterMat.uniforms.stride, "value", 3.0, 16.0, 1.0)
  .name("Stride (px)");
scatterFolder
  .add(scatterMat.uniforms.rDot, "value", 0.2, 0.6, 0.02)
  .name("Dot Radius");

// 리사이즈 보정(텍셀/RT)
addEventListener("resize", () => {
  scatterMat.uniforms.texel.value.set(1 / SIM_SIZE, 1 / SIM_SIZE);
  scatterRT.setSize(SIM_SIZE, SIM_SIZE);
});

const baseView = { mode: "color" };

const fBase = gui.addFolder("Base View");
fBase
  .add(baseView, "mode", {
    "Color (shaded)": "color",
    "Height (texture)": "height",
    "Mask • Height (R)": "mask_h",
    "Mask • Slope (G)": "mask_s",
    "Mask • Curvature (B)": "mask_c",
    "Mask • Aspect (A)": "mask_a",
  })
  .name("mode")
  .onChange(applyBaseView);

function applyBaseView() {
  // Mask 뷰어: 채널 결정
  if (baseView.mode.startsWith("mask_")) {
    // 채널 매핑
    maskView.channel =
      baseView.mode === "mask_h"
        ? 1
        : baseView.mode === "mask_s"
        ? 2
        : baseView.mode === "mask_c"
        ? 3
        : 4; // mask_a

    // maskRT → maskViewRT (채널 스와즐 + Aspect는 색상환)
    updateMaskViewRT();

    // 지형에 적용
    terrainMat.map = maskViewRT.texture;
    terrainMat.map.colorSpace = THREE.NoColorSpace;
  } else if (baseView.mode === "color") {
    terrainMat.map = colorRT.texture;
    terrainMat.map.colorSpace = THREE.NoColorSpace;
  } else {
    // "height"
    terrainMat.map = heightRT.texture;
    terrainMat.map.colorSpace = THREE.NoColorSpace;
  }

  terrainMat.needsUpdate = true;
}
applyBaseView();

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
  smaaPass.setSize(innerWidth * DPR, innerHeight * DPR);
  fxaa.material.uniforms["resolution"].value.set(
    1 / innerWidth,
    1 / innerHeight
  );
});

/* ─ Loop ─ */
const clock = new THREE.Clock();
stepRD();
bake();

function animate() {
  const dt = clock.getDelta();
  frameCount++;

  growthPhase = Math.min(params.bands, growthPhase + params.growSpeed * dt);

  // ✨ 여기서만 한 번씩 처리
  if (needBake) {
    bake();
    needBake = false;
  }

  terrainMat.displacementScale = params.disp;
  terrainMat.roughness = 1.0;
  terrainMat.metalness = 0.0;
  terrainMat.normalMap = normalRT.texture;
  terrainMat.normalMap.colorSpace = THREE.NoColorSpace;
  terrainMat.normalScale.set(3.0, -3.0);

  if (frameCount % 3 === 0) stepRD();
  if (frameCount % 8 === 0) needBake = true; // 주기적 베이크도 큐잉으로 변경

  controls.update();
  runScatterAndCA();
  composer.render();
  updateFPS();
  requestAnimationFrame(animate);
}

animate();

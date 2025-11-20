import * as THREE from "three";
import { GUI } from "lil-gui"; // ← lil-gui 추가 (npm i lil-gui)

const hud = document.getElementById("hud");
if (hud) {
  hud.textContent = "R: reseed (시드 다시 만들기)";
  hud.style.position = "fixed";
  hud.style.top = "10px";
  hud.style.left = "10px";
  hud.style.color = "#fff";
  hud.style.fontFamily = "monospace";
  hud.style.fontSize = "14px";
  hud.style.zIndex = "1000";
  hud.style.background = "rgba(0,0,0,0.5)";
  hud.style.padding = "4px 8px";
  hud.style.borderRadius = "4px";
}
if (hud) hud.textContent = "R: reseed (시드 다시 만들기)";

// 0. WebGL2 필수 체크 + 서버에서 실행 권장
const isWebGL2 = (() => {
  const c = document.createElement("canvas");
  return !!c.getContext("webgl2");
})();
if (!isWebGL2) {
  console.error(
    "이 데모는 WebGL2가 필요합니다. (크롬/파폭 최신, 하드웨어 가속 ON)"
  );
}

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: true,
  preserveDrawingBuffer: true,
  premultipliedAlpha: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0); // 완전 투명 클리어 (검정+알파0)
renderer.clearColor();
document.body.appendChild(renderer.domElement);

// 확장 체크(모바일/브라우저별)
const gl = renderer.getContext();
if (!gl.getExtension("EXT_color_buffer_float")) {
  console.warn("EXT_color_buffer_float 확장이 필요합니다.");
}

// 1. 셰이더 로드 보조: 실패 시 즉시 에러
async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.text();
}

const vertSrc = await loadText("./src/shaders/screen.vert.glsl");
const initSrc = await loadText("./src/shaders/rd_init.frag.glsl");
const displaySrc = await loadText("./src/shaders/rd_display.frag.glsl");
const updateSrc = await loadText("./src/shaders/rd_update.frag.glsl");

// 2. 카메라/지오메트리
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const sceneInit = new THREE.Scene();
const sceneDisplay = new THREE.Scene();

const quad = new THREE.BufferGeometry();
quad.setAttribute(
  "position",
  new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]),
    3
  )
);
quad.setIndex([0, 1, 2, 2, 1, 3]);

// 3. 상태 텍스처 (U,V를 RG로 저장)
const SIZE = 1024;
const stateRT = new THREE.WebGLRenderTarget(SIZE, SIZE, {
  type: THREE.FloatType,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthBuffer: false,
  stencilBuffer: false,
});
stateRT.texture.wrapS = THREE.RepeatWrapping;
stateRT.texture.wrapT = THREE.RepeatWrapping;

// --- ping-pong RT ---
const rtA = new THREE.WebGLRenderTarget(SIZE, SIZE, {
  type: THREE.FloatType,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthBuffer: false,
  stencilBuffer: false,
});
const rtB = rtA.clone();
rtA.texture.wrapS = rtA.texture.wrapT = THREE.RepeatWrapping;
rtB.texture.wrapS = rtB.texture.wrapT = THREE.RepeatWrapping;
let ping = rtA,
  pong = rtB;

// 4. 초기화 패스
const initMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: vertSrc,
  fragmentShader: initSrc,
  uniforms: {
    uCells: { value: 110.0 }, // 시드 중심 간격(촘촘함)
    uRadiusPx: { value: 3.2 }, // 점 반경(픽셀) 2.5~5.0 탐색
    uDensity: { value: 0.45 }, // 시드 비율 0.55~0.75 탐색
    uSeedShift: { value: Math.random() * 1000 },
  },
});
const initMesh = new THREE.Mesh(quad, initMat);
sceneInit.add(initMesh);

// --- update pass ---
const sceneUpdate = new THREE.Scene();
const updateMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: vertSrc,
  fragmentShader: updateSrc,
  uniforms: {
    uState: { value: stateRT.texture }, // 처음엔 init 결과
    uTexel: { value: new THREE.Vector2(1 / SIZE, 1 / SIZE) },
    uDu: { value: 0.18 },
    uDv: { value: 0.09 },
    uF: { value: 0.0248 }, // 로제트 시작값
    uK: { value: 0.057 },
    uDt: { value: 1.0 },
    uNoiseShift: { value: new THREE.Vector2(0, 0) },
    uAccentRatio: { value: 0.4 }, // display와 동일
    uVoronoiCells: { value: 20.0 }, // 셀 개수 (8~20에서 취향 조절)
    uJitter: { value: 0.4 }, // 0.25~0.45
    uCenterBoost: { value: 0.6 }, // 중심 성장 가중
    uEdgeBoost: { value: 0.8 }, // 경계 성장 가중
    uEdgeWidth: { value: 0.18 }, // 경계 링 두께
  },
});
sceneUpdate.add(new THREE.Mesh(quad, updateMat));

// 5. 디스플레이 패스
const viewport = new THREE.Vector2(window.innerWidth, window.innerHeight);
const tiles = new THREE.Vector2(1.0, 1.0);
const displayMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: vertSrc,
  fragmentShader: displaySrc,
  uniforms: {
    uState: { value: ping.texture },
    uTiles: { value: tiles },
    uViewport: { value: viewport },
    uAccentRatio: { value: 0.4 },
    uPointRadiusPx: { value: 3.0 },
  },
});

// 종횡비에 따라 타일 수 보정 (정사각 텍셀 유지)
const baseTiles = 1.0; // 세로 기준 타일 개수
function syncTiles() {
  const aspect = renderer.domElement.width / renderer.domElement.height; // w/h
  tiles.set(baseTiles * aspect, baseTiles);
}
syncTiles();

const displayMesh = new THREE.Mesh(quad, displayMat);
sceneDisplay.add(displayMesh);

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  viewport.set(window.innerWidth, window.innerHeight);
  syncTiles(); // ⬅︎ 리사이즈마다 갱신
});

// reseed 함수
function reseed() {
  // 1) init로 초기상태 만들기
  initMat.uniforms.uSeedShift.value = Math.random() * 1000.0;
  renderer.setRenderTarget(stateRT);
  renderer.render(sceneInit, camera);
  renderer.setRenderTarget(null);

  // 2) ping에 1스텝 구워서 시작점으로
  updateMat.uniforms.uState.value = stateRT.texture;
  renderer.setRenderTarget(ping);
  renderer.render(sceneUpdate, camera);
  renderer.setRenderTarget(null);

  // 3) display는 ping을 보도록
  displayMat.uniforms.uState.value = ping.texture;
}

// 여기에 reseed 호출
reseed();

// ======== GUI 설정 ========

// 프레임당 iteration 수를 GUI로 조절할 수 있게
const simParams = {
  iters: 12,
};

const gui = new GUI();

// 초기화 파라미터 폴더
const initFolder = gui.addFolder("Init (Seed)");
initFolder
  .add(initMat.uniforms.uCells, "value", 10, 300, 1)
  .name("uCells")
  .onFinishChange(reseed);
initFolder
  .add(initMat.uniforms.uRadiusPx, "value", 1.0, 8.0, 0.1)
  .name("uRadiusPx")
  .onFinishChange(reseed);
initFolder
  .add(initMat.uniforms.uDensity, "value", 0.05, 1.0, 0.01)
  .name("uDensity")
  .onFinishChange(reseed);
initFolder.add({ reseed }, "reseed").name("Reseed");

// RD 파라미터 폴더
const rdFolder = gui.addFolder("Reaction-Diffusion");
rdFolder.add(updateMat.uniforms.uDu, "value", 0.0, 1.0, 0.005).name("Du");
rdFolder.add(updateMat.uniforms.uDv, "value", 0.0, 1.0, 0.005).name("Dv");
rdFolder.add(updateMat.uniforms.uF, "value", 0.0, 0.1, 0.0005).name("F (feed)");
rdFolder.add(updateMat.uniforms.uK, "value", 0.0, 0.1, 0.0005).name("K (kill)");
rdFolder.add(updateMat.uniforms.uDt, "value", 0.1, 2.0, 0.01).name("dt");

// Voronoi / 스타일링 폴더
const styleFolder = gui.addFolder("Style / Voronoi");
styleFolder
  .add(updateMat.uniforms.uVoronoiCells, "value", 4.0, 40.0, 1.0)
  .name("VoronoiCells");
styleFolder
  .add(updateMat.uniforms.uJitter, "value", 0.0, 1.0, 0.01)
  .name("Jitter");
styleFolder
  .add(updateMat.uniforms.uCenterBoost, "value", 0.0, 2.0, 0.01)
  .name("CenterBoost");
styleFolder
  .add(updateMat.uniforms.uEdgeBoost, "value", 0.0, 2.0, 0.01)
  .name("EdgeBoost");
styleFolder
  .add(updateMat.uniforms.uEdgeWidth, "value", 0.01, 0.5, 0.01)
  .name("EdgeWidth");

// Display 폴더
const displayFolder = gui.addFolder("Display");
displayFolder
  .add(displayMat.uniforms.uPointRadiusPx, "value", 1.0, 10.0, 0.1)
  .name("PointRadiusPx");
displayFolder
  .add(displayMat.uniforms.uAccentRatio, "value", 0.0, 1.0, 0.01)
  .name("AccentRatio(Display)");
displayFolder
  .add(updateMat.uniforms.uAccentRatio, "value", 0.0, 1.0, 0.01)
  .name("AccentRatio(RD)");

// Simulation 폴더
const simFolder = gui.addFolder("Simulation");
simFolder.add(simParams, "iters", 1, 50, 1).name("Iterations/frame");

// 6. 입력: R키로 재시드
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "r") reseed();
});

// 7. 루프
renderer.setAnimationLoop(() => {
  // 천천히 지글거리게 feed에 약간의 공간노이즈
  const ns = updateMat.uniforms.uNoiseShift.value;
  ns.x += 0.0001;
  ns.y -= 0.00005;

  for (let i = 0; i < simParams.iters; i++) {
    updateMat.uniforms.uState.value = ping.texture;
    renderer.setRenderTarget(pong);
    renderer.render(sceneUpdate, camera);
    renderer.setRenderTarget(null);
    const tmp = ping;
    ping = pong;
    pong = tmp;
  }

  displayMat.uniforms.uState.value = ping.texture;
  renderer.render(sceneDisplay, camera);
});

// PNG 저장 버튼
const btn = document.createElement("button");
btn.textContent = "💾 Save PNG";
btn.style.position = "fixed";
// HUD가 10px에 있으니까 버튼은 조금 아래로
btn.style.top = "40px";
btn.style.right = "10px";
btn.style.zIndex = "1001";
btn.style.padding = "6px 10px";
btn.style.fontSize = "14px";
btn.style.border = "none";
btn.style.borderRadius = "4px";
btn.style.background = "#222";
btn.style.color = "#fff";
btn.style.cursor = "pointer";
btn.style.opacity = "0.8";
btn.onmouseenter = () => (btn.style.opacity = "1");
btn.onmouseleave = () => (btn.style.opacity = "0.8");
document.body.appendChild(btn);

function savePNG(targetSize = 1024, filename = "reaction_diffusion.png") {
  // 1. 현재 상태 백업
  const oldPR = renderer.getPixelRatio();
  const oldW = renderer.domElement.width;
  const oldH = renderer.domElement.height;

  // 2. 정사각 해상도로 전환 (CSS 크기는 유지)
  renderer.setPixelRatio(1); // 픽셀 수 = targetSize 정확히
  renderer.setSize(targetSize, targetSize, false);

  // uViewport | 타일링도 정사각 기준으로 갱신
  viewport.set(targetSize, targetSize);
  syncTiles();

  // 3. 최신 프레임 보장 후 캡처
  renderer.render(sceneDisplay, camera);
  const dataURL = renderer.domElement.toDataURL("image/png");

  // 4. 다운로드
  const a = document.createElement("a");
  a.href = dataURL;
  a.download = filename;
  a.click();

  // 5. 원래 상태 복원
  renderer.setPixelRatio(oldPR);
  renderer.setSize(window.innerWidth, window.innerHeight);
  viewport.set(window.innerWidth, window.innerHeight);
  syncTiles();
}

btn.addEventListener("click", () =>
  savePNG(1024, "reaction_diffusion_1024.png")
);

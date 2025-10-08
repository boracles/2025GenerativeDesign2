import * as THREE from "three";

const hud = document.getElementById("hud");
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

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x111111, 1);
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
const SIZE = 512;
const stateRT = new THREE.WebGLRenderTarget(SIZE, SIZE, {
  type: THREE.FloatType,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthBuffer: false,
  stencilBuffer: false,
});
stateRT.texture.wrapS = THREE.RepeatWrapping;
stateRT.texture.wrapT = THREE.RepeatWrapping;

// 4. 초기화 패스
const initMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: vertSrc,
  fragmentShader: initSrc,
  uniforms: {
    uThreshold: { value: 0.99611 },
    uTime: { value: 0 },
  },
});
const initMesh = new THREE.Mesh(quad, initMat);
sceneInit.add(initMesh);

function reseed() {
  initMat.uniforms.uTime.value = performance.now();
  renderer.setRenderTarget(stateRT);
  renderer.render(sceneInit, camera);
  renderer.setRenderTarget(null);
}
reseed();

// 5. 디스플레이 패스
const viewport = new THREE.Vector2(window.innerWidth, window.innerHeight);
const displayMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: vertSrc,
  fragmentShader: displaySrc,
  uniforms: {
    uState: { value: stateRT.texture },
    uTiles: { value: 1.0 },
    uViewport: { value: viewport },
    uAccentRatio: { value: 0.4 }, // 와인색 비율(0~1)
    uPointRadiusPx: { value: 3.0 }, // 점 반경(픽셀) 2~6 으로 조절
  },
});
const displayMesh = new THREE.Mesh(quad, displayMat);
sceneDisplay.add(displayMesh);

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  viewport.set(window.innerWidth, window.innerHeight);
});

// 6. 입력: R키로 재시드
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "r") reseed();
});

// 7. 루프
renderer.setAnimationLoop(() => {
  renderer.render(sceneDisplay, camera);
});

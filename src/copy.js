import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ──────────────────────────────────────────────
// 기본 세팅 (사선 탑뷰 + 조작 허용)
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x003e58);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
// 살짝 기울어진 탑뷰(몸체가 보이도록 높이와 앞쪽에 배치)
camera.position.set(0, 18, 10);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
// 조작 허용 + 범위 제한
controls.enableRotate = true;
controls.enablePan = true;
controls.screenSpacePanning = false; // 수평 패닝은 거리/각도에 맞춰 자연스럽게
controls.minDistance = 8;
controls.maxDistance = 60;
// 극각 제한: 완전 탑다운/바닥 관통 방지
controls.minPolarAngle = Math.PI * 0.15; // 약 27°
controls.maxPolarAngle = Math.PI * 0.48; // 약 86° (지나친 탑다운 방지)
controls.target.set(0, 0, 0);

// 라이트
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334455, 0.7);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(10, 20, 12);
dirLight.castShadow = true;
scene.add(dirLight);

// 바닥 그리드(XZ 평면, Y=0)
const grid = new THREE.GridHelper(48, 24, 0x2aa9c8, 0x1f6a82);
grid.position.y = 0;
scene.add(grid);

// ──────────────────────────────────────────────
// FPS HUD
const hud = document.createElement("div");
hud.style.cssText = `
  position:fixed;left:10px;top:10px;font:12px/1.2 ui-monospace,monospace;
  color:#eaf6ff;background:rgba(0,0,0,.35);padding:8px 10px;border-radius:8px;
  border:1px solid rgba(255,255,255,.12);z-index:9999;user-select:none;
`;
document.body.appendChild(hud);
let frames = 0,
  last = performance.now(),
  fps = 0,
  avg = 0,
  samples = 0;
function updateFPS() {
  const now = performance.now();
  frames++;
  if (now - last >= 1000) {
    fps = (frames * 1000) / (now - last);
    frames = 0;
    last = now;
    samples++;
    avg += (fps - avg) / samples;
    hud.innerHTML = `FPS: ${fps.toFixed(1)}<br>AVG: ${avg.toFixed(
      1
    )}<br>Models: 100 (separate loads)`;
  }
}

// ──────────────────────────────────────────────
/** RD 텍스처 준비(공유) */
let rdMat = null;
const texLoader = new THREE.TextureLoader();

function toPOTTexture(srcImage, size = 1024) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  ctx.drawImage(srcImage, 0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

texLoader.load("./assets/textures/RD.png", (tex) => {
  const rdPOT = toPOTTexture(tex.image, 1024);
  rdMat = new THREE.MeshStandardMaterial({
    map: rdPOT,
    metalness: 0.0,
    roughness: 1.0,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.5,
    depthWrite: true,
  });
  rdMat.map.repeat.set(8, 8);
  rdMat.map.needsUpdate = true;
});

// ──────────────────────────────────────────────
/** GLB 20개 "별도로" 로드해서 동일 높이(Y=0), XZ 그리드 배치 */
const loader = new GLTFLoader();
const mixers = [];
const CLOCK = new THREE.Clock();

const COUNT = 100;
const COLS = 10;
const ROWS = Math.ceil(COUNT / COLS);
const GAP_X = 3.0;
const GAP_Z = 3.0;

function applyRDToNamedMeshes(root) {
  if (!rdMat) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (
      /body(\.\d+)?/i.test(o.name) ||
      /leg[_\s-]?ball(\.\d+)?/i.test(o.name)
    ) {
      o.material = rdMat;
      o.castShadow = o.receiveShadow = true;
    }
  });
}

const pendingForRD = new Set();
function tryApplyRDToPending() {
  if (!rdMat || pendingForRD.size === 0) return;
  pendingForRD.forEach((obj3d) => {
    applyRDToNamedMeshes(obj3d);
    pendingForRD.delete(obj3d);
  });
}

function loadOne(index) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const x = (col - (COLS - 1) / 2) * GAP_X;
  const z = (row - (ROWS - 1) / 2) * GAP_Z;

  loader.load(
    "./assets/models/Tentacles.glb",
    (gltf) => {
      const root = gltf.scene;
      // 같은 높이(Y=0) 고정, XZ 평면 배치
      root.position.set(x, 0, z);
      root.scale.setScalar(1.0);
      root.rotation.y = Math.random() * Math.PI * 2;

      scene.add(root);

      if (rdMat) applyRDToNamedMeshes(root);
      else pendingForRD.add(root);

      if (gltf.animations && gltf.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(root);
        const clip =
          THREE.AnimationClip.findByName(
            gltf.animations,
            "FeedingTentacle_WaveTest"
          ) || gltf.animations[0];
        mixer.clipAction(clip).play();
        mixers.push(mixer);
      }
    },
    undefined,
    (err) => console.error("GLB load error:", err)
  );
}

for (let i = 0; i < COUNT; i++) loadOne(i);

// ──────────────────────────────────────────────
// 리사이즈 & 루프
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);

  controls.update();
  tryApplyRDToPending();

  const dt = CLOCK.getDelta();
  for (const m of mixers) m.update(dt);

  renderer.render(scene, camera);
  updateFPS();
}
animate();

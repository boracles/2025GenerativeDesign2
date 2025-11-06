// src/main.js
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// 프로젝트 모듈
import { terrainRoot, tickUniforms } from "./terrain.js";
import { characterRoot } from "./character.js";
import {
  initMovement,
  updateMovement,
  setMovementParams,
  setTerrainHeightSampler,
} from "./movement.js";
import {
  createWeirdPlantRoot,
  updateWeirdPlant,
  api as WeirdAPI,
} from "./lsystem.js";

/* =============== 기본 장면 =============== */
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(90, 60, 90);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// IBL
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// 라이트
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.7));
const dir = new THREE.DirectionalLight(0xffffff, 1.1);
dir.position.set(50, 80, 40);
scene.add(dir);

// 컨트롤
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

/* =============== 지형 / 캐릭터 =============== */
scene.add(terrainRoot);
scene.add(characterRoot);
characterRoot.scale.setScalar(3);

console.log("[main] characterRoot.uuid =", characterRoot.uuid);

// 더블사이드 보정(선택)
if (terrainRoot.material) {
  const mats = Array.isArray(terrainRoot.material)
    ? terrainRoot.material
    : [terrainRoot.material];
  for (const m of mats) {
    if (m && m.side !== THREE.DoubleSide) {
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    }
  }
}

// 이동 시스템
initMovement({ camera, renderer, terrainRoot, characterRoot });
setMovementParams({ speed: 120, heightOffset: 0.15, slopeAlign: 0.1 });

/* =============== 지형 샘플러 =============== */
const mat = Array.isArray(terrainRoot.material)
  ? terrainRoot.material[0]
  : terrainRoot.material;
const uniforms = mat.uniforms;

const fract = (x) => x - Math.floor(x);
const dot2 = (ax, ay, bx, by) => ax * bx + ay * by;

function hash2(x, y) {
  let px = fract(x * 123.34);
  let py = fract(y * 345.45);
  const d = dot2(px, py, px + 34.345, py + 34.345);
  px += d;
  py += d;
  return fract(px * py) * 2.0 - 1.0;
}
function noise2(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const a = hash2(ix + 0.0, iy + 0.0);
  const b = hash2(ix + 1.0, iy + 0.0);
  const c = hash2(ix + 0.0, iy + 1.0);
  const d = hash2(ix + 1.0, iy + 1.0);
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);
  const ab = a * (1.0 - ux) + b * ux;
  const cd = c * (1.0 - ux) + d * ux;
  return ab * (1.0 - uy) + cd * uy;
}
const fbmRaw = (x, y) => {
  let acc = 0,
    amp = 0.5,
    freq = 1.0;
  for (let i = 0; i < 4; i++) {
    acc += noise2(x * freq, y * freq) * amp;
    freq *= 2.0;
    amp *= 0.5;
  }
  return acc;
};

const worldToLocalXZ = (x, z) => {
  const v = new THREE.Vector3(x, 0, z);
  terrainRoot.worldToLocal(v);
  return { x: v.x, z: v.z };
};

const sampleTerrainHeight = (wx, wz) => {
  terrainRoot.updateMatrixWorld(true);
  const uAmp = uniforms?.uAmp?.value ?? 0;
  const uFreq = uniforms?.uFreq?.value ?? 1;
  const uTimeVal = tickUniforms?.uTime?.value ?? uniforms?.uTime?.value ?? 0;
  const t = uTimeVal * 0.05;

  const { x, z } = worldToLocalXZ(wx, wz);
  const uvx = x * uFreq;
  const uvy = z * uFreq;
  let h = fbmRaw(uvx + t * 0.25, uvy - t * 0.13);
  h += 0.1 * Math.sin((x + z) * 0.03 + t * 0.5);
  const disp = (h - 0.5) * 2.0 * uAmp;

  const p1 = new THREE.Vector3(x, disp, z);
  terrainRoot.localToWorld(p1);
  return p1.y;
};
setTerrainHeightSampler(sampleTerrainHeight);

// 지형 파라미터(더 가파르게)
tickUniforms.uAmp.value = 8.0;
tickUniforms.uFreq.value = 0.05;

// 입력 허용
renderer.domElement.style.pointerEvents = "auto";
controls.enabled = true;

/* =============== Weird Plant 추가 =============== */
const weird = createWeirdPlantRoot({
  genMax: 4,
  step: 0.45,
  baseRadius: 0.14,
  arcDeg: 7,
  budProb: 0.25,
});
scene.add(weird);
weird.position.set(0, 0, 0);
weird.scale.setScalar(1);

/* =============== 리사이즈 =============== */
window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

/* =============== 루프 =============== */
const clock = new THREE.Clock();

function animate() {
  const t = clock.getElapsedTime();
  const dt = clock.getDelta();

  // terrain 시간
  if (tickUniforms) tickUniforms.uTime.value = t;

  // 이동/흔들림
  updateMovement(dt);
  updateWeirdPlant(dt);

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

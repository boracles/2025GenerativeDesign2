import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { terrainRoot, tickUniforms } from "./terrain.js";
import { characterRoot } from "./character.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  initMovement,
  updateMovement,
  setMovementParams,
  setTerrainHeightSampler,
} from "./movement.js";

// 기본 장면/카메라/렌더러
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

// ✅ 기본 환경광(IBL) 세팅: 실내 환경을 빠르게 적용
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// ✅ 라이트 추가 (둘 다 쓰면 안전)
const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.7);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.1);
dir.position.set(50, 80, 40);
dir.castShadow = false; // 그림자 필요하면 true
scene.add(dir);

// 컨트롤
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

// 지형 추가
scene.add(terrainRoot);
scene.add(characterRoot);
characterRoot.scale.setScalar(3);

console.log("[main] characterRoot.uuid =", characterRoot.uuid);

// 레이캐스트가 어느 면이든 맞도록(표시에도 큰 영향 없음)
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

// 이동 시스템 초기화
initMovement({
  camera,
  renderer,
  terrainRoot,
  characterRoot,
});

// 지형을 더 가파르게(높이/주기 강화)
tickUniforms.uAmp.value = 8.0; // 기존 3.0 → 8.0 (세로 높이↑)
tickUniforms.uFreq.value = 0.05; // 기존 0.02 → 0.05 (언덕 촘촘↑)

// ── terrain 머티리얼 유니폼 접근 (uTime, uAmp, uFreq 가 있는 ShaderMaterial 가정)
const mat = Array.isArray(terrainRoot.material)
  ? terrainRoot.material[0]
  : terrainRoot.material;
const uniforms = mat.uniforms; // { uTime, uAmp, uFreq } 있어야 함

// 월드(XZ)→지형 로컬(xz)
const worldToLocalXZ = (x, z) => {
  const v = new THREE.Vector3(x, 0, z);
  terrainRoot.worldToLocal(v);
  return { x: v.x, z: v.z };
};

const fract = (x) => x - Math.floor(x);
const dot2 = (ax, ay, bx, by) => ax * bx + ay * by;

// GLSL hash(vec2 p)와 동일
function hash2(x, y) {
  let px = fract(x * 123.34);
  let py = fract(y * 345.45);
  const d = dot2(px, py, px + 34.345, py + 34.345);
  px += d;
  py += d;
  return fract(px * py) * 2.0 - 1.0;
}

// GLSL noise2(vec2 p)와 동일
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

// ✅ 쉐이더와 동일: 정규화(0~1) 하지 않음
const fbmRaw = (x, y) => {
  let acc = 0,
    amp = 0.5,
    freq = 1.0;
  for (let i = 0; i < 4; i++) {
    acc += noise2(x * freq, y * freq) * amp; // [-1,1] * amp 누적
    freq *= 2.0;
    amp *= 0.5;
  }
  return acc; // ← 정규화 없음
};

// terrain.vert.glsl과 동일 식으로 '월드 기준' 높이 계산 (안전한 2점 변환 방식)
const sampleTerrainHeight = (wx, wz) => {
  // 행렬 최신화
  terrainRoot.updateMatrixWorld(true);

  const uAmp = uniforms?.uAmp?.value ?? 0;
  const uFreq = uniforms?.uFreq?.value ?? 1;
  const uTimeVal = tickUniforms?.uTime?.value ?? uniforms?.uTime?.value ?? 0;

  const t = uTimeVal * 0.05;

  // 1) 월드→로컬 XZ
  const { x, z } = worldToLocalXZ(wx, wz);

  // 2) 로컬에서 vertex와 동일 계산 (disp = 로컬 y 변위)
  const uvx = x * uFreq;
  const uvy = z * uFreq;
  let h = fbmRaw(uvx + t * 0.25, uvy - t * 0.13);
  h += 0.1 * Math.sin((x + z) * 0.03 + t * 0.5);
  const disp = (h - 0.5) * 2.0 * uAmp; // 로컬 y 변위

  // 3) 로컬 점 두 개를 월드로 변환해서 월드 y를 직접 얻는다
  const p0 = new THREE.Vector3(x, 0, z); // 변위 전
  const p1 = new THREE.Vector3(x, disp, z); // 변위 후
  terrainRoot.localToWorld(p0);
  terrainRoot.localToWorld(p1);

  return p1.y; // 이게 해당 (wx, wz)의 '월드 높이'
};

// 등록
setTerrainHeightSampler(sampleTerrainHeight);

setMovementParams({ speed: 120, heightOffset: 0.15, slopeAlign: 0.1 });

// 원하면 파라미터 튜닝
// setMovementParams({ speed: 10, heightOffset: 0.6, slopeAlign: 0.4 });

// main.js 안에서 initMovement 호출 바로 아래에 추가
renderer.domElement.style.pointerEvents = "auto";
controls.enabled = true;

// 리사이즈
window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// 루프
const clock = new THREE.Clock();

function animate() {
  const t = clock.getElapsedTime();
  const dt = clock.getDelta();
  // terrain 유니폼 시간 업데이트
  if (tickUniforms) {
    tickUniforms.uTime.value = t;
  }

  // 이동 업데이트
  updateMovement(dt);

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

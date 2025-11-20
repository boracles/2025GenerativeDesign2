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
  // updateWeirdPlant,
  createWeirdPlantInstance,
  updateWeirdPlantInstance,
} from "./lsystem.js";
import { initBoids, updateBoids } from "./boids.js";

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

// 🔹 배경색 설정
renderer.setClearColor(0x0f2c39, 1); // #820A26

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
characterRoot.scale.setScalar(2);

console.log("[main] characterRoot.uuid =", characterRoot.uuid);

const plants = []; // 보이드와 식물이 같이 공유하는 배열

/* =============== 물결치는 평면 (워터 플레인) =============== */

// 지형과 같은 크기 사용 (terrain.js의 size=200 기준)
const waterSize = 200;
const waterSegs = 128;

const waterGeometry = new THREE.PlaneGeometry(
  waterSize,
  waterSize,
  waterSegs,
  waterSegs
);
waterGeometry.rotateX(-Math.PI / 2);

// 간단 웨이브 셰이더
const waterVert = /* glsl */ `
precision mediump float;

uniform float uTime;
uniform float uAmp;
uniform float uFreq;

varying float vWave;

void main() {
  vec3 p = position;

  // 두 방향 파 superposition
  float w1 = sin((p.x * uFreq) + uTime * 1.5);
  float w2 = cos((p.z * uFreq * 1.3) - uTime * 1.1);

  float wave = (w1 + w2) * 0.5 * uAmp;
  p.y += wave;

  vWave = wave;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const waterFrag = /* glsl */ `
precision mediump float;

uniform vec3 uColorDeep;
uniform vec3 uColorShallow;
uniform float uAlpha;

varying float vWave;

void main() {
  // -uAmp ~ +uAmp 범위를 0~1로 노멀라이즈
  float h = clamp(vWave * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uColorDeep, uColorShallow, h);

  gl_FragColor = vec4(col, uAlpha);
}
`;

// uTime은 terrain과 공유해서 한 시계로 움직이게
const waterUniforms = {
  uTime: tickUniforms.uTime, // 같은 시계 공유
  uAmp: { value: 0.4 }, // 파 높이
  uFreq: { value: 0.08 }, // 파 주기
  uColorDeep: { value: new THREE.Color(0x265d74) }, // terrain uTintA
  uColorShallow: { value: new THREE.Color(0x407e88) },
  uAlpha: { value: 0.7 },
};

const waterMaterial = new THREE.ShaderMaterial({
  vertexShader: waterVert,
  fragmentShader: waterFrag,
  uniforms: waterUniforms,
  transparent: true,
  depthWrite: false,
});

const waterPlane = new THREE.Mesh(waterGeometry, waterMaterial);

// 지형 기준 살짝 위로 띄우기 (골짜기에 물 고인 느낌)
waterPlane.position.y = -0.5;

scene.add(waterPlane);

// 물 표면 높이 샘플러 (boids용)
const sampleWaterHeight = (wx, wz) => {
  // world → local 변환
  const local = new THREE.Vector3(wx, 0, wz);
  waterPlane.worldToLocal(local);

  const x = local.x;
  const z = local.z;

  const uAmp = waterUniforms.uAmp.value;
  const uFreq = waterUniforms.uFreq.value;
  const time = waterUniforms.uTime.value; // tickUniforms.uTime 공유

  const w1 = Math.sin(x * uFreq + time * 1.5);
  const w2 = Math.cos(z * uFreq * 1.3 - time * 1.1);
  const wave = (w1 + w2) * 0.5 * uAmp;

  // local y = wave 를 world y로 변환
  const pLocal = new THREE.Vector3(x, wave, z);
  waterPlane.localToWorld(pLocal);

  return pLocal.y;
};

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
  // 1. world → local 변환
  const local = new THREE.Vector3(wx, 0, wz);
  terrainRoot.worldToLocal(local);

  const x = local.x;
  const z = local.z;

  const uAmp = uniforms?.uAmp?.value ?? 0;
  const uFreq = uniforms?.uFreq?.value ?? 1;

  const uvx = x * uFreq;
  const uvy = z * uFreq;

  let h = fbmRaw(uvx, uvy);
  h += 0.1 * Math.sin((x + z) * 0.03);

  const disp = (h - 0.5) * 2.0 * uAmp;

  const pLocal = new THREE.Vector3(x, disp, z);
  terrainRoot.localToWorld(pLocal);

  return pLocal.y;
};

// 🔹 캐릭터 전용 “네비게이션 높이 샘플러” → 수면 전용
const sampleNavHeight = (wx, wz) => {
  const waterY = sampleWaterHeight(wx, wz); // 수면 높이
  return waterY + 0.02; // 살짝 위로 띄워서 물에 박히지 않게
};

// movement.js에 넘겨주는 건 '수면 높이'
setTerrainHeightSampler(sampleNavHeight);

// 지형 파라미터(더 가파르게)
tickUniforms.uAmp.value = 8.0;
tickUniforms.uFreq.value = 0.05;

// 입력 허용
renderer.domElement.style.pointerEvents = "auto";
controls.enabled = true;

/* =============== 리사이즈 =============== */
window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

function alignToSlope(obj) {
  const p = obj.position;
  const eps = 0.5;

  const hC = sampleTerrainHeight(p.x, p.z);
  const hX = sampleTerrainHeight(p.x + eps, p.z);
  const hZ = sampleTerrainHeight(p.x, p.z + eps);

  const tx = new THREE.Vector3(eps, hX - hC, 0);
  const tz = new THREE.Vector3(0, hZ - hC, eps);

  const n = new THREE.Vector3().crossVectors(tx, tz).normalize();
  if (n.y < 0) n.negate();

  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    n
  );
  obj.quaternion.copy(q);
}

initBoids({
  scene,
  sampleTerrainHeight: sampleTerrainHeight, // 🔥 진짜 지형 높이!
  sampleWaterHeight: sampleWaterHeight,
  plants, // ★ 추가: 같은 배열 참조
  character: characterRoot,
  areaSize: 160,
  count: 40,
  modelPath: "./assets/models/creature.glb",
  clipName: "FeedingTentacle_WaveTest",
});

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function spawnWeirdPlants(
  count = 200,
  areaSize = 180,
  scaleMin = 1.0,
  scaleMax = 6.0,
  waterY = 0.0, // 🔹 수면 높이 전달
  margin = 0.08
) {
  const half = areaSize * 0.5;

  // 🔹 군집 중심 몇 개만 찍어둠 (전체 영역에 흩뿌려)
  const clusterCount = 6;
  const centers = [];
  for (let i = 0; i < clusterCount; i++) {
    centers.push({
      x: randRange(-half * 0.9, half * 0.9),
      z: randRange(-half * 0.9, half * 0.9),
    });
  }

  const clusterInfluence = 0.55; // 이 값이 클수록 군집 느낌 강해짐 (0~1)

  for (let i = 0; i < count; i++) {
    const inst = createWeirdPlantInstance({
      arcDeg: randRange(20, 28),
      genMax: 5,
      plantScale: 1.2,
      step: randRange(0.48, 0.58),
      stepDecay: randRange(0.985, 0.998),
      swayAmp: randRange(0.06, 0.14),
      swayFreq: randRange(0.45, 0.85),
      budProb: randRange(0.18, 0.3),
    });

    // 1) 기본은 전체 영역 랜덤
    let x = randRange(-half, half);
    let z = randRange(-half, half);

    // 2) 일부만 군집 쪽으로 끌어당김
    if (Math.random() < clusterInfluence) {
      const center = centers[(Math.random() * centers.length) | 0];
      const t = randRange(0.4, 0.85); // 1에 가까울수록 더 군집 중심으로 붙음

      x = THREE.MathUtils.lerp(x, center.x, t);
      z = THREE.MathUtils.lerp(z, center.z, t);
    }

    // 뿌리의 지형 높이
    const groundY = sampleTerrainHeight(x, z);

    inst.position.set(x, groundY, z);
    alignToSlope(inst);

    // 기본 높이
    const baseH = inst.userData.baseHeight || 1.0;

    // 랜덤 스케일 먼저
    let s = randRange(scaleMin, scaleMax);

    // 수면 위까지 최소 필요 스케일
    const targetTopY = waterY + margin;
    const neededScale = baseH > 0 ? (targetTopY - groundY) / baseH : scaleMin;

    if (neededScale > s) {
      s = Math.min(neededScale, scaleMax);
    }

    inst.scale.setScalar(s);
    inst.rotation.y = Math.random() * Math.PI * 2;

    inst.userData.isObstacle = true;
    inst.userData.collisionRadius = s * 0.6; // 스케일 기반 대략 반지름

    scene.add(inst);
    plants.push(inst);
  }
}

// 호출: 원하는 개수/범위/크기 지정
spawnWeirdPlants(
  130, // 개수
  180, // 배치 영역 한 변 길이
  1.6, // 최소 스케일
  3.2,
  waterPlane.position.y, // 🔹 수면 높이
  0.12 // 🔹 수면 위로 최소 5cm 정도 나오게
);

const clock = new THREE.Clock();

function animate() {
  const dt = clock.getDelta(); // ✅ 먼저 delta 뽑고
  const t = clock.elapsedTime; // ✅ elapsedTime은 프로퍼티로 읽기

  if (tickUniforms) tickUniforms.uTime.value = t;

  updateMovement(dt);

  for (const p of plants) {
    p.position.y = sampleTerrainHeight(p.position.x, p.position.z);
    alignToSlope(p);
    updateWeirdPlantInstance(p, dt);
  }

  updateBoids(dt);

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

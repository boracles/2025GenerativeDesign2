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
  createWeirdPlantInstance,
  updateWeirdPlantInstance,
} from "./lsystem.js";

import {
  initBoids,
  updateBoids,
  applyPopulationGenomes,
  markSelection,
  markNewborn,
} from "./boids.js";

import {
  GeneticAlgorithm,
  DEATH_ANIM_DURATION,
  NEWBORN_ANIM_DURATION,
} from "./ga.js";

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
renderer.setClearColor(0x0f2c39, 1); // #0f2c39

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

// 세대 전환 시, 죽은 애들 잠잠해진 뒤
// "살아남은 40%"만 잠깐 보여주는 시간(초)
const SURVIVORS_WINDOW = 1.5;

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

/* =============== 랜덤 함수 =============== */
function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

/* =============== 식물 스폰 =============== */
function spawnWeirdPlants(
  count = 200,
  areaSize = 180,
  scaleMin = 1.0,
  scaleMax = 6.0,
  waterY = 0.0, // 수면 높이 전달
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
  waterPlane.position.y, // 수면 높이
  0.12 // 수면 위로 최소 margin
);

/* =============== GA 세팅 =============== */

/* =============== GA 세팅 =============== */

// ★ 40마리를 5타입으로 균등 분배하기 위한 슬롯 패턴 배열
//   (0~7: pattern 0, 8~15: pattern 1, ... 32~39: pattern 4)
const POP_SIZE = 40;
const slotPatternIds = new Array(POP_SIZE);
for (let i = 0; i < POP_SIZE; i++) {
  slotPatternIds[i] = Math.floor((i / POP_SIZE) * 5); // 0~4
}

// GA 인스턴스 생성 (populationSize는 보이드 개수와 맞춘다)
const ga = new GeneticAlgorithm({
  populationSize: POP_SIZE,
  survivalRate: 0.4,
  mutationRate: 0.15,
  crossoverRate: 0.9,
  slotPatternIds, // ★ index별 고정 패턴 전달
});

ga.initPopulation();
const initialPopulation = ga.getPopulation();

// Boids 초기화 시, 초기 Genome을 같이 넘겨준다.
initBoids({
  scene,
  sampleTerrainHeight: sampleTerrainHeight,
  sampleWaterHeight: sampleWaterHeight,
  plants,
  character: characterRoot,
  areaSize: 160,
  count: initialPopulation.length,
  modelPath: "./assets/models/creature.glb",
  clipName: "FeedingTentacle_WaveTest",
  initialGenomes: initialPopulation,
});

// ★ 먼저 세대 관련 상태 변수를 선언하고
let currentGeneration = 0;
let generationTimer = 0;
let pendingNextGen = false;

const guiState = {
  autoRun: true,
  generationDuration: 10, // 초
  generationLabel: () => currentGeneration,
};

const generationHud = document.createElement("div");
generationHud.style.position = "fixed";
generationHud.style.top = "10px";
generationHud.style.left = "10px";
generationHud.style.padding = "4px 8px";
generationHud.style.background = "rgba(0, 0, 0, 0.5)";
generationHud.style.color = "#ffffff";
generationHud.style.fontFamily = "monospace";
generationHud.style.fontSize = "14px";
generationHud.style.zIndex = "1000";
generationHud.textContent = `Generation: ${currentGeneration}`;
document.body.appendChild(generationHud);

function updateGenerationHUD() {
  generationHud.textContent = `Generation: ${currentGeneration}`;
}
updateGenerationHUD();

// 🔥 살아남은 개체 특징 요약 HUD
const survivorHud = document.createElement("div");
survivorHud.style.position = "fixed";
survivorHud.style.top = "40px"; // generationHud 바로 아래
survivorHud.style.left = "10px";
survivorHud.style.padding = "4px 8px";
survivorHud.style.background = "rgba(0, 0, 0, 0.5)";
survivorHud.style.color = "#ffffff";
survivorHud.style.fontFamily = "monospace";
survivorHud.style.fontSize = "12px";
survivorHud.style.zIndex = "1000";
survivorHud.textContent = "Survivors: -";
document.body.appendChild(survivorHud);

/**
 * 살아남은 개체들의 특징을 요약해서 survivorHud에 표시한다.
 * survivors: GA.evaluatePopulation()에서 받은 survivorIndices 배열
 */
function updateSurvivorHUD(survivors) {
  const pop = ga.getPopulation();
  if (!pop || pop.length === 0) {
    survivorHud.textContent = "Survivors: -";
    return;
  }

  const indices =
    Array.isArray(survivors) && survivors.length > 0
      ? survivors
      : pop.map((_, i) => i); // 없으면 전체 기준

  const n = indices.length;
  if (n === 0) {
    survivorHud.textContent = "Survivors: 0";
    return;
  }

  // 패턴 분포 / 평균 크기 / 평균 속도 / 평균 showOff
  const patternCounts = [0, 0, 0, 0, 0]; // 0~4
  let sumScale = 0;
  let sumSpeed = 0;
  let sumShow = 0;

  for (const idx of indices) {
    const g = pop[idx];
    if (!g) continue;

    const pid = Math.max(0, Math.min(4, g.patternId | 0));
    patternCounts[pid]++;

    sumScale += g.bodyScale;
    sumSpeed += g.baseSpeed;
    sumShow += g.showOff;
  }

  const avgScale = (sumScale / n).toFixed(2);
  const avgSpeed = (sumSpeed / n).toFixed(2);
  const avgShow = (sumShow / n).toFixed(2);

  // 패턴 분포를 간단히 텍스트로 (예: P0:3 P1:5 P2:4 ...)
  const patternSummary = patternCounts
    .map((c, i) => (c > 0 ? `P${i}:${c}` : null))
    .filter(Boolean)
    .join(" ");

  survivorHud.textContent = `Survivors(${n}): ${patternSummary} | scale≈${avgScale} | speed≈${avgSpeed} | show≈${avgShow}`;
}

function triggerNextGeneration() {
  if (pendingNextGen) return;

  // 1) 평가 + 생존/도태 결정
  const evalResult = ga.evaluatePopulation();
  const survivors = evalResult.survivorIndices;
  const doomed = evalResult.doomedIndices;

  // 🔥 이 세대에서 살아남은 개체들의 특징을 HUD에 요약
  updateSurvivorHUD(survivors);

  // 2) 시각화: doomed → dying 상태로 전환
  //    (DEATH_ANIM_DURATION 동안 천천히 작아지고 어두워지며 가라앉음)
  markSelection(survivors, doomed, DEATH_ANIM_DURATION);

  // 3) 죽는 애니메이션 동안은 아무 것도 안 하고 기다렸다가
  //    → 그 다음에 "살아남은 40%만" 잠깐 보여주고
  //    → 다시 그 다음에 새 세대를 스폰
  pendingNextGen = true;

  // 3-1) 먼저 죽는 애니메이션이 끝날 때까지 대기
  setTimeout(() => {
    // 이 시점부터는 doomed가 전부 dead + invisible 상태
    // ⇒ 화면에는 survivor 40%만 보이는 구간 시작

    // 3-2) SURVIVORS_WINDOW 동안 "살아남은 40%"만 보여줌
    setTimeout(() => {
      // 이제 다음 세대 생성
      ga.nextGeneration();
      currentGeneration = ga.generation;

      const newPop = ga.getPopulation();

      // 🔥 죽었던 슬롯에만 새 genome 적용 (자식들)
      applyPopulationGenomes(newPop, doomed);

      // 방금 죽었던 슬롯들은 newborn 연출
      markNewborn(doomed, NEWBORN_ANIM_DURATION);

      pendingNextGen = false;
      updateGenerationHUD();
    }, SURVIVORS_WINDOW * 1000);
  }, DEATH_ANIM_DURATION * 1000);
}

// lil-gui (UMD) 전제: index.html에서 <script src="...lil-gui.umd.min.js"></script>
if (window.lil && window.lil.GUI) {
  const gui = new window.lil.GUI();
  const f = gui.addFolder("Genetic Algorithm");

  f.add(guiState, "autoRun").name("Auto Run");
  f.add(guiState, "generationDuration", 1, 60, 1).name("Generation (sec)");
  f.add({ next: () => triggerNextGeneration() }, "next").name(
    "Next Generation"
  );
  f.add(guiState, "generationLabel").name("Generation").listen();

  f.open();
} else {
  console.warn(
    "[main] lil-gui not found. GA GUI disabled. (index.html에 UMD 스크립트 추가 필요)"
  );
}

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

/* =============== 메인 루프 =============== */
const clock = new THREE.Clock();

function animate() {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  if (tickUniforms) tickUniforms.uTime.value = t;

  // GA auto-run 타이머
  generationTimer += dt;
  if (
    guiState.autoRun &&
    !pendingNextGen &&
    generationTimer >= guiState.generationDuration
  ) {
    generationTimer = 0;
    triggerNextGeneration();
  }

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

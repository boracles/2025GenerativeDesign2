// src/boids.js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

// ===== 설정값 =====
const GLB_PATH = "./assets/models/creature.glb";
const CLIP_NAME = "FeedingTentacle_WaveTest";

const BOID_COUNT = 40;
const NEIGHBOR_RADIUS = 18;
const MAX_SPEED_GLOBAL = 6.0; // 전역 상한
const MIN_SPEED_GLOBAL = 1.6; // 전역 하한
const MAX_FORCE = 8.0;
const DAMPING = 1.0;

const WORLD_RADIUS = 80;
const BOUND_RADIUS = 90;

// ───────────────────────────────
// Slime Mold Sensing / Trail
// ───────────────────────────────
const SENSOR_DISTANCE = 12; // 아이데이션에 맞게 조정
const SENSOR_ANGLE = Math.PI / 4; // 45도, 미로면 더 좁게, 탐험형이면 더 넓게

const TRAIL_GRID_SIZE = 128; // trail 해상도 (128x128)
const TRAIL_CELL_SIZE = (BOUND_RADIUS * 2) / TRAIL_GRID_SIZE;

const TRAIL_DEPOSIT_AMOUNT = 1.0;
const TRAIL_DECAY_RATE = 0.96; // 1에 가깝게 → 천천히 사라짐
const W_TRAIL_FOLLOW = 1.5; // 다른 힘과 섞을 가중치

let trailGrid = new Float32Array(TRAIL_GRID_SIZE * TRAIL_GRID_SIZE);

// waterPlane.position.y와 맞춰야 함
const WATER_BASE_LEVEL = -0.5;

// 분리/응집/정렬 계수
const W_SEP = 3.6; // 기존보다 조금 강하게
const W_COH = 1.2;
const W_ALI = 0.8;
const CENTER_K = 0.003;

// 캐릭터 회피
const CHAR_AVOID_RADIUS = 10.0;
const W_CHAR = 6.0;

// 식물 끌림
const W_PLANT = 0.6;
const PLANT_ATTR_RADIUS = 40.0;

// 꽃가루 끌림
const W_POLLEN = 9.0;
const POLLEN_ATTR_RADIUS = 36;

// 보이드 크기 / 최소 간격
const BOID_SCALE = 3.0;
const DESIRED_SEP = BOID_SCALE * 2.4;

// 🔥 보이드-보이드 최소 거리 (하드 충돌용)
const COLLISION_DIST = BOID_SCALE * 2.0;
const COLLISION_DIST2 = COLLISION_DIST * COLLISION_DIST;

// 기본 흐름(원형 유영)
const W_FLOW = 0.24;

// 지형 회피
const W_TERRAIN_AVOID = 5.0;
const TERRAIN_EPS = 0.8;
const TERRAIN_MARGIN = 2.0;
const LAND_CHECK_RADIUS = 2.2;

// 생존 시각화 상수
const SURVIVAL_RATE = 0.4; // (실제 GA에서도 사용됨)
const DEATH_ANIM_DURATION = 2.0; // dying -> dead
const NEWBORN_ANIM_DURATION = 1.0; // newborn -> alive

// showOff 연동용
const SHOWOFF_ROLL_AMP = 0.3;
const SHOWOFF_BOB_AMP = 0.04;

// 임시 벡터
const _terrainForceTemp = new THREE.Vector3();
const _plantForceTemp = new THREE.Vector3();
const _plantAvoidTemp = new THREE.Vector3();
const _pollenForceTemp = new THREE.Vector3();
const _tmpApexWorld = new THREE.Vector3();
const _tmpColor = new THREE.Color();

// ───────────────────────────────
// RD 텍스처 5종 로드
// ───────────────────────────────
const RD_TEXTURE_PATHS = [
  "./assets/textures/rd_pattern.png", // patternId 0
  "./assets/textures/rd_pattern2.png", // patternId 1
  "./assets/textures/rd_pattern3.png", // patternId 2
  "./assets/textures/rd_pattern4.png", // patternId 3
  "./assets/textures/rd_pattern5.png", // patternId 4
];

const textureLoader = new THREE.TextureLoader();
const rdTextures = RD_TEXTURE_PATHS.map((path) => {
  const tex = textureLoader.load(path);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
});

// RD 머티리얼 적용: GLB 메쉬를 MeshStandardMaterial로 통일해두고,
// 색/패턴은 이후 Genome에 의해 결정된다.
function applyRDMaterial(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const geom = obj.geometry;
    if (!geom || !geom.getAttribute("uv")) return;

    const hasVertexColors = !!geom.getAttribute("color");
    const oldMat = obj.material;

    obj.material = new THREE.MeshStandardMaterial({
      map: null,
      roughness: 0.8,
      metalness: 0.1,
      vertexColors: hasVertexColors,
    });

    if (Array.isArray(oldMat)) oldMat.forEach((m) => m?.dispose?.());
    else oldMat?.dispose?.();
  });
}

// ───────────────────────────────
// 내부 상태
// ───────────────────────────────
let boidObjects = []; // THREE.Group (wrapper)
let boidPositions = []; // Vector3 (wrapper.position 참조)
let boidVelocities = []; // Vector3
let mixers = [];

let boidStates = []; // "alive" | "dying" | "dead" | "newborn"
let boidDeathTimers = [];
let boidNewbornTimers = [];
let boidBaseScales = []; // Genome.bodyScale
let boidMaxSpeeds = []; // Genome.baseSpeed
let boidMinSpeeds = []; // Genome.baseSpeed * 0.4
let boidShowOffIntensities = [];
let boidBaseColors = [];

let _sampleTerrainHeight = null;
let _sampleWaterHeight = null;
let _plants = null;
let _character = null;
let _ready = false;

let _timeAccum = 0;
let _deathDuration = DEATH_ANIM_DURATION;
let _newbornDuration = NEWBORN_ANIM_DURATION;

// 유틸
const randRange = (min, max) => Math.random() * (max - min) + min;

// ───────────────────────────────
// 수면 노멀
// ───────────────────────────────
function getWaterNormal(x, z) {
  if (!_sampleWaterHeight) return new THREE.Vector3(0, 1, 0);

  const eps = 0.5;
  const hC = _sampleWaterHeight(x, z);
  const hX = _sampleWaterHeight(x + eps, z);
  const hZ = _sampleWaterHeight(x, z + eps);

  const tx = new THREE.Vector3(eps, hX - hC, 0);
  const tz = new THREE.Vector3(0, hZ - hC, eps);
  const n = new THREE.Vector3().crossVectors(tx, tz).normalize();
  if (n.y < 0) n.negate();
  return n;
}

// ───────────────────────────────
// 주변 육지/해안 여부
// ───────────────────────────────
function isNearLand(x, z) {
  if (!_sampleTerrainHeight || !_sampleWaterHeight) return false;

  const wy = _sampleWaterHeight(x, z);
  const r = LAND_CHECK_RADIUS;

  const offsets = [
    [0, 0],
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
    [r, r],
    [r, -r],
    [-r, r],
    [-r, -r],
  ];

  for (let i = 0; i < offsets.length; i++) {
    const ox = offsets[i][0];
    const oz = offsets[i][1];
    const ty = _sampleTerrainHeight(x + ox, z + oz);
    if (ty > wy - TERRAIN_MARGIN) return true;
  }

  return false;
}

// ───────────────────────────────
// 식물 끌림
// ───────────────────────────────
function getPlantAttraction(pos) {
  const out = _plantForceTemp;
  out.set(0, 0, 0);
  if (!_plants || _plants.length === 0) return out;

  let nearest = null;
  let nearestD2 = PLANT_ATTR_RADIUS * PLANT_ATTR_RADIUS;

  for (const plant of _plants) {
    if (!plant.position) continue;
    const dx = plant.position.x - pos.x;
    const dz = plant.position.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < nearestD2) {
      nearestD2 = d2;
      nearest = plant.position;
    }
  }
  if (!nearest) return out;

  const dx = nearest.x - pos.x;
  const dz = nearest.z - pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 1e-4) return out;

  out.set(dx / dist, 0, dz / dist);
  const t = 1.0 - Math.min(dist / PLANT_ATTR_RADIUS, 1.0);
  out.multiplyScalar(t);
  return out;
}

// ───────────────────────────────
// 지형 회피
// ───────────────────────────────
function getTerrainAvoidForce(pos) {
  const out = _terrainForceTemp;
  out.set(0, 0, 0);
  if (!_sampleTerrainHeight || !_sampleWaterHeight) return out;
  if (!isNearLand(pos.x, pos.z)) return out;

  const hTerrain = _sampleTerrainHeight(pos.x, pos.z);
  const hWater = _sampleWaterHeight(pos.x, pos.z);
  const pen = hTerrain - (hWater - TERRAIN_MARGIN);
  if (pen <= 0) return out;

  const hxP = _sampleTerrainHeight(pos.x + TERRAIN_EPS, pos.z);
  const hxM = _sampleTerrainHeight(pos.x - TERRAIN_EPS, pos.z);
  const hzP = _sampleTerrainHeight(pos.x, pos.z + TERRAIN_EPS);
  const hzM = _sampleTerrainHeight(pos.x, pos.z - TERRAIN_EPS);

  const gx = hxP - hxM;
  const gz = hzP - hzM;
  if (gx === 0 && gz === 0) return out;

  out.set(-gx, 0, -gz).normalize();
  const base = THREE.MathUtils.clamp(pen / TERRAIN_MARGIN, 0.3, 3.0);
  out.multiplyScalar(base * 1.5);
  return out;
}

// ───────────────────────────────
// 식물 회피
// ───────────────────────────────
function getPlantAvoidForce(pos) {
  const out = _plantAvoidTemp;
  out.set(0, 0, 0);
  if (!_plants || _plants.length === 0) return out;

  let count = 0;
  for (const plant of _plants) {
    if (!plant.position) continue;
    const r = (plant.userData?.collisionRadius || 1.0) + BOID_SCALE * 0.7;
    const dx = pos.x - plant.position.x;
    const dz = pos.z - plant.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-4) {
      const d = Math.sqrt(d2);
      const t = 1.0 - d / r;
      out.x += (dx / d) * t;
      out.z += (dz / d) * t;
      count++;
    }
  }
  if (count > 0) out.multiplyScalar(1 / count);
  return out;
}

// ───────────────────────────────
// 꽃가루 끌림
// ───────────────────────────────
function getPollenAttraction(pos) {
  const out = _pollenForceTemp;
  out.set(0, 0, 0);
  if (!_plants || _plants.length === 0) return out;

  let nearest = null;
  let nearestD2 = POLLEN_ATTR_RADIUS * POLLEN_ATTR_RADIUS;

  for (const plant of _plants) {
    const pData = plant.userData && plant.userData.particles;
    if (!pData || !pData.active) continue;

    _tmpApexWorld.copy(pData.apex);
    plant.localToWorld(_tmpApexWorld);

    const dx = _tmpApexWorld.x - pos.x;
    const dz = _tmpApexWorld.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < nearestD2) {
      nearestD2 = d2;
      nearest = _tmpApexWorld.clone();
    }
  }

  if (!nearest) return out;

  const dx = nearest.x - pos.x;
  const dz = nearest.z - pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 1e-4) return out;

  out.set(dx / dist, 0, dz / dist);
  const t = 1.0 - Math.min(dist / POLLEN_ATTR_RADIUS, 1.0);
  out.multiplyScalar(t * t);
  return out;
}

// ───────────────────────────────
// Genome → Boid 적용 헬퍼
// ───────────────────────────────

// ⬇️ color 파라미터 제거, mat.color는 건드리지 않고 텍스처만 설정
function applyColorAndTextureToWrapper(wrapper, patternId) {
  const pid = THREE.MathUtils.clamp(patternId | 0, 0, rdTextures.length - 1);
  const tex = rdTextures[pid];

  wrapper.traverse((obj) => {
    if (!obj.isMesh) return;
    const mat = obj.material;
    if (!mat || !mat.isMeshStandardMaterial) return;
    mat.map = tex;
    mat.needsUpdate = true;
  });
}

/**
 * genome: { hue, value, patternId, bodyScale, baseSpeed, showOff }
 */
function applyGenomeToBoid(index, genome) {
  const wrapper = boidObjects[index];
  if (!wrapper) return;

  // genome 정보만 저장 (색은 머티리얼에 반영하지 않음)
  wrapper.userData.genome = genome;

  // 크기
  boidBaseScales[index] = genome.bodyScale;
  wrapper.scale.setScalar(genome.bodyScale);

  // 속도 / showOff
  boidMaxSpeeds[index] = genome.baseSpeed;
  boidMinSpeeds[index] = genome.baseSpeed * 0.4;
  boidShowOffIntensities[index] = genome.showOff;

  wrapper.visible = true;

  // 텍스처만 genome.patternId로 선택
  applyColorAndTextureToWrapper(wrapper, genome.patternId);
}

// ───────────────────────────────
// 초기화
// ───────────────────────────────
export function initBoids({
  scene,
  sampleTerrainHeight,
  sampleWaterHeight,
  plants = null,
  character = null,
  areaSize = 150,
  count = BOID_COUNT,
  modelPath = GLB_PATH,
  clipName = CLIP_NAME,
  initialGenomes = null, // ★ GA에서 넘기는 초기 Genome 배열
}) {
  _sampleTerrainHeight = sampleTerrainHeight;
  _sampleWaterHeight = sampleWaterHeight;
  _plants = plants;
  _character = character;

  const half = areaSize * 0.5;

  boidObjects = [];
  boidPositions = [];
  boidVelocities = [];
  mixers = [];

  boidStates = [];
  boidDeathTimers = [];
  boidNewbornTimers = [];
  boidBaseScales = [];
  boidMaxSpeeds = [];
  boidMinSpeeds = [];
  boidShowOffIntensities = [];
  boidBaseColors = [];

  const loader = new GLTFLoader();
  loader.load(
    modelPath,
    (gltf) => {
      const baseScene = gltf.scene;
      applyRDMaterial(baseScene);

      const clips = gltf.animations || [];
      const clip =
        (clipName && THREE.AnimationClip.findByName(clips, clipName)) ||
        clips[0] ||
        null;

      for (let i = 0; i < count; i++) {
        let x = 0,
          z = 0,
          waterY = WATER_BASE_LEVEL;
        let found = false;

        for (let t = 0; t < 80; t++) {
          x = randRange(-half, half);
          z = randRange(-half, half);
          if (isNearLand(x, z)) continue;
          waterY = _sampleWaterHeight
            ? _sampleWaterHeight(x, z)
            : WATER_BASE_LEVEL;
          found = true;
          break;
        }

        if (!found && _sampleWaterHeight) {
          waterY = _sampleWaterHeight(x, z);
        }

        const instance = cloneSkinned(baseScene);

        // 🔥 각 인스턴스마다 material을 복제해서 "머티리얼 공유" 끊기
        instance.traverse((obj) => {
          if (!obj.isMesh || !obj.material) return;

          if (Array.isArray(obj.material)) {
            obj.material = obj.material.map((m) => m.clone());
          } else {
            obj.material = obj.material.clone();
          }
        });

        instance.scale.setScalar(BOID_SCALE);
        instance.position.set(0, 0, 0);
        instance.updateWorldMatrix(true, true);

        const box = new THREE.Box3().setFromObject(instance);
        instance.position.y -= box.min.y;

        const wrapper = new THREE.Group();
        wrapper.add(instance);
        wrapper.position.set(x, waterY + 0.01, z);
        wrapper.userData.boidIndex = i;

        wrapper.userData.isObstacle = true;
        wrapper.userData.collisionRadius = BOID_SCALE * 0.5;

        boidObjects.push(wrapper);
        boidPositions.push(wrapper.position);

        const dir = new THREE.Vector3(randRange(-1, 1), 0, randRange(-1, 1))
          .normalize()
          .multiplyScalar(randRange(2.0, 4.0));
        boidVelocities.push(dir);

        boidStates[i] = "alive";
        boidDeathTimers[i] = 0;
        boidNewbornTimers[i] = 0;
        boidBaseScales[i] = BOID_SCALE;
        boidMaxSpeeds[i] = MAX_SPEED_GLOBAL;
        boidMinSpeeds[i] = MIN_SPEED_GLOBAL;
        boidShowOffIntensities[i] = 0;
        boidBaseColors[i] = new THREE.Color(0.8, 0.8, 0.8);

        if (clip) {
          const mixer = new THREE.AnimationMixer(instance);
          mixer.clipAction(clip).play();
          mixers.push(mixer);
        } else {
          mixers.push(null);
        }

        scene.add(wrapper);
      }

      // GA에서 넘어온 초기 유전자 적용
      if (Array.isArray(initialGenomes)) {
        const n = Math.min(initialGenomes.length, boidObjects.length);
        for (let i = 0; i < n; i++) {
          applyGenomeToBoid(i, initialGenomes[i]);
        }
      }

      _ready = true;
      console.log("[boids] loaded GLB & spawned", count);
    },
    undefined,
    (err) => console.error("[boids] GLB load error:", modelPath, err)
  );
}

// ───────────────────────────────
// 외부에서 GA 새 population 적용
// ───────────────────────────────
// population: GA.getPopulation() 배열
// indices: [0, 5, 12, ...] 처럼 “이 슬롯들만” 업데이트하고 싶을 때 사용 (생략 가능)
export function applyPopulationGenomes(population, indices = null) {
  if (!population || !population.length) return;

  const n = Math.min(population.length, boidObjects.length);

  // indices가 주어지면 그 슬롯만 갱신
  if (Array.isArray(indices) && indices.length > 0) {
    for (const idx of indices) {
      if (idx == null) continue;
      if (idx < 0 || idx >= n) continue;
      applyGenomeToBoid(idx, population[idx]);
    }
    return;
  }

  // indices가 없으면 모든 슬롯에 적용 (초기 0세대 때만 사용)
  for (let i = 0; i < n; i++) {
    applyGenomeToBoid(i, population[i]);
  }
}

// ───────────────────────────────
// 생존/도태 시각화용 마킹
// ───────────────────────────────
export function markSelection(
  survivorIndices,
  doomedIndices,
  deathDuration = DEATH_ANIM_DURATION
) {
  _deathDuration = deathDuration;

  if (Array.isArray(doomedIndices)) {
    for (const idx of doomedIndices) {
      if (idx == null || !boidObjects[idx]) continue;
      boidStates[idx] = "dying";
      boidDeathTimers[idx] = 0;
      boidNewbornTimers[idx] = 0;
    }
  }

  if (Array.isArray(survivorIndices)) {
    for (const idx of survivorIndices) {
      if (idx == null || !boidObjects[idx]) continue;
      // 살짝 강조 (스케일 살짝 키웠다가, update에서 원래 값으로 복귀)
      const base = boidBaseScales[idx] || 1.0;
      boidObjects[idx].scale.setScalar(base * 1.05);
    }
  }
}

export function markNewborn(indices, newbornDuration = NEWBORN_ANIM_DURATION) {
  _newbornDuration = newbornDuration;

  if (!Array.isArray(indices)) return;
  for (const idx of indices) {
    if (idx == null || !boidObjects[idx]) continue;
    boidStates[idx] = "newborn";
    boidNewbornTimers[idx] = 0;
    boidDeathTimers[idx] = 0;

    const base = boidBaseScales[idx] || 1.0;
    // 처음에는 아주 작게 시작
    boidObjects[idx].visible = true;
    boidObjects[idx].scale.setScalar(base * 0.2);
  }
}

function worldToTrailIndex(x, z) {
  // 월드(-BOUND_RADIUS ~ +BOUND_RADIUS)를 0~1로 매핑
  const u = (x + BOUND_RADIUS) / (BOUND_RADIUS * 2);
  const v = (z + BOUND_RADIUS) / (BOUND_RADIUS * 2);

  const ix = Math.floor(THREE.MathUtils.clamp(u, 0, 0.999) * TRAIL_GRID_SIZE);
  const iz = Math.floor(THREE.MathUtils.clamp(v, 0, 0.999) * TRAIL_GRID_SIZE);

  return ix + iz * TRAIL_GRID_SIZE;
}

function sampleTrail(x, z) {
  const idx = worldToTrailIndex(x, z);
  return trailGrid[idx];
}

function depositTrail(x, z, amount = TRAIL_DEPOSIT_AMOUNT) {
  const idx = worldToTrailIndex(x, z);
  trailGrid[idx] += amount;
}

function decayTrail() {
  for (let i = 0; i < trailGrid.length; i++) {
    trailGrid[i] *= TRAIL_DECAY_RATE;
  }
}

const _yAxis = new THREE.Vector3(0, 1, 0);
const _tmpDir = new THREE.Vector3();
const _tmpLeftDir = new THREE.Vector3();
const _tmpRightDir = new THREE.Vector3();

// ───────────────────────────────
// Sensing force 함수 만들기
// ───────────────────────────────
function applyTrailSensingForce(agentIndex, accOut) {
  const pos = boidPositions[agentIndex];
  const vel = boidVelocities[agentIndex];

  // 속도가 거의 없으면 방향 판단 불가능 → skip
  if (vel.lengthSq() < 1e-6) return;

  // 1) 현재 진행 방향 단위벡터
  _tmpDir.copy(vel).normalize();

  // 2) 좌/우 센서 방향 (현재 방향 기준 회전)
  _tmpLeftDir.copy(_tmpDir).applyAxisAngle(_yAxis, +SENSOR_ANGLE);
  _tmpRightDir.copy(_tmpDir).applyAxisAngle(_yAxis, -SENSOR_ANGLE);

  // 3) 센서 위치 (샘플링 지점)
  const fx = pos.x + _tmpDir.x * SENSOR_DISTANCE;
  const fz = pos.z + _tmpDir.z * SENSOR_DISTANCE;

  const lx = pos.x + _tmpLeftDir.x * SENSOR_DISTANCE;
  const lz = pos.z + _tmpLeftDir.z * SENSOR_DISTANCE;

  const rx = pos.x + _tmpRightDir.x * SENSOR_DISTANCE;
  const rz = pos.z + _tmpRightDir.z * SENSOR_DISTANCE;

  // 4) trail 값 샘플링
  const valF = sampleTrail(fx, fz);
  const valL = sampleTrail(lx, lz);
  const valR = sampleTrail(rx, rz);

  // 5) 가장 강한 값의 방향 선택
  let bestDir = _tmpDir;
  let bestVal = valF;

  if (valL > bestVal) {
    bestVal = valL;
    bestDir = _tmpLeftDir;
  }
  if (valR > bestVal) {
    bestVal = valR;
    bestDir = _tmpRightDir;
  }

  // 거의 신호가 없으면 steer 필요 없음
  if (bestVal <= 0.001) return;

  // 6) 그 방향으로 힘을 추가
  accOut.addScaledVector(bestDir, W_TRAIL_FOLLOW * bestVal);
}

// ───────────────────────────────
// 매 프레임 업데이트
// ───────────────────────────────
export function updateBoids(dt) {
  if (!_ready) return;

  const count = boidObjects.length;
  if (count === 0) return;

  _timeAccum += dt;

  // 상태별 타이머/애니메이션 업데이트
  for (let i = 0; i < count; i++) {
    const state = boidStates[i];
    const wrapper = boidObjects[i];
    if (!wrapper) continue;

    const baseScale = boidBaseScales[i] || BOID_SCALE;
    const baseColor = boidBaseColors[i] || new THREE.Color(0.8, 0.8, 0.8);

    if (state === "dying") {
      boidDeathTimers[i] += dt;
      const t = THREE.MathUtils.clamp(
        boidDeathTimers[i] / (_deathDuration || DEATH_ANIM_DURATION),
        0,
        1
      );

      // scale 1.0 → 0.2
      const s = THREE.MathUtils.lerp(1.0, 0.2, t);
      wrapper.scale.setScalar(baseScale * s);

      if (boidDeathTimers[i] >= (_deathDuration || DEATH_ANIM_DURATION)) {
        boidStates[i] = "dead";
        wrapper.visible = false;
        if (boidVelocities[i]) {
          boidVelocities[i].set(0, 0, 0);
        }
      }
    } else if (state === "newborn") {
      boidNewbornTimers[i] += dt;
      const t = THREE.MathUtils.clamp(
        boidNewbornTimers[i] / (_newbornDuration || NEWBORN_ANIM_DURATION),
        0,
        1
      );
      const s = THREE.MathUtils.lerp(0.2, 1.0, t);
      wrapper.scale.setScalar(baseScale * s);

      wrapper.visible = true;

      if (boidNewbornTimers[i] >= (_newbornDuration || NEWBORN_ANIM_DURATION)) {
        boidStates[i] = "alive";
        wrapper.scale.setScalar(baseScale);
      }
    } else if (state === "dead") {
      wrapper.visible = false;
    } else {
      // alive: 기본 스케일/색상 유지
      wrapper.visible = true;
      wrapper.scale.setScalar(baseScale);
    }
  }

  // 가속도 배열
  const acc = new Array(count);
  for (let i = 0; i < count; i++) {
    acc[i] = new THREE.Vector3();
  }

  const NEIGHBOR_R2 = NEIGHBOR_RADIUS * NEIGHBOR_RADIUS;

  // 1) force 계산
  for (let i = 0; i < count; i++) {
    if (boidStates[i] === "dead") continue; // 죽은 보이드는 무시

    const posI = boidPositions[i];

    const sep = new THREE.Vector3();
    const coh = new THREE.Vector3();
    const ali = new THREE.Vector3();
    let cohCount = 0;
    let aliCount = 0;

    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      if (boidStates[j] === "dead") continue; // 죽은 개체는 이웃에서 제외

      const posJ = boidPositions[j];

      const dx = posJ.x - posI.x;
      const dz = posJ.z - posI.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > NEIGHBOR_R2 || d2 === 0) continue;

      const d = Math.sqrt(d2);
      const offset = new THREE.Vector3(dx, 0, dz);

      // 너무 가까우면 강하게 밀어내기 (비선형)
      if (d < DESIRED_SEP && d > 0.0001) {
        const dirAway = offset.clone().multiplyScalar(-1.0 / d);
        const t = (DESIRED_SEP - d) / DESIRED_SEP;
        const strength = t * t; // 가까울수록 훨씬 세게
        sep.addScaledVector(dirAway, strength);
      }

      coh.add(posJ);
      cohCount++;
      ali.add(boidVelocities[j]);
      aliCount++;
    }

    if (cohCount > 0) {
      coh.multiplyScalar(1 / cohCount);
      coh.sub(posI);
      coh.y = 0;
      if (coh.length() > 0) coh.normalize();
    }

    if (aliCount > 0) {
      ali.multiplyScalar(1 / aliCount);
      ali.y = 0;
      if (ali.length() > 0) ali.normalize();
    }

    const centerDir = new THREE.Vector3(
      -posI.x * CENTER_K,
      0,
      -posI.z * CENTER_K
    );

    const plantForce = getPlantAttraction(posI);
    const pollenForce = getPollenAttraction(posI);
    const terrainAvoid = getTerrainAvoidForce(posI);
    const plantAvoid = getPlantAvoidForce(posI);

    if (isNearLand(posI.x, posI.z)) terrainAvoid.multiplyScalar(1.6);

    const charForce = new THREE.Vector3();
    if (_character && _character.position) {
      const cp = _character.position;
      const dxC = cp.x - posI.x;
      const dzC = cp.z - posI.z;
      const d2C = dxC * dxC + dzC * dzC;
      const r2C = CHAR_AVOID_RADIUS * CHAR_AVOID_RADIUS;
      if (d2C < r2C && d2C > 1e-4) {
        const distC = Math.sqrt(d2C);
        charForce.set(-dxC / distC, 0, -dzC / distC);
        const t = 1.0 - distC / CHAR_AVOID_RADIUS;
        charForce.multiplyScalar(t);
      }
    }

    const flow = new THREE.Vector3(-posI.z, 0, posI.x);
    if (flow.lengthSq() > 0) flow.normalize();

    const steer = acc[i];

    if (pollenForce.lengthSq() > 0.0) {
      steer
        .addScaledVector(sep, W_SEP * 0.4)
        .addScaledVector(coh, W_COH * 0.8)
        .addScaledVector(ali, W_ALI * 0.8)
        .add(centerDir)
        .addScaledVector(plantForce, W_PLANT * 0.7)
        .addScaledVector(charForce, W_CHAR)
        .addScaledVector(terrainAvoid, W_TERRAIN_AVOID)
        .addScaledVector(plantAvoid, 2.0)
        .addScaledVector(flow, W_FLOW * 0.2)
        .addScaledVector(pollenForce, W_POLLEN * 2.0);
    } else {
      steer
        .addScaledVector(sep, W_SEP)
        .addScaledVector(coh, W_COH)
        .addScaledVector(ali, W_ALI)
        .add(centerDir)
        .addScaledVector(plantForce, W_PLANT)
        .addScaledVector(charForce, W_CHAR)
        .addScaledVector(terrainAvoid, W_TERRAIN_AVOID)
        .addScaledVector(plantAvoid, 3.0)
        .addScaledVector(flow, W_FLOW);
    }

    applyTrailSensingForce(i, steer);

    if (steer.length() > MAX_FORCE) {
      steer.multiplyScalar(MAX_FORCE / steer.length());
    }
  }

  // 2) 적분 + 지형/경계 처리
  const SUBSTEPS = 6;

  for (let i = 0; i < count; i++) {
    if (boidStates[i] === "dead") continue; // dead는 움직이지 않음

    const wrapper = boidObjects[i];
    const p = boidPositions[i];
    const v = boidVelocities[i];

    const prevX = p.x;
    const prevZ = p.z;

    v.addScaledVector(acc[i], dt);

    let speed = v.length();
    const maxSpeed = Math.min(
      boidMaxSpeeds[i] || MAX_SPEED_GLOBAL,
      MAX_SPEED_GLOBAL
    );
    const minSpeed = Math.max(boidMinSpeeds[i] || MIN_SPEED_GLOBAL, 0.1);

    if (speed > maxSpeed) v.multiplyScalar(maxSpeed / speed);

    if (speed < minSpeed) {
      if (speed < 1e-4) {
        v.set(randRange(-1, 1), 0, randRange(-1, 1)).normalize();
        speed = 1.0;
      }
      v.multiplyScalar(minSpeed / (speed + 1e-6));
    }

    if (DAMPING !== 1.0) v.multiplyScalar(DAMPING);

    let newX = prevX;
    let newZ = prevZ;

    const stepX = (v.x * dt) / SUBSTEPS;
    const stepZ = (v.z * dt) / SUBSTEPS;

    for (let s = 1; s <= SUBSTEPS; s++) {
      const testX = newX + stepX;
      const testZ = newZ + stepZ;

      const r2 = testX * testX + testZ * testZ;
      if (r2 > BOUND_RADIUS * BOUND_RADIUS) {
        const inward = new THREE.Vector3(-testX, 0, -testZ).normalize();
        v.copy(
          inward.multiplyScalar(
            Math.max(minSpeed * 1.2, v.length() || minSpeed)
          )
        );
        break;
      }

      if (isNearLand(testX, testZ)) break;

      newX = testX;
      newZ = testZ;
    }

    p.x = newX;
    p.z = newZ;

    // 수면 높이
    let waterY =
      _sampleWaterHeight && _sampleWaterHeight(p.x, p.z) !== undefined
        ? _sampleWaterHeight(p.x, p.z)
        : WATER_BASE_LEVEL;

    if (_sampleWaterHeight) {
      const eps = 0.6;
      const h0 = _sampleWaterHeight(p.x + eps, p.z);
      const h1 = _sampleWaterHeight(p.x - eps, p.z);
      const h2 = _sampleWaterHeight(p.x, p.z + eps);
      const h3 = _sampleWaterHeight(p.x, p.z - eps);
      waterY = Math.max(waterY, h0, h1, h2, h3);
    }

    // 언덕 안으로 들어갔으면 롤백 + 방향 튕기기
    if (_sampleTerrainHeight && _sampleWaterHeight) {
      const terrainYNow = _sampleTerrainHeight(p.x, p.z);
      const waterYNow = _sampleWaterHeight(p.x, p.z);
      if (terrainYNow > waterYNow) {
        p.x = prevX;
        p.z = prevZ;

        const wyPrev = _sampleWaterHeight(prevX, prevZ);
        waterY = wyPrev;

        const avoidDir = getTerrainAvoidForce(p);
        if (avoidDir.lengthSq() > 0) {
          avoidDir.normalize();
          v.copy(
            avoidDir.multiplyScalar(
              Math.max(minSpeed * 1.4, v.length() || minSpeed)
            )
          );
        } else {
          v.set(randRange(-1, 1), 0, randRange(-1, 1))
            .normalize()
            .multiplyScalar(minSpeed * 1.4);
        }
      }
    }

    if (isNearLand(p.x, p.z)) {
      const avoid = getTerrainAvoidForce(p);
      p.addScaledVector(avoid, 1.6);
    }

    // 수면 노멀 + 진행 방향으로 기울이기
    const n = getWaterNormal(p.x, p.z);
    const qSlope = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      n
    );

    const qYaw = new THREE.Quaternion();
    if (v.lengthSq() > 1e-4) {
      const yaw = Math.atan2(v.x, v.z);
      qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    } else {
      qYaw.identity();
    }

    wrapper.quaternion.copy(qSlope).multiply(qYaw);

    // showOff 기반 롤링/바운스
    const showOff = boidShowOffIntensities[i] || 0;
    if (showOff > 0) {
      const norm = THREE.MathUtils.clamp(showOff / 8.0, 0.0, 1.0);
      const rollAngle =
        Math.sin(_timeAccum * (1.5 + norm * 3.0) + i) * SHOWOFF_ROLL_AMP * norm;
      const qRoll = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        rollAngle
      );
      wrapper.quaternion.multiply(qRoll);

      const bobOffset =
        Math.sin(_timeAccum * (1.0 + norm * 2.0) + i * 0.7) *
        SHOWOFF_BOB_AMP *
        norm;
      p.y = waterY + 0.01 + bobOffset;
    } else {
      p.y = waterY + 0.01;
    }

    const mixer = mixers[i];
    if (mixer) mixer.update(dt);
  }

  // 3) 보이드-보이드 하드 충돌 (가벼운 버전, 지형 샘플링 없음)
  for (let i = 0; i < count; i++) {
    if (boidStates[i] === "dead") continue;
    const pi = boidPositions[i];
    for (let j = i + 1; j < count; j++) {
      if (boidStates[j] === "dead") continue;
      const pj = boidPositions[j];

      const dx = pj.x - pi.x;
      const dz = pj.z - pi.z;
      const d2 = dx * dx + dz * dz;
      if (d2 === 0 || d2 > COLLISION_DIST2) continue;

      const d = Math.sqrt(d2);
      const overlap = COLLISION_DIST - d;
      if (overlap <= 0) continue;

      const nx = dx / d;
      const nz = dz / d;
      const move = overlap * 0.5;

      // 위치 벌리기
      pi.x -= nx * move;
      pi.z -= nz * move;
      pj.x += nx * move;
      pj.z += nz * move;

      // 속도도 서로 반대로 살짝 밀어줌 (겹쳐있는 상태 유지 방지)
      const vi = boidVelocities[i];
      const vj = boidVelocities[j];
      vi.x -= nx * 0.3;
      vi.z -= nz * 0.3;
      vj.x += nx * 0.3;
      vj.z += nz * 0.3;
    }
  }
}

// src/boids.js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

// ===== 설정값 =====
const GLB_PATH = "./assets/models/creature.glb";
const CLIP_NAME = "FeedingTentacle_WaveTest";

const BOID_COUNT = 40;
const NEIGHBOR_RADIUS = 18;
const MAX_SPEED = 6.0;
const MIN_SPEED = 1.6;
const MAX_FORCE = 8.0;
const DAMPING = 1.0;

const WORLD_RADIUS = 80;
const BOUND_RADIUS = 90;

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

// 임시 벡터
const _terrainForceTemp = new THREE.Vector3();
const _plantForceTemp = new THREE.Vector3();
const _plantAvoidTemp = new THREE.Vector3();
const _pollenForceTemp = new THREE.Vector3();
const _tmpApexWorld = new THREE.Vector3();

// ===== RD 텍스처 =====
const RD_URL = "./assets/textures/rd_pattern.png";
const textureLoader = new THREE.TextureLoader();
const rdTexture = textureLoader.load(RD_URL, (tex) => {
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
});

// RD 머티리얼 적용
function applyRDMaterial(root, tex) {
  if (!tex) return;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const geom = obj.geometry;
    if (!geom || !geom.getAttribute("uv")) return;

    const hasVertexColors = !!geom.getAttribute("color");
    const oldMat = obj.material;

    obj.material = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.8,
      metalness: 0.1,
      vertexColors: hasVertexColors,
    });

    if (Array.isArray(oldMat)) oldMat.forEach((m) => m?.dispose?.());
    else oldMat?.dispose?.();
  });
}

// ===== 내부 상태 =====
let boidObjects = [];
let boidPositions = [];
let boidVelocities = [];
let mixers = [];

let _sampleTerrainHeight = null;
let _sampleWaterHeight = null;
let _plants = null;
let _character = null;
let _ready = false;

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

  const loader = new GLTFLoader();
  loader.load(
    modelPath,
    (gltf) => {
      const baseScene = gltf.scene;
      applyRDMaterial(baseScene, rdTexture);

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
        instance.scale.setScalar(BOID_SCALE);
        instance.position.set(0, 0, 0);
        instance.updateWorldMatrix(true, true);

        const box = new THREE.Box3().setFromObject(instance);
        instance.position.y -= box.min.y;

        const wrapper = new THREE.Group();
        wrapper.add(instance);
        wrapper.position.set(x, waterY + 0.01, z);

        wrapper.userData.isObstacle = true;
        wrapper.userData.collisionRadius = BOID_SCALE * 0.5;

        boidObjects.push(wrapper);
        boidPositions.push(wrapper.position);

        const dir = new THREE.Vector3(randRange(-1, 1), 0, randRange(-1, 1))
          .normalize()
          .multiplyScalar(randRange(2.0, 4.0));
        boidVelocities.push(dir);

        if (clip) {
          const mixer = new THREE.AnimationMixer(instance);
          mixer.clipAction(clip).play();
          mixers.push(mixer);
        } else {
          mixers.push(null);
        }

        scene.add(wrapper);
      }

      _ready = true;
      console.log("[boids] loaded GLB & spawned", count);
    },
    undefined,
    (err) => console.error("[boids] GLB load error:", modelPath, err)
  );
}

// ───────────────────────────────
// 매 프레임 업데이트
// ───────────────────────────────
export function updateBoids(dt) {
  if (!_ready) return;

  const count = boidObjects.length;
  if (count === 0) return;

  const acc = new Array(count);
  for (let i = 0; i < count; i++) {
    acc[i] = new THREE.Vector3();
  }

  const NEIGHBOR_R2 = NEIGHBOR_RADIUS * NEIGHBOR_RADIUS;

  // 1) force 계산
  for (let i = 0; i < count; i++) {
    const posI = boidPositions[i];

    const sep = new THREE.Vector3();
    const coh = new THREE.Vector3();
    const ali = new THREE.Vector3();
    let cohCount = 0;
    let aliCount = 0;

    for (let j = 0; j < count; j++) {
      if (i === j) continue;
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

    if (steer.length() > MAX_FORCE) {
      steer.multiplyScalar(MAX_FORCE / steer.length());
    }
  }

  // 2) 적분 + 지형/경계 처리
  const SUBSTEPS = 6;

  for (let i = 0; i < count; i++) {
    const wrapper = boidObjects[i];
    const p = boidPositions[i];
    const v = boidVelocities[i];

    const prevX = p.x;
    const prevZ = p.z;

    v.addScaledVector(acc[i], dt);

    let speed = v.length();
    if (speed > MAX_SPEED) v.multiplyScalar(MAX_SPEED / speed);

    if (speed < MIN_SPEED) {
      if (speed < 1e-4) {
        v.set(randRange(-1, 1), 0, randRange(-1, 1)).normalize();
        speed = 1.0;
      }
      v.multiplyScalar(MIN_SPEED / (speed + 1e-6));
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
            Math.max(MIN_SPEED * 1.2, v.length() || MIN_SPEED)
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
              Math.max(MIN_SPEED * 1.4, v.length() || MIN_SPEED)
            )
          );
        } else {
          v.set(randRange(-1, 1), 0, randRange(-1, 1))
            .normalize()
            .multiplyScalar(MIN_SPEED * 1.4);
        }
      }
    }

    if (isNearLand(p.x, p.z)) {
      const avoid = getTerrainAvoidForce(p);
      p.addScaledVector(avoid, 1.6);
    }

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
    p.y = waterY + 0.01;

    const mixer = mixers[i];
    if (mixer) mixer.update(dt);
  }

  // 3) 보이드-보이드 하드 충돌 (가벼운 버전, 지형 샘플링 없음)
  for (let i = 0; i < count; i++) {
    const pi = boidPositions[i];
    for (let j = i + 1; j < count; j++) {
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

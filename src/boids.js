import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

// ===== 설정값 =====
const GLB_PATH = "./assets/models/creature.glb";
const CLIP_NAME = "FeedingTentacle_WaveTest";

const BOID_COUNT = 40;
const NEIGHBOR_RADIUS = 18;
const MAX_SPEED = 14.0;
const MIN_SPEED = 4.0;
const MAX_FORCE = 8.0;
// 🔹 계속 유영하게: 감쇠 제거
const DAMPING = 1.0;

const WORLD_RADIUS = 80;

// 분리/응집/정렬
const W_SEP = 2.4;
const W_COH = 1.2;
const W_ALI = 0.8;
const CENTER_K = 0.003;

// 캐릭터 회피
const CHAR_AVOID_RADIUS = 10.0;
const W_CHAR = 6.0;

// 식물 끌림 힘
const W_PLANT = 0.6;
const PLANT_ATTR_RADIUS = 40.0;

// 캐릭터 스케일 설정
const BOID_SCALE = 3.0;
// 🔹 보이드끼리 최소 간격
const DESIRED_SEP = BOID_SCALE * 1.2;
const W_FLOW = 0.45; // 기본 순환 흐름 세기

// ===== RD 텍스처 =====
const RD_URL = "./assets/textures/rd_pattern.png";

const textureLoader = new THREE.TextureLoader();
const rdTexture = textureLoader.load(
  RD_URL,
  (tex) => {
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
  },
  undefined,
  (err) => {
    console.error("[boids] RD texture load failed:", RD_URL, err);
  }
);

// RD 머티리얼 적용
function applyRDMaterial(root, tex) {
  if (!tex) return;

  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);

  root.traverse((obj) => {
    if (!obj.isMesh) return;

    const geom = obj.geometry;
    if (!geom || !geom.getAttribute) return;

    if (!geom.getAttribute("uv")) {
      console.warn(
        `[boids] UV missing on mesh "${
          obj.name || "(unnamed)"
        }" — RD map skipped.`
      );
      return;
    }

    const oldMat = obj.material;
    const hasVertexColors = !!geom.getAttribute("color");

    const newMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.8,
      metalness: 0.1,
      vertexColors: hasVertexColors,
    });

    obj.material = newMat;
    obj.material.needsUpdate = true;

    try {
      if (Array.isArray(oldMat)) oldMat.forEach((m) => m?.dispose?.());
      else oldMat?.dispose?.();
    } catch {}
  });
}

// ===== 내부 상태 =====
let boidObjects = [];
let boidPositions = [];
let boidVelocities = [];
let mixers = [];

let _scene = null;
let _ready = false;

let _sampleTerrainHeight = null; // 지형(섬) 높이
let _sampleWaterHeight = null; // 물 표면 높이
let _plants = null; // main.js에서 넘겨주는 식물 배열
let _character = null;

const loader = new GLTFLoader();

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

// ──────────────────────────────────────────────
// 노멀 계산 (워터 플레인 기준)
// ──────────────────────────────────────────────
const _tmpTx = new THREE.Vector3();
const _tmpTz = new THREE.Vector3();
const _tmpN = new THREE.Vector3();

function getWaterNormal(x, z) {
  if (!_sampleWaterHeight) return new THREE.Vector3(0, 1, 0);

  const eps = 0.5;
  const hC = _sampleWaterHeight(x, z);
  const hX = _sampleWaterHeight(x + eps, z);
  const hZ = _sampleWaterHeight(x, z + eps);

  _tmpTx.set(eps, hX - hC, 0);
  _tmpTz.set(0, hZ - hC, eps);

  _tmpN.crossVectors(_tmpTx, _tmpTz).normalize();
  if (_tmpN.y < 0.0) _tmpN.negate();

  return _tmpN.clone();
}

// ──────────────────────────────────────────────
// 식물 끌림 힘 계산
// ──────────────────────────────────────────────
const _plantForceTemp = new THREE.Vector3();

function getPlantAttraction(pos) {
  const out = _plantForceTemp;
  out.set(0, 0, 0);

  if (!_plants || _plants.length === 0) return out;

  let nearest = null;
  let nearestD2 = PLANT_ATTR_RADIUS * PLANT_ATTR_RADIUS;

  for (let i = 0; i < _plants.length; i++) {
    const plant = _plants[i];
    if (!plant || !plant.position) continue;

    const pp = plant.position;
    const dx = pp.x - pos.x;
    const dz = pp.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < nearestD2) {
      nearestD2 = d2;
      nearest = pp;
    }
  }

  if (!nearest) return out;

  out.set(nearest.x - pos.x, 0, nearest.z - pos.z);
  const dist = Math.sqrt(nearestD2);
  if (dist > 1e-4) {
    const strength = 1.0 / (dist + 4.0);
    out.multiplyScalar(strength);
  }

  return out;
}

// ──────────────────────────────────────────────
// 초기화: main.js에서 한 번만 호출
// ──────────────────────────────────────────────
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
  _scene = scene;
  _sampleTerrainHeight = sampleTerrainHeight;
  _sampleWaterHeight = sampleWaterHeight;
  _plants = plants;
  _character = character;

  const half = areaSize * 0.5;

  boidObjects = [];
  boidPositions = [];
  boidVelocities = [];
  mixers = [];

  loader.load(
    modelPath,
    (gltf) => {
      const baseScene = gltf.scene;
      const clips = gltf.animations || [];

      applyRDMaterial(baseScene, rdTexture);

      let clip = null;
      if (clips.length > 0) {
        clip =
          (clipName && THREE.AnimationClip.findByName(clips, clipName)) ||
          clips[0];
      }

      for (let i = 0; i < count; i++) {
        // 초기 위치: 물 위만
        let x = 0,
          z = 0,
          waterY = 0,
          terrainY = 0;
        const maxTries = 30;
        let found = false;

        for (let t = 0; t < maxTries; t++) {
          x = randRange(-half, half);
          z = randRange(-half, half);

          waterY = _sampleWaterHeight ? _sampleWaterHeight(x, z) : 0;
          terrainY = _sampleTerrainHeight ? _sampleTerrainHeight(x, z) : -9999;

          if (terrainY < waterY - 0.02) {
            found = true;
            break;
          }
        }
        if (!found && _sampleWaterHeight) {
          waterY = _sampleWaterHeight(x, z);
        }

        const instance = cloneSkinned(baseScene);
        instance.scale.setScalar(BOID_SCALE);

        instance.position.set(0, 0, 0);
        instance.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(instance);
        const minY = box.min.y;
        instance.position.y -= minY;

        const wrapper = new THREE.Group();
        wrapper.add(instance);
        wrapper.position.set(x, waterY + 0.01, z);

        wrapper.userData.isObstacle = true;
        wrapper.userData.collisionRadius = BOID_SCALE * 0.5;

        _scene.add(wrapper);
        boidObjects.push(wrapper);
        boidPositions.push(wrapper.position);

        // 초기 속도
        const dir = new THREE.Vector3(randRange(-1, 1), 0, randRange(-1, 1));
        if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
        dir.normalize().multiplyScalar(randRange(2.0, 4.0));
        boidVelocities.push(dir.clone());

        if (clip) {
          const mixer = new THREE.AnimationMixer(instance);
          const action = mixer.clipAction(clip);
          action.play();
          mixers.push(mixer);
        } else {
          mixers.push(null);
        }
      }

      _ready = true;
      console.log(`[boids] loaded GLB & spawned ${count} boids (water+plants)`);
    },
    undefined,
    (err) => {
      console.error("[boids] GLB load error:", modelPath, err);
    }
  );
}

// ──────────────────────────────────────────────
// 매 프레임 업데이트
// ──────────────────────────────────────────────
export function updateBoids(dt) {
  if (!_ready) return;

  const count = boidObjects.length;
  if (count === 0) return;

  const NEIGHBOR_R2 = NEIGHBOR_RADIUS * NEIGHBOR_RADIUS;
  const acc = new Array(count);
  for (let i = 0; i < count; i++) {
    if (!acc[i]) acc[i] = new THREE.Vector3();
    acc[i].set(0, 0, 0);
  }

  // 1) 이웃 + 식물 끌림 + 캐릭터 회피 힘 계산
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

      // 🔹 일정 거리 이내면 강하게 밀어내기 (겹침 방지)
      if (d < DESIRED_SEP && d > 0.0001) {
        const dirAway = offset.clone().multiplyScalar(-1.0 / d); // 단위벡터 반대방향
        const strength = (DESIRED_SEP - d) / DESIRED_SEP; // 0~1
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

    // 🔹 분리 벡터 너무 커지지 않게
    if (sep.length() > 0) {
      sep.normalize();
    }

    const centerDir = new THREE.Vector3()
      .subVectors(new THREE.Vector3(0, posI.y, 0), posI)
      .multiplyScalar(CENTER_K);

    const r = Math.sqrt(posI.x * posI.x + posI.z * posI.z);
    if (r > WORLD_RADIUS) {
      const nx = posI.x / r;
      const nz = posI.z / r;
      centerDir.addScaledVector(
        new THREE.Vector3(-nx, 0, -nz),
        0.05 * (r - WORLD_RADIUS)
      );
    }

    const plantForce = getPlantAttraction(posI);

    // 🔹 캐릭터 회피 힘
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
        const t = 1.0 - distC / CHAR_AVOID_RADIUS; // 가까울수록 강하게
        charForce.multiplyScalar(t);
      }
    }

    // 🔹 기본 유영 흐름(원 궤도) – 항상 약간씩 회전
    const flow = new THREE.Vector3(-posI.z, 0, posI.x);
    if (flow.lengthSq() > 0) {
      flow.normalize(); // 원둘레 방향
    }

    const steer = new THREE.Vector3()
      .addScaledVector(sep, W_SEP)
      .addScaledVector(coh, W_COH)
      .addScaledVector(ali, W_ALI)
      .add(centerDir)
      .addScaledVector(plantForce, W_PLANT)
      .addScaledVector(charForce, W_CHAR) // ✅ 캐릭터 회피 실제 반영
      .addScaledVector(flow, W_FLOW); // ✅ 항상 흐름 추가

    if (steer.length() > MAX_FORCE) {
      steer.multiplyScalar(MAX_FORCE / steer.length());
    }

    acc[i].add(steer);
  }

  // 2) 적분 + 워터 플레인 위로 스냅 + 섬 회피 + 최소 속도 보장
  const ISLAND_MARGIN = 0.02;

  for (let i = 0; i < count; i++) {
    const wrapper = boidObjects[i];
    const p = boidPositions[i];
    const v = boidVelocities[i];

    const prevX = p.x;
    const prevZ = p.z;

    // 속도 업데이트
    v.addScaledVector(acc[i], dt);

    let speed = v.length();
    if (speed > MAX_SPEED) v.multiplyScalar(MAX_SPEED / speed);

    // 🔹 속도가 너무 느리면 최소 속도까지 부스트
    if (speed < MIN_SPEED) {
      if (speed < 1e-4) {
        v.set(randRange(-1, 1), 0, randRange(-1, 1)).normalize();
        speed = 1.0;
      }
      v.multiplyScalar(MIN_SPEED / (speed + 1e-6));
    }

    // 감쇠는 없음 (항상 유영)
    if (DAMPING !== 1.0) {
      v.multiplyScalar(DAMPING);
    }

    p.x += v.x * dt;
    p.z += v.z * dt;

    let waterY = _sampleWaterHeight ? _sampleWaterHeight(p.x, p.z) : 0;

    let terrainY =
      _sampleTerrainHeight && _sampleTerrainHeight(p.x, p.z) != null
        ? _sampleTerrainHeight(p.x, p.z)
        : -9999;

    if (terrainY > waterY - ISLAND_MARGIN) {
      p.x = prevX;
      p.z = prevZ;
      v.x *= -0.5;
      v.z *= -0.5;

      waterY = _sampleWaterHeight ? _sampleWaterHeight(p.x, p.z) : waterY;
    }

    if (_sampleWaterHeight) {
      const eps = 0.6;
      const h0 = _sampleWaterHeight(p.x + eps, p.z);
      const h1 = _sampleWaterHeight(p.x - eps, p.z);
      const h2 = _sampleWaterHeight(p.x, p.z + eps);
      const h3 = _sampleWaterHeight(p.x, p.z - eps);
      waterY = Math.max(waterY, h0, h1, h2, h3);
    }

    const n = getWaterNormal(p.x, p.z);

    const qSlope = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      n
    );

    let qYaw = new THREE.Quaternion();
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
}

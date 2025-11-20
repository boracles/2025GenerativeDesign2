// src/boids.js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

// ===== 설정값 =====
const GLB_PATH = "./assets/models/creature.glb";
const CLIP_NAME = "FeedingTentacle_WaveTest";

const BOID_COUNT = 40;
const NEIGHBOR_RADIUS = 10;
const MAX_SPEED = 6.0;
const MAX_FORCE = 8.0;
const DAMPING = 0.96;
const WORLD_RADIUS = 80;

const W_SEP = 1.4;
const W_COH = 0.6;
const W_ALI = 0.6;
const CENTER_K = 0.01;

// 캐릭터 스케일 설정
const BOID_SCALE = 3.0;

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
let boidObjects = []; // THREE.Group (wrapper)
let boidPositions = []; // wrapper.position 참조
let boidVelocities = [];
let mixers = [];

let _scene = null;
let _ready = false;

// 샘플러
let _sampleTerrainHeight = null; // 지형(섬) 높이
let _sampleWaterHeight = null; // 물 표면 높이

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
// 초기화: main.js에서 한 번만 호출
// ──────────────────────────────────────────────
export function initBoids({
  scene,
  sampleTerrainHeight, // 지형 높이 샘플러
  sampleWaterHeight, // 물 높이 샘플러
  areaSize = 150,
  count = BOID_COUNT,
  modelPath = GLB_PATH,
  clipName = CLIP_NAME,
}) {
  _scene = scene;
  _sampleTerrainHeight = sampleTerrainHeight;
  _sampleWaterHeight = sampleWaterHeight;

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
        // ─ 초기 위치: "물 위"인 곳만 찾기 ─
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

          // 섬(지형이 물 위로 튀어나온 곳)은 제외
          if (terrainY < waterY - 0.02) {
            found = true;
            break;
          }
        }
        if (!found && _sampleWaterHeight) {
          waterY = _sampleWaterHeight(x, z);
        }

        // GLB 인스턴스 생성 + 스케일
        const instance = cloneSkinned(baseScene);
        instance.scale.setScalar(BOID_SCALE);

        // 바닥이 로컬 y=0에 오도록
        instance.position.set(0, 0, 0);
        instance.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(instance);
        const minY = box.min.y;
        instance.position.y -= minY;

        // 래퍼 그룹
        const wrapper = new THREE.Group();
        wrapper.add(instance);
        wrapper.position.set(x, waterY + 0.01, z); // 물 표면에 거의 딱 붙게

        _scene.add(wrapper);
        boidObjects.push(wrapper);
        boidPositions.push(wrapper.position);

        // 초기 속도
        const dir = new THREE.Vector3(randRange(-1, 1), 0, randRange(-1, 1));
        if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
        dir.normalize().multiplyScalar(randRange(1, 3));
        boidVelocities.push(dir.clone());

        // 애니메이션
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
      console.log(`[boids] loaded GLB & spawned ${count} boids (water nav)`);
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

  // 1) 이웃 기반 힘 계산
  for (let i = 0; i < count; i++) {
    const posI = boidPositions[i];
    const velI = boidVelocities[i];

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

      const dir = new THREE.Vector3(dx, 0, dz);
      const sepForce = dir.clone().multiplyScalar(-1 / d2);
      sep.add(sepForce);

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

    if (sep.length() > 0) sep.normalize();

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

    const steer = new THREE.Vector3()
      .addScaledVector(sep, W_SEP)
      .addScaledVector(coh, W_COH)
      .addScaledVector(ali, W_ALI)
      .add(centerDir);

    if (steer.length() > MAX_FORCE) {
      steer.multiplyScalar(MAX_FORCE / steer.length());
    }

    acc[i].add(steer);
  }

  // 2) 적분 + 워터 플레인 위로 스냅 + 섬 회피
  const ISLAND_MARGIN = 0.02; // 지형이 물보다 이만큼 높으면 섬이라고 봄

  for (let i = 0; i < count; i++) {
    const wrapper = boidObjects[i];
    const p = boidPositions[i]; // == wrapper.position
    const v = boidVelocities[i];

    // 이전 위치 저장 (섬 충돌 시 롤백용)
    const prevX = p.x;
    const prevZ = p.z;

    // 속도 업데이트
    v.addScaledVector(acc[i], dt);

    const speed = v.length();
    if (speed > MAX_SPEED) v.multiplyScalar(MAX_SPEED / speed);
    v.multiplyScalar(DAMPING);

    // XZ 이동
    p.x += v.x * dt;
    p.z += v.z * dt;

    // 물 높이
    let waterY = _sampleWaterHeight ? _sampleWaterHeight(p.x, p.z) : 0;

    // 섬(terrain > water) 체크
    let terrainY =
      _sampleTerrainHeight && _sampleTerrainHeight(p.x, p.z) != null
        ? _sampleTerrainHeight(p.x, p.z)
        : -9999;

    if (terrainY > waterY - ISLAND_MARGIN) {
      // 섬에 올라타려고 하면 이전 위치로 롤백 + 속도 반사
      p.x = prevX;
      p.z = prevZ;
      v.x *= -0.5;
      v.z *= -0.5;

      // 롤백 위치에서 다시 waterY 재계산
      waterY = _sampleWaterHeight ? _sampleWaterHeight(p.x, p.z) : waterY;
    }

    // 주변 물 높이도 같이 보고, 가장 높은 곳에 살짝 띄우기
    if (_sampleWaterHeight) {
      const eps = 0.6;
      const h0 = _sampleWaterHeight(p.x + eps, p.z);
      const h1 = _sampleWaterHeight(p.x - eps, p.z);
      const h2 = _sampleWaterHeight(p.x, p.z + eps);
      const h3 = _sampleWaterHeight(p.x, p.z - eps);
      waterY = Math.max(waterY, h0, h1, h2, h3);
    }

    // 노멀: 워터 플레인 기준
    const n = getWaterNormal(p.x, p.z);

    const qSlope = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      n
    );

    // 진행 방향 yaw
    let qYaw = new THREE.Quaternion();
    if (v.lengthSq() > 1e-4) {
      const yaw = Math.atan2(v.x, v.z);
      qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    } else {
      qYaw.identity();
    }

    wrapper.quaternion.copy(qSlope).multiply(qYaw);

    // 최종 y: 물 표면에 거의 딱 붙게
    p.y = waterY + 0.01;

    // 애니메이션
    const mixer = mixers[i];
    if (mixer) mixer.update(dt);
  }
}

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
const BOID_SCALE = 3.0; // 최종 스케일 배율

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

let _sampleHeight = null;
let _scene = null;
let _ready = false;

// ★ 지형 메쉬 & 높이 보정값
let _terrainMesh = null;
let _heightBias = 0;

// 레이캐스트 (보정용으로만 한 번 사용)
const _raycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3(0, -1, 0);

const loader = new GLTFLoader();

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

// ──────────────────────────────────────────────
// 지형 높이 헬퍼: 샘플러 + bias
// ──────────────────────────────────────────────
function getBoidTerrainHeight(x, z) {
  if (typeof _sampleHeight !== "function") return 0;
  return _sampleHeight(x, z) + _heightBias;
}

// ──────────────────────────────────────────────
// 지형 노멀 계산 헬퍼 (샘플러 기반, bias는 상수라 무시)
// ──────────────────────────────────────────────
const _tmpTx = new THREE.Vector3();
const _tmpTz = new THREE.Vector3();
const _tmpN = new THREE.Vector3();

function getTerrainNormal(x, z) {
  if (!_sampleHeight) return new THREE.Vector3(0, 1, 0);

  const eps = 0.5;
  const hC = _sampleHeight(x, z);
  const hX = _sampleHeight(x + eps, z);
  const hZ = _sampleHeight(x, z + eps);

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
  sampleTerrainHeight,
  areaSize = 150,
  count = BOID_COUNT,
  modelPath = GLB_PATH,
  clipName = CLIP_NAME,
  terrainMesh = null, // ★ terrainRoot 넘겨받기
}) {
  _scene = scene;
  _sampleHeight = sampleTerrainHeight;
  _terrainMesh = terrainMesh;

  const half = areaSize * 0.5;

  boidObjects = [];
  boidPositions = [];
  boidVelocities = [];
  mixers = [];

  // ── ★ 높이 bias 한 번만 보정 ──
  _heightBias = 0;
  if (_terrainMesh && typeof _sampleHeight === "function") {
    _terrainMesh.updateWorldMatrix(true, false);

    const samples = 40; // 샘플 수
    let sumDelta = 0;
    let hitCount = 0;

    for (let i = 0; i < samples; i++) {
      const x = randRange(-half, half);
      const z = randRange(-half, half);

      const hFunc = _sampleHeight(x, z);

      _rayOrigin.set(x, 1000, z);
      _rayDir.set(0, -1, 0);
      _raycaster.set(_rayOrigin, _rayDir);

      const hits = _raycaster.intersectObject(_terrainMesh, false);
      if (hits.length > 0) {
        const hMesh = hits[0].point.y;
        sumDelta += hMesh - hFunc;
        hitCount++;
      }
    }

    if (hitCount > 0) {
      _heightBias = sumDelta / hitCount;
      console.log(
        "[boids] terrain height bias =",
        _heightBias.toFixed(4),
        "(avg over",
        hitCount,
        "samples)"
      );
    } else {
      console.warn(
        "[boids] height bias calibration failed (no raycast hits); using 0"
      );
      _heightBias = 0;
    }
  }

  // ── GLB 로드 및 boid 생성 ──
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
        const x = randRange(-half, half);
        const z = randRange(-half, half);

        const terrainY = getBoidTerrainHeight(x, z);

        // GLB 인스턴스 생성 + 스케일
        const instance = cloneSkinned(baseScene);
        instance.scale.setScalar(BOID_SCALE);

        // 스케일 적용된 상태에서 bounding box 계산
        instance.position.set(0, 0, 0);
        instance.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(instance);
        const minY = box.min.y;
        const maxY = box.max.y;
        const height = maxY - minY;

        // 바닥이 로컬 y=0에 오도록
        instance.position.y -= minY;

        // 개체 전체 높이의 일부만큼 떠 있도록 clearance
        const clearance = height * 0.2; // 필요하면 0.1~0.3 사이로 조절

        // 래퍼 그룹
        const wrapper = new THREE.Group();
        wrapper.add(instance);
        wrapper.position.set(x, terrainY + clearance, z);
        wrapper.userData.clearance = clearance;

        // 초기 속도
        const dir = new THREE.Vector3(randRange(-1, 1), 0, randRange(-1, 1));
        if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
        dir.normalize().multiplyScalar(randRange(1, 3));
        const vel = dir.clone();

        _scene.add(wrapper);
        boidObjects.push(wrapper);
        boidPositions.push(wrapper.position); // 참조
        boidVelocities.push(vel);

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
      console.log(`[boids] loaded GLB & spawned ${count} boids`);
    },
    undefined,
    (err) => {
      console.error("[boids] GLB load error:", modelPath, err);
    }
  );
}

// ──────────────────────────────────────────────
// 매 프레임 업데이트: main.js의 animate()에서 호출
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

  // 2) 적분 + 경사 정렬 + 접지
  for (let i = 0; i < count; i++) {
    const wrapper = boidObjects[i];
    const p = boidPositions[i]; // == wrapper.position
    const v = boidVelocities[i];

    // 속도 업데이트
    v.addScaledVector(acc[i], dt);

    const speed = v.length();
    if (speed > MAX_SPEED) v.multiplyScalar(MAX_SPEED / speed);
    v.multiplyScalar(DAMPING);

    // XZ 이동만 적용
    p.x += v.x * dt;
    p.z += v.z * dt;

    // 보정된 지형 높이 (원하면 주변 max 샘플도 가능)
    let terrainY = getBoidTerrainHeight(p.x, p.z);

    // 살짝 더 안전하게 하고 싶으면 주석 해제:
    // const eps = 0.7;
    // const h0 = getBoidTerrainHeight(p.x,        p.z);
    // const h1 = getBoidTerrainHeight(p.x + eps,  p.z);
    // const h2 = getBoidTerrainHeight(p.x - eps,  p.z);
    // const h3 = getBoidTerrainHeight(p.x,        p.z + eps);
    // const h4 = getBoidTerrainHeight(p.x,        p.z - eps);
    // terrainY = Math.max(h0, h1, h2, h3, h4) + 0.02;

    // 노멀은 기존처럼 샘플러 기반
    const n = getTerrainNormal(p.x, p.z);

    // slope 회전
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

    // clearance 만큼 항상 떠 있게
    const clearance = wrapper.userData.clearance || 0;
    p.y = terrainY + clearance;

    // 애니메이션
    const mixer = mixers[i];
    if (mixer) mixer.update(dt);
  }
}

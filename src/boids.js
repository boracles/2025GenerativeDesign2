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

// 캐릭터 스케일/피벗 설정
const TARGET_HEIGHT = 1.0; // GLB 원본 높이를 이 값으로 보정
const ANCHOR_RATIO = 0.3; // 0=맨 아래, 1=맨 위, 0.3쯤이 배 아래쪽
const BOID_SCALE = 2.0; // 최종 스케일 배율

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
let boidPositions = []; // THREE.Vector3
let boidVelocities = [];
let mixers = [];

let _sampleHeight = null;
let _scene = null;
let _ready = false;

const loader = new GLTFLoader();

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

// ──────────────────────────────────────────────
// 지형 노멀 계산 헬퍼
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
// 초기화: main.js에서 호출
// ──────────────────────────────────────────────
export function initBoids({
  scene,
  sampleTerrainHeight,
  areaSize = 150,
  count = BOID_COUNT,
  modelPath = GLB_PATH,
  clipName = CLIP_NAME,
}) {
  _scene = scene;
  _sampleHeight = sampleTerrainHeight;

  const half = areaSize * 0.5;

  loader.load(
    modelPath,
    (gltf) => {
      const baseScene = gltf.scene;
      const clips = gltf.animations || [];

      let clip = null;
      if (clips.length > 0) {
        clip =
          (clipName && THREE.AnimationClip.findByName(clips, clipName)) ||
          clips[0];
      }

      for (let i = 0; i < count; i++) {
        const meshRoot = cloneSkinned(baseScene);
        applyRDMaterial(meshRoot, rdTexture);

        meshRoot.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = false;
          }
        });

        // wrapper 그룹
        const wrapper = new THREE.Group();
        wrapper.name = "BoidWrapper";
        wrapper.add(meshRoot);

        // 1) 스케일/피벗 보정 (로컬 기준)
        meshRoot.position.set(0, 0, 0);
        meshRoot.rotation.set(0, 0, 0);
        meshRoot.scale.setScalar(1);
        wrapper.updateMatrixWorld(true);

        // 1-1) 현재 높이 → TARGET_HEIGHT
        const box = new THREE.Box3().setFromObject(meshRoot);
        const size = new THREE.Vector3();
        box.getSize(size);
        const currentHeight = size.y > 0 ? size.y : 1.0;
        const baseScale = TARGET_HEIGHT / currentHeight;
        meshRoot.scale.setScalar(baseScale);
        wrapper.updateMatrixWorld(true);

        // 1-2) ANCHOR_RATIO 지점이 로컬 y=0이 되도록 이동
        const box2 = new THREE.Box3().setFromObject(meshRoot);
        const minY = box2.min.y;
        const maxY = box2.max.y;
        const anchorY = THREE.MathUtils.lerp(minY, maxY, ANCHOR_RATIO);

        meshRoot.position.y -= anchorY;
        wrapper.updateMatrixWorld(true);

        // 1-3) 최종 전체 스케일 적용
        meshRoot.scale.multiplyScalar(BOID_SCALE);
        wrapper.updateMatrixWorld(true);

        // 1-4) 이 상태에서 "피벗→가장 아래" 거리(footClearance) 계산
        const boxFinal = new THREE.Box3().setFromObject(wrapper);
        const footClearance = -boxFinal.min.y; // 피벗이 y=0이므로

        wrapper.userData.footClearance = footClearance;

        // 2) 초기 위치 (XZ 랜덤, Y는 terrain + footClearance)
        const x = randRange(-half, half);
        const z = randRange(-half, half);

        let terrainY = 0;
        if (typeof _sampleHeight === "function") {
          terrainY = _sampleHeight(x, z);
        }

        const n = getTerrainNormal(x, z);
        const startPos = new THREE.Vector3(x, terrainY, z).add(
          n.clone().multiplyScalar(footClearance)
        );

        wrapper.position.copy(startPos);

        // 초기 방향은 랜덤 yaw
        const yaw0 = Math.random() * Math.PI * 2;
        const qYaw0 = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          yaw0
        );
        const qSlope0 = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          n
        );
        wrapper.quaternion.copy(qSlope0).multiply(qYaw0);

        _scene.add(wrapper);

        boidObjects.push(wrapper);
        boidPositions.push(startPos.clone());
        boidVelocities.push(
          new THREE.Vector3(randRange(-1, 1), 0, randRange(-1, 1))
        );

        // 애니메이션 세팅
        if (clip) {
          const mixer = new THREE.AnimationMixer(meshRoot);
          const action = mixer.clipAction(clip);
          action.play();
          action.timeScale = randRange(0.8, 1.2);
          action.time = Math.random() * clip.duration;
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
// 업데이트: main.js의 animate()에서 매 프레임 호출
// ──────────────────────────────────────────────
export function updateBoids(dt) {
  if (!_ready) return;
  const count = boidObjects.length;
  if (count === 0) return;

  const NEIGHBOR_R2 = NEIGHBOR_RADIUS * NEIGHBOR_RADIUS;
  const acc = Array.from({ length: count }, () => new THREE.Vector3());

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

  // 2) 적분 + 노멀 정렬 + footClearance 접지
  for (let i = 0; i < count; i++) {
    const v = boidVelocities[i];
    const p = boidPositions[i];
    const wrapper = boidObjects[i];

    v.addScaledVector(acc[i], dt);

    const speed = v.length();
    if (speed > MAX_SPEED) v.multiplyScalar(MAX_SPEED / speed);
    v.multiplyScalar(DAMPING);

    // XZ 이동
    p.addScaledVector(v, dt);

    // terrain 높이 + normal
    let terrainY = 0;
    if (typeof _sampleHeight === "function") {
      terrainY = _sampleHeight(p.x, p.z);
    }
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

    // footClearance 만큼 normal 방향으로 올려서 접지
    const foot = wrapper.userData.footClearance || 0;
    const terrainPoint = new THREE.Vector3(p.x, terrainY, p.z);
    const pos = terrainPoint.add(n.clone().multiplyScalar(foot));

    wrapper.position.copy(pos);
    p.copy(pos);

    // 애니메이션
    const mixer = mixers[i];
    if (mixer) mixer.update(dt);
  }
}

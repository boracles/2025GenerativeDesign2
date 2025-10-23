// src/instancing.js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const DEFAULTS = {
  GLB_PATH: "./assets/models/Tentacle.glb",
  RD_TEX_PATH: "./assets/textures/RD.png",
  CLIP_NAME: "FeedingTentacle_WaveTest",
  COUNT: 100,
  COLS: 10,
  USE_RD: true,
};

// 간단한 랜덤 워크 + 약한 정렬로 “살아있는” 느낌만 준 버전
export async function initBoidsSystem({
  scene,
  camera,
  renderer,
  terrain, // THREE.LOD (지형)
  sampleHeight, // (x,z) -> y
  worldRadius, // 반경
  options = {},
}) {
  const opt = { ...DEFAULTS, ...options };
  const loader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();

  const COUNT = opt.COUNT;
  const COLS = opt.COLS;
  const ROWS = Math.ceil(COUNT / COLS);
  const GAP_X = 3.0,
    GAP_Z = 3.0;

  const objects = new Array(COUNT);
  const vel = Array.from(
    { length: COUNT },
    () =>
      new THREE.Vector2(
        THREE.MathUtils.randFloatSpread(0.2),
        THREE.MathUtils.randFloatSpread(0.2)
      )
  );
  const mixers = new Map();
  let baseScene = null;
  let baseClips = [];

  // RD 텍스처(있으면 재질에 입힘)
  let rdMat = null;
  try {
    if (opt.USE_RD) {
      const rd = await new Promise((res) =>
        texLoader.load(opt.RD_TEX_PATH, res)
      );
      rd.colorSpace = THREE.SRGBColorSpace;
      rd.wrapS = rd.wrapT = THREE.RepeatWrapping;
      rd.generateMipmaps = true;
      rd.minFilter = THREE.LinearMipmapLinearFilter;
      rd.magFilter = THREE.LinearFilter;
      rd.repeat.set(8, 8);
      rdMat = new THREE.MeshLambertMaterial({
        map: rd,
        alphaTest: 0.6,
        transparent: false,
        skinning: true,
      });
    }
  } catch (e) {
    console.warn("[boids] RD texture load failed:", e);
  }

  // GLB 로드
  try {
    const gltf = await loader.loadAsync(opt.GLB_PATH);
    baseScene = gltf.scene;
    baseClips = gltf.animations || [];
    baseScene.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = true;
        if (rdMat) {
          // 이름 조건 없이 통일 적용 (원하는 경우 이름 패턴 필터링 가능)
          o.material = o.material?.clone() ?? new THREE.MeshLambertMaterial();
          o.material.map = rdMat.map ?? o.material.map;
          o.material.alphaTest = 0.6;
          o.material.transparent = false;
        }
      }
    });
  } catch (e) {
    console.error("[boids] GLB load failed:", e);
  }

  // GLB 실패 시 폴백 프리미티브
  const fallbackGeo = new THREE.ConeGeometry(0.18, 1.0, 12);
  fallbackGeo.translate(0, 0.5, 0);
  const fallbackMat = new THREE.MeshLambertMaterial({ color: 0xa8e1ff });

  // 배치
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (i >= COUNT) break;

      const x =
        (c - (COLS - 1) / 2) * GAP_X + THREE.MathUtils.randFloatSpread(0.4);
      const z =
        (r - (ROWS - 1) / 2) * GAP_Z + THREE.MathUtils.randFloatSpread(0.4);

      const root = baseScene
        ? cloneSkinned(baseScene)
        : new THREE.Mesh(fallbackGeo, fallbackMat.clone());

      root.matrixAutoUpdate = false;
      const y = sampleHeight ? sampleHeight(x, z) : 0;
      root.position.set(x, y, z);
      root.rotation.set(0, Math.random() * Math.PI * 2, 0);
      root.scale.setScalar(1.0);
      root.updateMatrix();

      scene.add(root);
      objects[i] = root;

      // 애니메이션 클립 있으면 Mixer 세팅
      if (baseClips.length) {
        const mx = new THREE.AnimationMixer(root);
        const clip =
          THREE.AnimationClip.findByName(baseClips, opt.CLIP_NAME) ||
          baseClips[0];
        const act = mx.clipAction(clip);
        act.play();
        act.time = Math.random() * clip.duration;
        act.timeScale = THREE.MathUtils.lerp(0.75, 1.25, Math.random());
        mixers.set(i, mx);
      }
      i++;
    }
  }

  const MAX_SPEED = 1.2;
  const DAMPING = 0.997;

  // 경계 반발
  function wallForce(px, pz, yOut) {
    const r = Math.hypot(px, pz);
    const inner = worldRadius - 4.0;
    if (r <= inner) return new THREE.Vector2(0, 0);
    const t = (r - inner) / Math.max(1e-6, 4.0);
    const nx = px / (r || 1e-6),
      nz = pz / (r || 1e-6);
    return new THREE.Vector2(-nx, -nz).multiplyScalar(0.035 * t);
  }

  // 메인 업데이트
  function update(dt, tSec) {
    // 근거리 애니믹스 업데이트
    mixers.forEach((mx) => mx.update(dt));

    for (let k = 0; k < COUNT; k++) {
      const root = objects[k];
      if (!root) continue;

      // 가벼운 랜덤 워크 + 약한 정렬
      const v = vel[k];
      const jitter = 0.06;
      v.x += (Math.random() - 0.5) * jitter * dt * 60;
      v.y += (Math.random() - 0.5) * jitter * dt * 60;

      // 경계 반발
      const p = root.position;
      const wf = wallForce(p.x, p.z);
      v.addScaledVector(wf, dt * 60);

      // 속도 제한/감쇠
      let sp = v.length();
      if (sp > MAX_SPEED) v.multiplyScalar(MAX_SPEED / sp);
      v.multiplyScalar(DAMPING);

      // 위치 적분
      p.x += v.x * dt;
      p.z += v.y * dt;

      // 지형 위 y 고정
      if (sampleHeight) p.y = sampleHeight(p.x, p.z);

      // 진행 방향으로 회전
      const yaw = Math.atan2(v.x, v.y);
      root.rotation.set(0, yaw, 0);

      root.updateMatrix();
    }
  }

  console.log("[boids] ready:", {
    count: COUNT,
    rd: !!rdMat,
    clips: baseClips.length,
  });

  return { update, dispose() {} };
}

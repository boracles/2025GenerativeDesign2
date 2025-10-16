import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

// ──────────────────────────────────────────────
// 기본 세팅 (경량화)
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x003e58);

const camera = new THREE.PerspectiveCamera(
  55,
  innerWidth / innerHeight,
  0.1,
  1000
);
camera.position.set(0, 18, 10);
camera.lookAt(0, 0, 0);

// 경량 렌더러
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: "high-performance",
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.physicallyCorrectLights = false;
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableRotate = true;
controls.enablePan = true;
controls.screenSpacePanning = false;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.minPolarAngle = Math.PI * 0.15;
controls.maxPolarAngle = Math.PI * 0.48;
controls.target.set(0, 0, 0);

// 라이트(경량)
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.0));

// ──────────────────────────────────────────────
// FPS HUD
const hud = document.createElement("div");
hud.style.cssText = `
  position:fixed;left:10px;top:10px;font:12px/1.2 ui-monospace,monospace;
  color:#eaf6ff;background:rgba(0,0,0,.35);padding:8px 10px;border-radius:8px;
  border:1px solid rgba(255,255,255,.12);z-index:9999;user-select:none;`;
document.body.appendChild(hud);
let frames = 0,
  last = performance.now(),
  fps = 0,
  avg = 0,
  samples = 0;
function updateFPS() {
  const now = performance.now();
  frames++;
  if (now - last >= 1000) {
    fps = (frames * 1000) / (now - last);
    frames = 0;
    last = now;
    samples++;
    avg += (fps - avg) / samples;
    hud.innerHTML = `FPS: ${fps.toFixed(1)}<br>AVG: ${avg.toFixed(
      1
    )}<br>Anim: ${animSet.size}/${COUNT}`;
  }
}

// ──────────────────────────────────────────────
// RD 텍스처(옵션, Lambert)
let rdMat = null;
const texLoader = new THREE.TextureLoader();

function toPOTTexture(img, size = 1024) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  c.getContext("2d").drawImage(img, 0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

function tryApplyRDToPending() {
  if (!rdMat || pendingForRD.size === 0) return;
  pendingForRD.forEach((root) => applyRDToNamedMeshes(root));
  pendingForRD.clear();
}

function applyRDToNamedMeshes(root) {
  if (!rdMat) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (
      /body(\.\d+)?/i.test(o.name) ||
      /leg[_\s-]?ball(\.\d+)?/i.test(o.name)
    ) {
      const mat = rdMat.clone();
      mat.skinning = !!o.isSkinnedMesh;
      o.material = mat;
      o.userData.baseMat = mat; // 디폼/복원 시 참조
    }
  });
}

texLoader.load("./assets/textures/RD.png", (tex) => {
  const rdPOT = toPOTTexture(tex.image, 1024);
  rdMat = new THREE.MeshLambertMaterial({
    map: rdPOT,
    transparent: false,
    alphaTest: 0.6,
    skinning: true,
  });
  rdMat.map.repeat.set(8, 8);
  rdMat.map.needsUpdate = true;
  tryApplyRDToPending();
});

// ──────────────────────────────────────────────
// 원거리용 디폼 재질 (초저비용 의사 노이즈)
const deformMatCache = new WeakMap(); // baseMat -> deformMat
function makeDeformMaterial(baseMat, seed = Math.random() * 6.28318) {
  if (deformMatCache.has(baseMat)) return deformMatCache.get(baseMat);

  const mat = baseMat.clone();
  mat.skinning = baseMat.skinning;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uAmp = { value: 0.06 };
    shader.uniforms.uSeed = { value: seed };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;
         uniform float uAmp;
         uniform float uSeed;
         float n3(vec3 p){
           return 0.66 * sin(dot(p, vec3(12.9898,78.233,37.719)) + uTime*1.7 + uSeed) +
                  0.34 * sin(dot(p.yzx, vec3(24.123,53.321,11.873)) + uTime*1.1 - uSeed*0.5);
         }`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float nn = n3(position * 0.85);
         transformed += normalize(objectNormal) * (uAmp * nn);`
      );

    mat.userData._shader = shader;
  };

  deformMatCache.set(baseMat, mat);
  return mat;
}

const deformUniformsByIdx = new Map(); // idx -> Array<{mat, uniforms}>
function applyDeformToObject(idx) {
  const root = objects[idx];
  if (!root) return;

  root.traverse((o) => {
    if (!o.isMesh) return;
    if (
      !(/body(\.\d+)?/i.test(o.name) || /leg[_\s-]?ball(\.\d+)?/i.test(o.name))
    )
      return;

    const base = o.userData.baseMat || o.material;
    const deform = makeDeformMaterial(base);
    o.material = deform;
    o.userData.deformMat = deform;
  });

  // 유니폼 참조는 다음 프레임에 수집
  deformUniformsByIdx.delete(idx);
}

function collectDeformUniformRefs(idx) {
  const root = objects[idx];
  if (!root) return;
  const arr = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.userData.deformMat) return;
    const shader = o.userData.deformMat.userData?._shader;
    if (shader && shader.uniforms?.uTime)
      arr.push({ mat: o.userData.deformMat, uniforms: shader.uniforms });
  });
  if (arr.length) deformUniformsByIdx.set(idx, arr);
}

function removeDeformFromObject(idx) {
  const root = objects[idx];
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.deformMat && o.userData.baseMat)
      o.material = o.userData.baseMat;
    delete o.userData.deformMat;
  });
  deformUniformsByIdx.delete(idx);
}

// ──────────────────────────────────────────────
// GLB 1회 로드 → 100 클론
const loader = new GLTFLoader();
const CLOCK = new THREE.Clock(); // ✅ 여기서 한 번만 선언
const COUNT = 100;
const COLS = 10;
const ROWS = Math.ceil(COUNT / COLS);
const GAP_X = 3.0;
const GAP_Z = 3.0;
const GLB_PATH = "./assets/models/Tentacles.glb";

const positions = new Array(COUNT);
const objects = new Array(COUNT);
const mixers = new Map(); // idx -> AnimationMixer
const actions = new Map(); // idx -> AnimationAction

function initLayout() {
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (i >= COUNT) break;
      const x = (c - (COLS - 1) / 2) * GAP_X;
      const z = (r - (ROWS - 1) / 2) * GAP_Z;
      positions[i] = new THREE.Vector3(x, 0, z);
      i++;
    }
  }
}
initLayout();

const pendingForRD = new Set();

let baseScene = null,
  baseClips = [];
loader.load(
  GLB_PATH,
  (gltf) => {
    baseScene = gltf.scene;
    baseClips = gltf.animations || [];

    baseScene.traverse((o) => {
      if (o.isMesh) o.frustumCulled = true;
    });

    for (let i = 0; i < COUNT; i++) {
      const root = cloneSkinned(baseScene);
      root.matrixAutoUpdate = false;

      if (rdMat) applyRDToNamedMeshes(root);
      else pendingForRD.add(root);

      const p = positions[i];
      root.position.set(p.x, p.y, p.z);
      root.rotation.set(0, Math.random() * Math.PI * 2, 0);
      root.scale.setScalar(1.0);
      root.updateMatrix();
      scene.add(root);
      objects[i] = root;
    }

    // 초기 근거리 셋업
    reselectionPass(true);
  },
  undefined,
  (err) => console.error("GLB load error:", err)
);

// ──────────────────────────────────────────────
// 근거리: 본 애니 / 원거리: 디폼(회전 없음)
const MAX_ANIMATING = 12;
const RESELECT_EVERY = 30;
const HYSTERESIS = 4.0;

const animSet = new Set();
const idleSet = new Set();
const idleParams = new Map(); // idx -> {ampBase, bobAmp, bobW}

function makeIdleParams() {
  return {
    ampBase: 0.05 + Math.random() * 0.04,
    bobAmp: 0.04 + Math.random() * 0.03,
    bobW: 0.5 + Math.random() * 0.4,
  };
}

function ensureMixer(idx) {
  if (mixers.has(idx)) return mixers.get(idx);
  const root = objects[idx];
  const mx = new THREE.AnimationMixer(root);
  let clip = baseClips.length
    ? THREE.AnimationClip.findByName(baseClips, "FeedingTentacle_WaveTest") ||
      baseClips[0]
    : null;
  if (clip) {
    const act = mx.clipAction(clip);
    act.play();
    act.time = Math.random() * clip.duration;
    act.timeScale = 0.95 + Math.random() * 0.1;
    actions.set(idx, act);
  }
  mixers.set(idx, mx);
  return mx;
}

function addToAnim(idx) {
  if (animSet.has(idx)) return;
  const root = objects[idx];
  if (!root) return;

  if (idleSet.has(idx)) {
    idleSet.delete(idx);
    idleParams.delete(idx);
    removeDeformFromObject(idx);
    root.position.y = 0;
    root.updateMatrix();
  }

  ensureMixer(idx);
  const act = actions.get(idx);
  if (act) {
    act.paused = false;
    act.enabled = true;
  }
  animSet.add(idx);
}

function removeFromAnim(idx) {
  if (!animSet.has(idx)) return;
  animSet.delete(idx);
  const act = actions.get(idx);
  if (act) act.paused = true;
  idleSet.add(idx);
  if (!idleParams.has(idx)) idleParams.set(idx, makeIdleParams());
  applyDeformToObject(idx);
}

function reselectionPass(init = false) {
  if (!objects[0]) return;

  const ids = [...Array(COUNT).keys()];
  ids.sort((a, b) => {
    const pa = positions[a],
      pb = positions[b];
    const da =
      (pa.x - camera.position.x) ** 2 + (pa.z - camera.position.z) ** 2;
    const db =
      (pb.x - camera.position.x) ** 2 + (pb.z - camera.position.z) ** 2;
    return da - db;
  });

  const desiredArr = ids.slice(0, Math.min(MAX_ANIMATING, ids.length));
  const desired = new Set(desiredArr);

  const edge = desiredArr.at(-1);
  const dEdge =
    edge !== undefined
      ? Math.hypot(
          positions[edge].x - camera.position.x,
          positions[edge].z - camera.position.z
        )
      : 0;

  for (const i of [...animSet]) {
    const d = Math.hypot(
      positions[i].x - camera.position.x,
      positions[i].z - camera.position.z
    );
    if (!desired.has(i) && d > dEdge + HYSTERESIS) removeFromAnim(i);
    else desired.add(i);
  }

  for (const i of desired) addToAnim(i);

  if (init) {
    for (const i of ids) {
      if (!animSet.has(i)) {
        idleSet.add(i);
        if (!idleParams.has(i)) idleParams.set(i, makeIdleParams());
        applyDeformToObject(i);
      }
    }
  } else {
    for (const i of [...idleSet]) {
      if (animSet.has(i)) {
        idleSet.delete(i);
        idleParams.delete(i);
        removeDeformFromObject(i);
      }
    }
  }
}

// ──────────────────────────────────────────────
// 루프
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let frameCounter = 0;
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  tryApplyRDToPending();

  if (frameCounter++ % RESELECT_EVERY === 0) reselectionPass();

  const dt = CLOCK.getDelta();

  // 근거리: 본 애니
  animSet.forEach((idx) => {
    const mx = mixers.get(idx);
    if (mx) mx.update(dt);
  });

  // 원거리: 회전 없음, 버텍스 디폼 + 약한 상하 바운스만
  const t = performance.now() * 0.001;
  idleSet.forEach((idx) => {
    const obj = objects[idx];
    if (!obj) return;
    const prm = idleParams.get(idx);
    if (!prm) return;

    obj.position.y = Math.sin(t * prm.bobW) * prm.bobAmp;
    obj.updateMatrix();

    // 디폼 유니폼 갱신
    if (
      !deformUniformsByIdx.has(idx) ||
      deformUniformsByIdx.get(idx).length === 0
    ) {
      collectDeformUniformRefs(idx);
    }
    const arr = deformUniformsByIdx.get(idx);
    if (arr && arr.length) {
      const d = Math.hypot(
        positions[idx].x - camera.position.x,
        positions[idx].z - camera.position.z
      );
      const amp = THREE.MathUtils.clamp(
        prm.ampBase * (0.7 + 0.003 * d),
        0.02,
        0.12
      );
      for (const { uniforms } of arr) {
        uniforms.uTime.value = t;
        uniforms.uAmp.value = amp;
      }
    }
  });

  renderer.render(scene, camera);
  updateFPS();
}
animate();

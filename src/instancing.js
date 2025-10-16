// RD + Skinned/Instanced LOD — 좁은 범위 + 비동기 주기/지터 버전
// files: ./assets/models/Tentacle.glb, ./assets/textures/RD.png

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// ──────────────────────────────────────────────
// 옵션
const USE_RD = true;

// ──────────────────────────────────────────────
// 기본 세팅
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
controls.minDistance = 8;
controls.maxDistance = 60;
controls.minPolarAngle = Math.PI * 0.15;
controls.maxPolarAngle = Math.PI * 0.48;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.0));

// HUD
const hud = document.createElement("div");
hud.style.cssText = `position:fixed;left:10px;top:10px;font:12px/1.2 ui-monospace,monospace;color:#eaf6ff;background:rgba(0,0,0,.35);padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);z-index:9`;
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
// 배치/상태
const loader = new GLTFLoader();
const CLOCK = new THREE.Clock();
const COUNT = 100;
const COLS = 10;
const ROWS = Math.ceil(COUNT / COLS);
const GAP_X = 3.0,
  GAP_Z = 3.0;
const GLB_PATH = "./assets/models/Tentacle.glb";

const positions = new Array(COUNT);
const objects = new Array(COUNT);
const mixers = new Map();
const actions = new Map();

(function initLayout() {
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (i >= COUNT) break;
      positions[i] = new THREE.Vector3(
        (c - (COLS - 1) / 2) * GAP_X,
        0,
        (r - (ROWS - 1) / 2) * GAP_Z
      );
      i++;
    }
  }
})();

const BODY_RX = /body(\.\d+)?/i;
const LEGBALL_RX = /leg[_\s-]?ball(\.\d+)?/i;
const LEGSTICK_RX = /^(?!.*ball).*leg.*/i;

// ──────────────────────────────────────────────
// RD 텍스처
let rdMat = null;
const texLoader = new THREE.TextureLoader();
const pendingForRD = new Set();

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
  return t;
}

function forceRDMaterial(mesh, base) {
  const m = base.clone();
  m.skinning = !!mesh.isSkinnedMesh;
  if (m.color) m.color.set(0xffffff);
  m.metalness = 0.0;
  m.roughness = 1.0;
  m.alphaTest = 0.6;
  m.transparent = false;
  mesh.material = m;
  mesh.userData.baseMat = m;
}

function applyRDToNamedMeshes(root) {
  if (!rdMat) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (
      BODY_RX.test(o.name) ||
      LEGBALL_RX.test(o.name) ||
      LEGSTICK_RX.test(o.name)
    ) {
      forceRDMaterial(o, rdMat);
    }
  });
}
function tryApplyRDToPending() {
  if (!rdMat || pendingForRD.size === 0) return;
  pendingForRD.forEach((r) => applyRDToNamedMeshes(r));
  pendingForRD.clear();
}

// ──────────────────────────────────────────────
// Instancing 풀 (body / legBall / legStick)
let instBody = null,
  instLegBall = null,
  instLegStick = null;
const idleHasInstance = new Array(COUNT).fill(false);
const OFF_MAT = new THREE.Matrix4().makeScale(0, 0, 0);

function ensureGeomAttributes(g) {
  const geom = g.index ? g.toNonIndexed() : g.clone();
  const vtx = geom.getAttribute("position").count;
  if (!geom.getAttribute("normal"))
    geom.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Float32Array(vtx * 3), 3)
    );
  if (!geom.getAttribute("uv"))
    geom.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array(vtx * 2), 2)
    );
  return geom;
}

function buildInstancingPoolsFrom(root) {
  const body = [],
    ball = [],
    stick = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (BODY_RX.test(o.name)) body.push(ensureGeomAttributes(o.geometry));
    else if (LEGBALL_RX.test(o.name))
      ball.push(ensureGeomAttributes(o.geometry));
    else if (LEGSTICK_RX.test(o.name))
      stick.push(ensureGeomAttributes(o.geometry));
  });

  const geomBody =
    BufferGeometryUtils.mergeGeometries(body, false) ||
    new THREE.BoxGeometry(1, 1, 1);
  const geomBall =
    BufferGeometryUtils.mergeGeometries(ball, false) ||
    new THREE.SphereGeometry(0.4, 8, 8);
  const geomStick =
    BufferGeometryUtils.mergeGeometries(stick, false) ||
    new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6);

  const mkMat = () =>
    new THREE.MeshLambertMaterial({
      map: rdMat ? rdMat.map : null,
      alphaTest: 0.6,
    });
  instBody = new THREE.InstancedMesh(geomBody, mkMat(), COUNT);
  instLegBall = new THREE.InstancedMesh(geomBall, mkMat(), COUNT);
  instLegStick = new THREE.InstancedMesh(geomStick, mkMat(), COUNT);

  for (let i = 0; i < COUNT; i++) {
    instBody.setMatrixAt(i, OFF_MAT);
    instLegBall.setMatrixAt(i, OFF_MAT);
    instLegStick.setMatrixAt(i, OFF_MAT);
  }
  instBody.count = instLegBall.count = instLegStick.count = COUNT;
  scene.add(instBody, instLegBall, instLegStick);
}

function syncInstancingRD() {
  if (!rdMat) return;
  [instBody, instLegBall, instLegStick].forEach((m) => {
    if (m) {
      m.material.map = rdMat.map;
      m.material.needsUpdate = true;
    }
  });
}

function showAsInstance(idx, root) {
  const m = new THREE.Matrix4().copy(root.matrix);
  instBody.setMatrixAt(idx, m);
  instLegBall.setMatrixAt(idx, m);
  instLegStick.setMatrixAt(idx, m);
  instBody.instanceMatrix.needsUpdate = true;
  instLegBall.instanceMatrix.needsUpdate = true;
  instLegStick.instanceMatrix.needsUpdate = true;
  idleHasInstance[idx] = true;
}
function hideInstance(idx) {
  if (!idleHasInstance[idx]) return;
  [instBody, instLegBall, instLegStick].forEach((m) => {
    m.setMatrixAt(idx, OFF_MAT);
    m.instanceMatrix.needsUpdate = true;
  });
  idleHasInstance[idx] = false;
}
function hidePartsMeshes(root) {
  root.traverse((o) => {
    if (o.isMesh) o.visible = false;
  });
}
function showPartsMeshes(root) {
  root.traverse((o) => {
    if (o.isMesh) o.visible = true;
  });
}

// ──────────────────────────────────────────────
// 근거리 애니/원거리 인스턴싱 — 범위 좁힘 + 비동기화
const MAX_ANIMATING = 8; // 12 → 8
const RESELECT_EVERY = 8; // 10 → 8 (조금 더 자주)
const ANIM_RADIUS = 14.0; // 22 → 14 (훨씬 좁게)
const ANIM_RADIUS_HYST = 3.0; // 4 → 3
const HYSTERESIS = 3.0; // 4 → 3

const animSet = new Set();
const idleSet = new Set();
let baseClips = [];

// ── 비동기화를 위한 개별 파라미터(인스턴스용)
const phase = Float32Array.from(
  { length: COUNT },
  () => Math.random() * Math.PI * 2
);
const driftPhase = Float32Array.from(
  { length: COUNT },
  () => Math.random() * Math.PI * 2
); // 느린 드리프트 위상
const wobbleW = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.55, 0.9, Math.random())
); // 주파수 다양화
const squashA = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.08, 0.16, Math.random())
); // 진폭 다양화
const bendA = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.04, 0.09, Math.random())
);
const bobA = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.02, 0.05, Math.random())
);
const jitterAmt = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.06, 0.14, Math.random())
); // 드리프트 강도

// ── 스킨드용: timeScale 기본값 + 지터
const baseTimeScale = new Map(); // idx -> base
const jitterSpeed = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.08, 0.18, Math.random())
); // 지터 속도
const jitterPhase = Float32Array.from(
  { length: COUNT },
  () => Math.random() * Math.PI * 2
);

function ensureMixer(idx) {
  if (mixers.has(idx)) return mixers.get(idx);
  const root = objects[idx];
  const mx = new THREE.AnimationMixer(root);
  const clip = baseClips.length
    ? THREE.AnimationClip.findByName(baseClips, "FeedingTentacle_WaveTest") ||
      baseClips[0]
    : null;
  if (clip) {
    const act = mx.clipAction(clip);
    act.play();
    // 기본 타임스케일 다양화(0.75~1.25)
    const ts = THREE.MathUtils.lerp(0.75, 1.25, Math.random());
    act.timeScale = ts;
    baseTimeScale.set(idx, ts);
    // 시작시간도 랜덤 오프셋
    act.time = Math.random() * clip.duration;
    actions.set(idx, act);
  }
  mixers.set(idx, mx);
  return mx;
}

function addToAnim(idx) {
  if (animSet.has(idx)) return;
  const root = objects[idx];
  if (!root) return;
  hideInstance(idx);
  showPartsMeshes(root);
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
  const root = objects[idx];
  hidePartsMeshes(root);
  showAsInstance(idx, root);
  idleSet.add(idx);
}

function reselectionPass(init = false) {
  if (!objects[0]) return;

  // 거리 오름차순
  const ids = [...Array(COUNT).keys()].sort((a, b) => {
    const pa = positions[a],
      pb = positions[b];
    const da =
      (pa.x - camera.position.x) ** 2 + (pa.z - camera.position.z) ** 2;
    const db =
      (pb.x - camera.position.x) ** 2 + (pb.z - camera.position.z) ** 2;
    return da - db;
  });

  // 반경 내 우선
  const desired = new Set();
  const r2 = ANIM_RADIUS * ANIM_RADIUS;
  for (const i of ids) {
    const p = positions[i];
    const d2 = (p.x - camera.position.x) ** 2 + (p.z - camera.position.z) ** 2;
    if (d2 <= r2) desired.add(i);
  }
  // 부족하면 K-최근접 보강
  for (
    let k = 0;
    desired.size < Math.min(MAX_ANIMATING, ids.length) && k < ids.length;
    k++
  ) {
    desired.add(ids[k]);
  }

  // 경계 히스테리시스
  const edge = [...desired][Math.min(desired.size - 1, MAX_ANIMATING - 1)];
  const edgeDist =
    edge !== undefined
      ? Math.hypot(
          positions[edge].x - camera.position.x,
          positions[edge].z - camera.position.z
        )
      : 0;

  for (const i of [...animSet]) {
    const p = positions[i];
    const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
    const keepByRadius = d <= ANIM_RADIUS + ANIM_RADIUS_HYST;
    const keepByEdge = d <= edgeDist + HYSTERESIS;
    if (!keepByRadius && !keepByEdge && !desired.has(i)) removeFromAnim(i);
    else desired.add(i);
  }

  for (const i of desired) addToAnim(i);

  if (init) {
    for (const i of ids) {
      if (!animSet.has(i)) {
        const root = objects[i];
        hidePartsMeshes(root);
        showAsInstance(i, root);
        idleSet.add(i);
      }
    }
  } else {
    for (const i of [...idleSet]) if (animSet.has(i)) idleSet.delete(i);
  }
}

// ──────────────────────────────────────────────
// GLB 로드 & 배치
loader.load(GLB_PATH, (gltf) => {
  const baseScene = gltf.scene;
  baseClips = gltf.animations || [];
  baseScene.traverse((o) => {
    if (o.isMesh) o.frustumCulled = true;
  });

  buildInstancingPoolsFrom(baseScene);

  for (let i = 0; i < COUNT; i++) {
    const root = cloneSkinned(baseScene);
    root.matrixAutoUpdate = false;

    if (USE_RD) {
      if (rdMat) applyRDToNamedMeshes(root);
      else pendingForRD.add(root);
    }

    const p = positions[i];
    root.position.set(p.x, p.y, p.z);
    root.rotation.set(0, Math.random() * Math.PI * 2, 0);
    root.scale.setScalar(1.0);
    root.updateMatrix();

    scene.add(root);
    objects[i] = root;
  }
  reselectionPass(true);
});

// RD 텍스처
texLoader.load("./assets/textures/RD.png", (tex) => {
  if (!USE_RD) return;
  const t = toPOTTexture(tex.image, 1024);
  rdMat = new THREE.MeshLambertMaterial({
    map: t,
    alphaTest: 0.6,
    transparent: false,
    skinning: true,
  });
  rdMat.map.repeat.set(8, 8);
  rdMat.map.needsUpdate = true;
  tryApplyRDToPending();
  syncInstancingRD();
});

// ──────────────────────────────────────────────
// 리사이즈
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ──────────────────────────────────────────────
// 노이즈 변형(인스턴스용) + 스킨드 타임스케일 지터
const tmpM = new THREE.Matrix4(),
  tmpS = new THREE.Vector3(),
  tmpQ = new THREE.Quaternion(),
  tmpP = new THREE.Vector3(),
  tmpE = new THREE.Euler(0, 0, 0);

let frameCounter = 0;
const _camNow = new THREE.Vector3(),
  _camPrev = new THREE.Vector3().copy(camera.position);
const MOVE_EPS = 0.25;

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  tryApplyRDToPending();

  // 카메라 이동시 즉시 재선정
  _camNow.copy(camera.position);
  if (_camNow.distanceToSquared(_camPrev) > MOVE_EPS * MOVE_EPS) {
    reselectionPass();
    _camPrev.copy(_camNow);
  }

  if (frameCounter++ % RESELECT_EVERY === 0) reselectionPass();

  const dt = CLOCK.getDelta();
  const t = performance.now() * 0.001;

  // 근거리 스킨드: 지터로 타임스케일 가변
  animSet.forEach((idx) => {
    const mx = mixers.get(idx) || ensureMixer(idx);
    const act = actions.get(idx);
    if (act) {
      const base = baseTimeScale.get(idx) ?? 1.0;
      const jitter =
        1.0 + 0.12 * Math.sin(t * jitterSpeed[idx] + jitterPhase[idx]); // ±12%
      act.timeScale = base * jitter;
    }
    mx.update(dt);
  });

  // 원거리 인스턴스: 개별 주파수/진폭 + 느린 드리프트(모든 파트 동일 행렬)
  if (instBody && instLegBall && instLegStick) {
    let needs = false;
    idleSet.forEach((idx) => {
      if (!idleHasInstance[idx]) return;
      const root = objects[idx];
      if (!root) return;

      root.matrix.decompose(tmpP, tmpQ, tmpS);

      // 느린 드리프트로 파라미터를 시간에 따라 아주 조금씩 바꿈
      const drift =
        1.0 + jitterAmt[idx] * 0.5 * Math.sin(t * 0.1 + driftPhase[idx]);

      const ph = t * (wobbleW[idx] * drift) + phase[idx];

      const sy = 1.0 + Math.sin(ph) * (squashA[idx] * drift);
      const sxz = 1.0 / Math.sqrt(sy);
      const sx = sxz,
        sz = sxz;

      tmpE.set(0, 0, Math.sin(ph * 0.9) * (bendA[idx] * drift));
      const bendQ = new THREE.Quaternion().setFromEuler(tmpE);

      const py = Math.sin(ph * 0.8) * (bobA[idx] * drift);

      const finalQ = tmpQ.clone().multiply(bendQ);
      const finalS = new THREE.Vector3(sx, sy, sz);
      const finalP = new THREE.Vector3(tmpP.x, tmpP.y + py, tmpP.z);

      tmpM.compose(finalP, finalQ, finalS);
      instBody.setMatrixAt(idx, tmpM);
      instLegBall.setMatrixAt(idx, tmpM);
      instLegStick.setMatrixAt(idx, tmpM);
      needs = true;
    });
    if (needs) {
      instBody.instanceMatrix.needsUpdate = true;
      instLegBall.instanceMatrix.needsUpdate = true;
      instLegStick.instanceMatrix.needsUpdate = true;
    }
  }

  renderer.render(scene, camera);
  updateFPS();
}
animate();

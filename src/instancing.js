// RD + Skinned/Instanced LOD — 좁은 범위 + 비동기 주기/지터 버전
// files: ./assets/models/Tentacle.glb, ./assets/textures/RD.png

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// ──────────────────────────────────────────────
// TODO: 교체 포인트
const GLB_PATH = "./assets/models/Tentacle.glb"; // 내 GLB 경로
const RD_TEX_PATH = "./assets/textures/RD.png"; // RD 텍스처 경로
const CLIP_NAME = "FeedingTentacle_WaveTest"; // 내 GLB 애니 클립명 (없으면 첫 클립 사용)
const COUNT = 100; // 개체 수
const COLS = 10; // 격자 열 수
const GAP_X = 3.0,
  GAP_Z = 3.0; // 격자 간격
const USE_RD = true; // RD 사용 여부

// 파츠 이름 패턴(내 모델에 맞게 필요시 수정)
const BODY_RX = /body(\.\d+)?/i;
const LEGBALL_RX = /leg[_\s-]?ball(\.\d+)?/i;
const LEGSTICK_RX = /^(?!.*ball).*leg.*/i;

// LOD 범위/빈도
const MAX_ANIMATING = 8; // 근거리 스킨드 최대 개수
const ANIM_RADIUS = 14.0; // 스킨드 반경
const ANIM_RADIUS_HYST = 3.0; // 반경 히스테리시스
const HYSTERESIS = 3.0; // 가장자리 히스테리시스
const RESELECT_EVERY = 8; // 프레임마다 재선정 주기
const MOVE_EPS = 0.25; // 카메라 이동 감지 임계

const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // y=0 평면
const _pt = new THREE.Vector3();

const DEBUG_SENSE = true; // 감지 시각화 ON/OFF
const SENSE_SAMPLE = 12; // 화살표를 그릴 샘플 개체 수(과부하 방지)

// 규칙 가중치
const W_SEP = 1.2; // Separation (떨어짐)
const W_COH = 0.8; // Cohesion (가까워짐)
const W_ALI = 0.6; // Alignment (방향 정렬)
const W_PULL = 1.0; // External Pull (외부 자극)
const W_VTX = 0.8; // Vortex (소용돌이)
const VORTEX_THRESHOLD = 0.9; // 밀도 임계값 (ρ)

const MAX_FORCE = 0.08; // 한 프레임당 최대 조향력
const MAX_SPEED = 1.2; // 최대 속도
const DAMPING = 0.992; // 감쇠 (마찰)

const USE_FLOW = true; // 전역 흐름 사용 여부
const W_FLOW = 0.25; // 전역 흐름 비중(ali와 별도)

const CENTER_K = 0.015; // 0.01~0.03 사이로 조절

const WORLD_RADIUS = 22; // 무대 반경(카메라 셋업에 맞춰 조절)
const WALL_WIDTH = 6; // 경계 완충 폭
const WALL_K = 0.035; // 벽 반발 세기

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
const ROWS = Math.ceil(COUNT / COLS);

const positions = new Array(COUNT);
const objects = new Array(COUNT);
const mixers = new Map();
const actions = new Map();

// [Sense] 상태 벡터 (이웃 속도 감지용)
const vel = Array.from(
  { length: COUNT },
  () =>
    new THREE.Vector3(
      THREE.MathUtils.randFloatSpread(0.1),
      0,
      THREE.MathUtils.randFloatSpread(0.1)
    )
);
const acc = Array.from({ length: COUNT }, () => new THREE.Vector3());

// [Sense] 감지 반경 파라미터
const NEIGHBOR_R = 4.0; // 이웃으로 인식하는 반경
const NEIGHBOR_R2 = NEIGHBOR_R * NEIGHBOR_R;

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

  // 인스턴스 행렬 사용 모드 (자주 갱신)
  instBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instLegBall.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instLegStick.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

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

// Sense Debug: Neighbor Radius Rings
let ringInst = null;

function buildNeighborRings() {
  const ringGeo = new THREE.RingGeometry(NEIGHBOR_R * 0.98, NEIGHBOR_R, 40);
  ringGeo.rotateX(-Math.PI / 2); // XZ 평면으로
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x6ec1ff,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  ringInst = new THREE.InstancedMesh(ringGeo, ringMat, COUNT);
  ringInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < COUNT; i++) ringInst.setMatrixAt(i, OFF_MAT);
  scene.add(ringInst);
}

function updateNeighborRings() {
  if (!ringInst) return;
  const m = new THREE.Matrix4();
  for (let i = 0; i < COUNT; i++) {
    const p = positions[i];
    m.makeTranslation(p.x, 0.02, p.z);
    ringInst.setMatrixAt(i, m);
  }
  ringInst.instanceMatrix.needsUpdate = true;
}

// Sense Debug: Gradient pull (-∇ρ) and Global Flow arrows
const gradArrows = [];
const flowArrows = [];
const GRAD_EPS = 1e-3;
const SHOW_FLOW = true;

function buildSenseArrows() {
  const n = Math.min(SENSE_SAMPLE, COUNT);
  for (let i = 0; i < n; i++) {
    const ga = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      0xff6699
    );
    const fa = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      0x00ffaa
    );
    [
      ga.cone.material,
      ga.line.material,
      fa.cone.material,
      fa.line.material,
    ].forEach((m) => {
      m.depthWrite = false;
      m.depthTest = false;
    });
    ga.visible = false;
    fa.visible = false;
    scene.add(ga, fa);
    gradArrows.push(ga);
    flowArrows.push(fa);
  }
}

function updateSenseArrows(tSec) {
  if (!gradArrows.length) return;

  // 모두 숨기고 시작
  for (let i = 0; i < gradArrows.length; i++) {
    gradArrows[i].visible = false;
    flowArrows[i].visible = false;
  }

  const step = Math.max(1, Math.floor(COUNT / gradArrows.length));
  let k = 0;
  for (let i = 0; i < COUNT && k < gradArrows.length; i += step, k++) {
    const s = sense(i, tSec);
    const p = positions[i];
    const base = new THREE.Vector3(p.x, 0.05, p.z);

    // -∇ρ (끌림) — 충분히 클 때만 표시
    const gx = -s.grad.x,
      gz = -s.grad.y;
    const gLen = Math.hypot(gx, gz);
    if (gLen > GRAD_EPS) {
      const dir = new THREE.Vector3(gx / gLen, 0, gz / gLen);
      const len = Math.min(2.0, gLen * 3.0 + 0.2);
      const ga = gradArrows[k];
      ga.position.copy(base);
      ga.setDirection(dir);
      ga.setLength(len, 0.3 * len, 0.2 * len);
      ga.visible = true;
    }

    // 전역 흐름 — 필요할 때만
    if (SHOW_FLOW) {
      const f3 = new THREE.Vector3(s.flow.x, 0, s.flow.y);
      const fa = flowArrows[k];
      fa.position.copy(base).add(new THREE.Vector3(0, 0.01, 0));
      fa.setDirection(f3);
      fa.setLength(1.2, 0.25, 0.15);
      fa.visible = true;
    }
  }
}

// 조향력 크기 제한 함수
function limitVec2(v, max) {
  const len = v.length();
  if (len > max) v.multiplyScalar(max / len);
  return v;
}

// ──────────────────────────────────────────────
// 5️⃣ 행동(Act) — 물리 상태 업데이트
function updateBoids(dt, tSec) {
  // 1) 의사결정: 감지값 → 조향력(steer)
  for (let i = 0; i < COUNT; i++) {
    const s = sense(i, tSec);
    const pi = positions[i];

    // 부분 힘들
    const sep = s.nbrCenter.clone().multiplyScalar(-1); // Separation
    const coh = s.nbrCenter.clone(); // Cohesion
    const ali = s.nbrVel.lengthSq()
      ? s.nbrVel.clone().normalize() // Alignment(이웃만)
      : new THREE.Vector2(0, 0);
    const flowSteer = USE_FLOW
      ? s.flow.clone().multiplyScalar(W_FLOW) // 전역 흐름(약하게)
      : new THREE.Vector2(0, 0);
    const pull = s.grad.clone().multiplyScalar(-1); // -∇ρ (구심력)
    const vortex =
      s.rho > VORTEX_THRESHOLD
        ? new THREE.Vector2(-s.grad.y, s.grad.x).normalize() // ∇ρ ⟂
        : new THREE.Vector2(0, 0);

    // 기본 가중합
    const steer = new THREE.Vector2()
      .addScaledVector(sep, W_SEP)
      .addScaledVector(coh, W_COH)
      .addScaledVector(ali, W_ALI)
      .addScaledVector(pull, W_PULL)
      .addScaledVector(vortex, W_VTX)
      .add(flowSteer);

    // 소프트 월 + 센터 스프링을 여기서 추가 (선언 이후!)
    steer.add(wallForce(pi));
    steer.add(new THREE.Vector2(-pi.x, -pi.z).multiplyScalar(CENTER_K));

    // 조향력 상한
    const len = steer.length();
    if (len > MAX_FORCE) steer.multiplyScalar(MAX_FORCE / len);

    // 가속도 누적
    acc[i].x += steer.x;
    acc[i].z += steer.y;
  }

  // 2) 행동: 속도/위치 적분 + 시각 행렬 동기화
  for (let i = 0; i < COUNT; i++) {
    // 속도 적분
    vel[i].x += acc[i].x;
    vel[i].z += acc[i].z;
    acc[i].set(0, 0, 0);

    // 속도 상한
    const spd = Math.hypot(vel[i].x, vel[i].z);
    if (spd > MAX_SPEED) vel[i].multiplyScalar(MAX_SPEED / spd);

    // 감쇠
    vel[i].multiplyScalar(DAMPING);

    // 위치 적분
    positions[i].x += vel[i].x * dt;
    positions[i].z += vel[i].z * dt;

    // 방향(yaw) 정렬 + 행렬 갱신
    const root = objects[i];
    root.position.set(positions[i].x, positions[i].y, positions[i].z);
    const yaw = Math.atan2(vel[i].x, vel[i].z);
    root.rotation.set(0, yaw, 0);
    root.updateMatrix();

    // 원거리 인스턴스에도 동일 위치 반영
    if (idleHasInstance[i]) {
      instBody.setMatrixAt(i, root.matrix);
      instLegBall.setMatrixAt(i, root.matrix);
      instLegStick.setMatrixAt(i, root.matrix);
    }
  }

  if (instBody) {
    instBody.instanceMatrix.needsUpdate = true;
    instLegBall.instanceMatrix.needsUpdate = true;
    instLegStick.instanceMatrix.needsUpdate = true;
  }
}

// ──────────────────────────────────────────────
// 근거리 애니/원거리 인스턴싱 — 범위 좁힘 + 비동기화
const animSet = new Set();
const idleSet = new Set();
let baseClips = [];

// 인스턴스용 비동기 파라미터
const phase = Float32Array.from(
  { length: COUNT },
  () => Math.random() * Math.PI * 2
);
const driftPhase = Float32Array.from(
  { length: COUNT },
  () => Math.random() * Math.PI * 2
);
const wobbleW = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.55, 0.9, Math.random())
);
const squashA = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.08, 0.16, Math.random())
);
const bendA = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.04, 0.09, Math.random())
);
const bobA = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.02, 0.05, Math.random())
);
const jitterAmt = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.06, 0.14, Math.random())
);

// 스킨드용: timeScale 지터
const baseTimeScale = new Map();
const jitterSpeed = Float32Array.from({ length: COUNT }, () =>
  THREE.MathUtils.lerp(0.08, 0.18, Math.random())
);
const jitterPhase = Float32Array.from(
  { length: COUNT },
  () => Math.random() * Math.PI * 2
);

function ensureMixer(idx) {
  if (mixers.has(idx)) return mixers.get(idx);
  const root = objects[idx];
  const mx = new THREE.AnimationMixer(root);
  const clip = baseClips.length
    ? THREE.AnimationClip.findByName(baseClips, CLIP_NAME) || baseClips[0]
    : null;
  if (clip) {
    const act = mx.clipAction(clip);
    act.play();
    const ts = THREE.MathUtils.lerp(0.75, 1.25, Math.random());
    act.timeScale = ts;
    baseTimeScale.set(idx, ts);
    act.time = Math.random() * clip.duration; // 시작 오프셋
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

  // 카메라와의 거리 오름차순
  const ids = [...Array(COUNT).keys()].sort((a, b) => {
    const pa = positions[a],
      pb = positions[b];
    const da =
      (pa.x - camera.position.x) ** 2 + (pa.z - camera.position.z) ** 2;
    const db =
      (pb.x - camera.position.x) ** 2 + (pb.z - camera.position.z) ** 2;
    return da - db;
  });

  // 반경 내 우선 선정
  const desired = new Set();
  const r2 = ANIM_RADIUS * ANIM_RADIUS;
  for (const i of ids) {
    const p = positions[i];
    const d2 = (p.x - camera.position.x) ** 2 + (p.z - camera.position.z) ** 2;
    if (d2 <= r2) desired.add(i);
  }
  // 부족하면 K-NN 보강
  for (
    let k = 0;
    desired.size < Math.min(MAX_ANIMATING, ids.length) && k < ids.length;
    k++
  )
    desired.add(ids[k]);

  // 히스테리시스
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

  if (DEBUG_SENSE) {
    buildNeighborRings();
    buildSenseArrows();
  }
});

// RD 텍스처
texLoader.load(RD_TEX_PATH, (tex) => {
  if (!USE_RD) return;
  const t = toPOTTexture(tex.image, 1024);
  rdMat = new THREE.MeshLambertMaterial({
    map: t,
    alphaTest: 0.6,
    transparent: false,
    skinning: true,
  });
  rdMat.map.repeat.set(8, 8); // TODO: 내 텍스처 타일 스케일
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

// ──────────────────────────────────────────────
// 2️⃣ 교란장 (Disturbance Field) — 감정/에너지 필드 설정
// ρ(x,z,t) = 시간에 따라 감쇠하는 스칼라 밀도장
// 클릭, 타이머, 충돌 이벤트로 "에미터(emitter)"를 추가하여 감정 확산을 시뮬레이션한다.

const emitters = []; // 활성화된 감정 에너지 소스(에미터) 목록

const MAX_EMITTERS = 64; // 적당한 상한
function addEmitter(x, z, intensity = 1.0, spread = 3.0, decay = 0.98) {
  if (emitters.length >= MAX_EMITTERS) emitters.shift();
  emitters.push({
    x,
    z,
    intensity,
    spread,
    age: 0,
    decay: THREE.MathUtils.clamp(decay, 0.9, 0.999),
  });
}

// 감정 필드 업데이트
function updateDisturbanceField(dt) {
  for (let i = emitters.length - 1; i >= 0; i--) {
    const e = emitters[i];
    e.age += dt;
    e.intensity *= e.decay; // 감쇠
    if (e.intensity < 0.01) {
      emitters.splice(i, 1); // 거의 사라지면 삭제
    }
  }
}

// 시각 테스트용 (나중에 보이드가 이 필드를 읽을 예정)
function visualizeEmitters() {
  emitters.forEach((e) => {
    const color = new THREE.Color(0xff6699).multiplyScalar(e.intensity);
    const s = e.spread * 0.2;
    const geo = new THREE.SphereGeometry(s, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(e.x, 0.5, e.z);
    scene.add(m);
    setTimeout(() => scene.remove(m), 500); // 잠시 후 삭제
  });
}

// [Sense] 밀도장 샘플러: ρ(x,z) — 가우시안 합
function densityAt(x, z) {
  let d = 0;
  for (let i = 0; i < emitters.length; i++) {
    const e = emitters[i];
    const dx = x - e.x,
      dz = z - e.z;
    const s2 = e.spread * e.spread;
    d +=
      e.intensity * Math.exp(-(dx * dx + dz * dz) / (2 * Math.max(1e-4, s2)));
  }
  return d;
}

// [Sense] 수치 그라디언트: ∇ρ(x,z)
function densityGrad(x, z, eps = 0.25) {
  const dpx = densityAt(x + eps, z);
  const dnx = densityAt(x - eps, z);
  const dpz = densityAt(x, z + eps);
  const dnz = densityAt(x, z - eps);
  return new THREE.Vector2((dpx - dnx) / (2 * eps), (dpz - dnz) / (2 * eps));
}

// [Sense] 전역 흐름(빛/바람/염도 등) — 느리게 방향이 바뀌는 단위 벡터
function envFlow(tSec) {
  // 0.7* sin → 좌우로 오가며 평균 0, 크기는 작게
  const th = 0.7 * Math.sin(tSec * 0.05);
  return new THREE.Vector2(Math.cos(th), Math.sin(th)).multiplyScalar(0.3);
}

// [Sense] 한 개체(i)가 환경을 '감지'한 결과를 반환
// 반환값: {
//   nbrCount: number,
//   nbrCenter: THREE.Vector2 (이웃 중심 방향; 없으면 (0,0)),
//   nbrVel: THREE.Vector2 (이웃 평균 속도; 없으면 (0,0)),
//   rho: number (교란장 밀도),
//   grad: THREE.Vector2 (∇ρ, 밀도 증가 방향),
//   flow: THREE.Vector2 (전역 흐름 단위 벡터)
// }
function sense(i, tSec) {
  const pi = positions[i];
  // ── 1) 주변 존재 감지
  let cnt = 0;
  const center = new THREE.Vector2(0, 0);
  const avgVel = new THREE.Vector2(0, 0);

  for (let j = 0; j < COUNT; j++) {
    if (j === i) continue;
    const pj = positions[j];
    const dx = pj.x - pi.x,
      dz = pj.z - pi.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= NEIGHBOR_R2) {
      cnt++;
      center.x += pj.x;
      center.y += pj.z;
      avgVel.x += vel[j].x;
      avgVel.y += vel[j].z;
    }
  }

  if (cnt > 0) {
    center.multiplyScalar(1 / cnt).sub(new THREE.Vector2(pi.x, pi.z)); // (이웃중심 - 나)
    if (center.lengthSq() > 0) center.normalize();
    avgVel.multiplyScalar(1 / cnt);
    if (avgVel.lengthSq() > 0) avgVel.normalize();
  }

  // ── 2) (선택) 외부 자극/교란장 감지
  const rho = densityAt(pi.x, pi.z);
  const grad = densityGrad(pi.x, pi.z); // 밀도 증가 방향

  // ── 3) 전체 흐름 감지
  const flow = envFlow(tSec); // 단위 벡터

  return {
    nbrCount: cnt,
    nbrCenter: center,
    nbrVel: avgVel,
    rho,
    grad,
    flow,
  };
}

function wallForce(pi) {
  const r = Math.hypot(pi.x, pi.z);
  const inner = WORLD_RADIUS - WALL_WIDTH;
  if (r <= inner) return new THREE.Vector2(0, 0);
  const t = (r - inner) / Math.max(1e-6, WALL_WIDTH); // 0→1로 스무스
  const nx = pi.x / (r || 1e-6),
    nz = pi.z / (r || 1e-6); // 바깥쪽 노멀
  // 안쪽으로 미는 힘 = -normal * 세기
  return new THREE.Vector2(-nx, -nz).multiplyScalar(WALL_K * t);
}

// 클릭 핸들러 교체:
window.addEventListener("click", (ev) => {
  const ndc = new THREE.Vector3(
    (ev.clientX / innerWidth) * 2 - 1,
    -(ev.clientY / innerHeight) * 2 + 1,
    0.5
  );
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.ray.intersectPlane(plane, _pt)) {
    addEmitter(_pt.x, _pt.z, 1.0, 3.0);
    visualizeEmitters();
    console.log("Emitter added:", _pt.x.toFixed(2), _pt.z.toFixed(2));
  }
});

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
  updateDisturbanceField(dt);
  const t = performance.now() * 0.001;

  if (DEBUG_SENSE) {
    updateNeighborRings();
    updateSenseArrows(t);
  }

  updateBoids(dt, t);

  // 근거리 스킨드: 타임스케일 지터
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

  // 원거리 인스턴스: 개별 주파수/진폭 + 느린 드리프트
  if (instBody && instLegBall && instLegStick) {
    let needs = false;
    idleSet.forEach((idx) => {
      if (!idleHasInstance[idx]) return;
      const root = objects[idx];
      if (!root) return;

      root.matrix.decompose(tmpP, tmpQ, tmpS);

      const drift =
        1.0 + jitterAmt[idx] * 0.5 * Math.sin(t * 0.1 + driftPhase[idx]);
      const ph = t * (wobbleW[idx] * drift) + phase[idx];

      const sy = 1.0 + Math.sin(ph) * (squashA[idx] * drift);
      const sxz = 1.0 / Math.sqrt(Math.max(0.0001, sy));
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

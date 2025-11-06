import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// 기본 세팅
const hud = document.getElementById("hud");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  70, // 가까운 프레이밍
  innerWidth / innerHeight,
  0.1,
  1000
);
camera.position.set(4, 3, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

let advanceTimer = null; // 다음 세대 예약 타이머
let allSegments = []; // 누적 세그먼트
let globalMaxHeightConst = 1; // ▶모든 색 계산에 쓰는 '고정' 전역최대높이

// 가이드
scene.add(new THREE.AxesHelper(2));
scene.add(new THREE.GridHelper(10, 10, 0x88aabb, 0xaad3df));

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(3, 5, 4);
scene.add(dirLight);

// 파라미터
const params = {
  axiom: "F",
  rule: { F: "F[+F]F[-F]F" },
  genMax: 2, // 0~2세대 (원하는 값으로 조절)
  step: 1.0,
  angleDeg: 25,
  decay: 0.7,
  baseRadius: 0.12,
  growDuration: 0.8,
  colorBottom: 0x2e7d32,
  colorTop: 0x1e3a8a,
};

/* 유틸: 규칙 확장/파싱 */
// F[+F]F[-F]F [ + F[+F]F[-F]F ] F[+F]F[-F]F [ - F[+F]F[-F]F ] F[+F]F[-F]F
function expand(axiom, rule, iterations) {
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = "";
    for (const ch of s) next += rule[ch] ?? ch;
    s = next;
  }
  return s;
}

function buildSegments(instructions, { step, angleRad, decay, baseRadius }) {
  const posStack = [],
    dirStack = [],
    scaleStack = [],
    heightStack = [];
  let position = new THREE.Vector3(0, 0, 0);
  let direction = new THREE.Vector3(0, 1, 0);
  let currentScale = baseRadius;
  let heightFromRoot = 0;

  const segments = [];

  const rotate3D = (dir, axis, radians) => {
    const m = new THREE.Matrix4().makeRotationAxis(axis, radians);
    dir.applyMatrix4(m).normalize();
  };

  for (const ch of instructions) {
    switch (ch) {
      case "F": {
        const len = step;
        const newPos = position
          .clone()
          .add(direction.clone().multiplyScalar(len));
        const nextRadius = currentScale * 0.7;
        segments.push({
          start: position.clone(),
          end: newPos.clone(),
          radiusBottom: currentScale,
          radiusTop: nextRadius,
          hStart: heightFromRoot,
          hEnd: heightFromRoot + len,
        });
        position = newPos;
        heightFromRoot += len;
        currentScale = nextRadius;
        break;
      }
      case "+":
        rotate3D(direction, new THREE.Vector3(0, 0, 1), -angleRad);
        break;
      case "-":
        rotate3D(direction, new THREE.Vector3(0, 0, 1), angleRad);
        break;
      case "[": {
        posStack.push(position.clone());
        dirStack.push(direction.clone());
        scaleStack.push(currentScale);
        heightStack.push(heightFromRoot);
        currentScale *= decay;
        break;
      }
      case "]": {
        position = posStack.pop();
        direction = dirStack.pop();
        currentScale = scaleStack.pop();
        heightFromRoot = heightStack.pop();
        break;
      }
    }
  }
  return segments;
}

// 세그먼트 → 메쉬
function meshesFromSegments(
  segments,
  { colorBottom, colorTop, globalMaxHeight }
) {
  if (!segments.length) return [];
  const maxHeight = globalMaxHeight ?? 1;

  const COLOR_BOTTOM = new THREE.Color(colorBottom);
  const COLOR_TOP = new THREE.Color(colorTop);

  const list = [];
  for (const s of segments) {
    const dir = new THREE.Vector3().subVectors(s.end, s.start);
    const len = dir.length();

    const geom = new THREE.CylinderGeometry(
      s.radiusTop,
      s.radiusBottom,
      len,
      24,
      1,
      false
    );

    // 전역고정 기준 그라데이션
    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const yLocal = pos.getY(i);
      const yWorld = s.hStart + (yLocal + len / 2);
      const t = THREE.MathUtils.clamp(yWorld / maxHeight, 0, 1);
      const c = COLOR_BOTTOM.clone().lerp(COLOR_TOP, t);
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geom, mat);

    const quat = new THREE.Quaternion();
    quat.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize()
    );
    mesh.applyQuaternion(quat);

    geom.translate(0, len / 2, 0);
    mesh.position.copy(s.start);
    mesh.scale.set(1, 0, 1);

    list.push(mesh);
  }
  return list;
}

// 시퀀스 엔진
let stems = [];
let currentSeg = 0;
let growing = null;
let elapsed = 0;

let currentGen = 0;
let playing = true;

const clock = new THREE.Clock();

function getSegmentsForGen(gen) {
  const s = expand(params.axiom, params.rule, gen);
  return buildSegments(s, {
    step: params.step,
    angleRad: THREE.MathUtils.degToRad(params.angleDeg),
    decay: params.decay,
    baseRadius: params.baseRadius,
  });
}

// 전역최대높이 재계산 (genMax/각도/감쇠 등 바뀔 때 호출)
function recomputeGlobalMax() {
  const finalSegs = getSegmentsForGen(params.genMax);
  globalMaxHeightConst = finalSegs.length
    ? finalSegs[finalSegs.length - 1].hEnd
    : 1;
}

function buildGeneration(gen) {
  if (advanceTimer) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }

  const str = expand(params.axiom, params.rule, gen);
  const segs = buildSegments(str, {
    step: params.step,
    angleRad: THREE.MathUtils.degToRad(params.angleDeg),
    decay: params.decay,
    baseRadius: params.baseRadius,
  });

  // 새로 생긴 조각만 추가
  const newSegs = segs.slice(allSegments.length);
  allSegments = segs;

  const newMeshes = meshesFromSegments(newSegs, {
    colorBottom: params.colorBottom,
    colorTop: params.colorTop,
    globalMaxHeight: globalMaxHeightConst, // 항상 고정 기준
  });

  stems.push(...newMeshes);
  for (const m of newMeshes) scene.add(m);

  currentSeg = allSegments.length - newSegs.length;
  growing = null;
  elapsed = 0;

  fitCameraToSegments(segs, 0.65);
  updateHUD(gen, str, allSegments.length);
}

function updateHUD(gen, str, segCount) {
  const ruleDisp = str.length > 80 ? str.slice(0, 77) + "..." : str;
  hud.innerHTML = `
    <div><b>Generation</b> ${gen} / ${params.genMax}</div>
    <div><b>Angle</b> ${params.angleDeg}°, <b>Decay</b> ${params.decay}</div>
    <div><b>Segments</b> ${segCount}</div>
    <div style="opacity:.8"><code>${ruleDisp}</code></div>
    <div style="margin-top:6px;opacity:.8">Space: 재생/일시정지 • ←/→: 세대 이동 • J/K: 각도 • N/M: 감쇠</div>
  `;
}

// 초기 빌드 & 루프
recomputeGlobalMax(); // 먼저 고정 기준 계산
buildGeneration(currentGen);

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (growing) {
    elapsed += delta;
    const t = Math.min(elapsed / params.growDuration, 1.0);
    growing.scale.y = t;
    if (t >= 1.0) {
      growing = null;
      elapsed = 0;
    }
  }

  if (!growing && currentSeg < stems.length) {
    growing = stems[currentSeg];
    currentSeg++;
  }

  if (playing && !growing && currentSeg >= stems.length) {
    if (currentGen < params.genMax) {
      if (!advanceTimer) {
        advanceTimer = setTimeout(() => {
          advanceTimer = null;
          currentGen++;
          buildGeneration(currentGen);
        }, 300);
      }
    } else {
      playing = false;
    }
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

// 프레이밍
function fitCameraToSegments(segs, padding = 1.0) {
  if (!segs.length) return;

  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const s of segs) {
    min.min(s.start);
    min.min(s.end);
    max.max(s.start);
    max.max(s.end);
  }

  const radiusMargin = Math.max(params.baseRadius, params.step * 0.5);
  min.addScalar(-radiusMargin);
  max.addScalar(+radiusMargin);

  const box = new THREE.Box3(min, max);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const halfHeight = size.y * 0.5 * padding;
  const dist = halfHeight / Math.tan(vFov / 2);

  const dir = new THREE.Vector3()
    .subVectors(camera.position, controls.target)
    .normalize();
  if (!isFinite(dir.lengthSq()) || dir.lengthSq() === 0)
    dir.set(1, 1, 2).normalize();

  camera.position.copy(center).add(dir.multiplyScalar(dist));

  const targetOffset = center.clone();
  targetOffset.y -= size.y * 0.15;
  controls.target.copy(targetOffset);

  camera.near = Math.max(0.01, dist / 100);
  camera.far = dist * 10 + size.length() * 2;
  camera.updateProjectionMatrix();
  controls.update();
}

// 인터랙션
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

addEventListener(
  "pointerdown",
  () => {
    const bgm = document.getElementById("bgm");
    if (bgm && bgm.muted) bgm.muted = false;
  },
  { once: true }
);

addEventListener("keydown", (e) => {
  switch (e.key) {
    case " ":
      playing = !playing;
      break;
    case "ArrowRight":
      playing = false;
      if (currentGen < params.genMax) {
        currentGen++;
        buildGeneration(currentGen);
      }
      break;
    case "ArrowLeft":
      playing = false;
      if (currentGen > 0) {
        currentGen--;
        // 뒤 세대 제거
        const targetSegs = getSegmentsForGen(currentGen);
        const removeCount = allSegments.length - targetSegs.length;
        for (let i = 0; i < removeCount; i++) {
          const mesh = stems.pop();
          if (mesh) scene.remove(mesh);
        }
        allSegments = targetSegs;
        // 전역고정 기준은 genMax 기준이므로 그대로 사용
        buildGeneration(currentGen);
      }
      break;
    case "j":
      params.angleDeg = Math.max(5, params.angleDeg - 5);
      resetAndReframe();
      break;
    case "k":
      params.angleDeg = Math.min(75, params.angleDeg + 5);
      resetAndReframe();
      break;
    case "n":
      params.decay = Math.min(0.95, +(params.decay + 0.05).toFixed(2));
      resetAndReframe();
      break;
    case "m":
      params.decay = Math.max(0.4, +(params.decay - 0.05).toFixed(2));
      resetAndReframe();
      break;
    case "[":
      params.genMax = Math.max(0, params.genMax - 1);
      resetAndReframe();
      break;
    case "]":
      params.genMax = Math.min(6, params.genMax + 1);
      resetAndReframe();
      break;
  }
});

// 파라미터 변경 시: 전역최대높이 재계산 + 전체 리셋
function resetAndReframe() {
  for (const m of stems) scene.remove(m);
  stems = [];
  allSegments = [];
  currentSeg = 0;
  growing = null;
  elapsed = 0;
  recomputeGlobalMax(); // 새 파라미터 기준으로 고정값 갱신
  currentGen = Math.min(currentGen, params.genMax);
  buildGeneration(currentGen);
}

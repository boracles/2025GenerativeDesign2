import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js";

// --- 기본 세팅 ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(4, 3, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// --- L-System 규칙 ---
const angle = THREE.MathUtils.degToRad(25);
const instructions = "F[+F]F[-F]F";
const step = 1.0;
const scaleDecay = 0.7; // 세대별 두께 감쇠 비율

// 상태 변수
const posStack = [];
const dirStack = [];
const scaleStack = [];
const heightStack = []; // 전역 높이 스택
let heightFromRoot = 0; // 루트로부터 누적 높이

let position = new THREE.Vector3(0, 0, 0);
let direction = new THREE.Vector3(0, 1, 0);
let currentScale = 0.12; // 초기 줄기 두께

function rotate3D(dir, axis, radians) {
  const mat = new THREE.Matrix4().makeRotationAxis(axis, radians);
  dir.applyMatrix4(mat).normalize();
}

const segments = [];

for (let char of instructions) {
  switch (char) {
    case "F": {
      const len = step; // 지금은 모든 F 길이가 step
      const newPos = position
        .clone()
        .add(direction.clone().multiplyScalar(len));
      const nextRadius = currentScale * 0.7;

      segments.push({
        start: position.clone(),
        end: newPos.clone(),
        radiusBottom: currentScale,
        radiusTop: nextRadius,
        hStart: heightFromRoot, // ★ 이 마디 시작의 전역 높이
        hEnd: heightFromRoot + len, // ★ 이 마디 끝의 전역 높이
      });

      position = newPos.clone();
      heightFromRoot += len; // ★ 전역 높이 증가
      currentScale = nextRadius;
      break;
    }

    case "+":
      rotate3D(direction, new THREE.Vector3(0, 0, 1), -angle);
      break;
    case "-":
      rotate3D(direction, new THREE.Vector3(0, 0, 1), angle);
      break;

    case "[": {
      posStack.push(position.clone());
      dirStack.push(direction.clone());
      scaleStack.push(currentScale);
      heightStack.push(heightFromRoot); // ★ 높이도 저장
      currentScale *= scaleDecay;
      break;
    }

    case "]": {
      position = posStack.pop();
      direction = dirStack.pop();
      currentScale = scaleStack.pop();
      heightFromRoot = heightStack.pop(); // ★ 분기 종료 시 높이 복원
      break;
    }
  }
}
const maxHeight = segments.length ? segments[segments.length - 1].hEnd : 1; // ★ 전체 높이

const COLOR_BOTTOM = new THREE.Color(0x2e7d32); // 진한 녹색(루트)
const COLOR_TOP = new THREE.Color(0x1e3a8a); // 깊은 청색(꼭대기)

function createBranch(start, end, radiusBottom, radiusTop, hStart, hEnd) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();

  const geom = new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    len,
    24,
    1,
    false
  );

  // ▼ 전역 높이 기준 그라데이션: 루트(0)→최대높이(maxHeight)
  const pos = geom.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const yLocal = pos.getY(i); // -len/2 ~ +len/2 (translate 전)
    const yWorld = hStart + (yLocal + len / 2); // ★ 이 버텍스의 전역 높이
    const t = THREE.MathUtils.clamp(yWorld / maxHeight, 0, 1);
    const col = COLOR_BOTTOM.clone().lerp(COLOR_TOP, t);
    colors[i * 3 + 0] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // ▲ 전역 그라데이션

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geom, mat);

  const quat = new THREE.Quaternion();
  quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.applyQuaternion(quat);

  geom.translate(0, len / 2, 0);
  mesh.position.copy(start);
  mesh.scale.set(1, 0, 1);
  return mesh;
}

// --- 조명 + 축 ---
scene.add(new THREE.AxesHelper(2));
scene.add(new THREE.GridHelper(10, 10, 0x999999, 0xcccccc));
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const light = new THREE.DirectionalLight(0xffffff, 0.8);
light.position.set(3, 5, 4);
scene.add(light);

// --- 성장 애니메이션 ---
let currentIndex = 0;
let growing = null;
let elapsed = 0;
const growDuration = 1.0; // 한 segment 자라는 시간

function animate() {
  requestAnimationFrame(animate);
  const delta = 0.016; // 프레임당 시간 고정

  if (growing) {
    elapsed += delta;
    const progress = Math.min(elapsed / growDuration, 1.0);
    growing.scale.y = progress; // 밑에서 위로 자람
    if (progress >= 1.0) {
      growing = null;
      elapsed = 0;
    }
  }

  if (!growing && currentIndex < segments.length) {
    const { start, end, radiusBottom, radiusTop, hStart, hEnd } =
      segments[currentIndex];
    growing = createBranch(start, end, radiusBottom, radiusTop, hStart, hEnd); // ★ 색용 높이 전달
    scene.add(growing);
    currentIndex++;
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

// --- 리사이즈 ---
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js";

// 기본 세팅
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

// 규칙: F[+F]F[-F]F
const angle = THREE.MathUtils.degToRad(25);
const instructions = "F[+F]F[-F]F";
const step = 1.0;
const scaleDecay = 0.7; // 세대별 두께 감쇠 비율

// 위치/방향 스택
const posStack = [];
const dirStack = [];
let position = new THREE.Vector3(0, 0, 0);
let direction = new THREE.Vector3(0, 1, 0);
let currentScale = 0.12; // 초기 줄기 두께

function rotate3D(dir, axis, radians) {
  const mat = new THREE.Matrix4().makeRotationAxis(axis, radians);
  dir.applyMatrix4(mat).normalize();
}

// --- 규칙 해석 (각 F는 segment 객체로 저장) ---
const segments = [];
for (let char of instructions) {
  switch (char) {
    case "F": {
      const newPos = position
        .clone()
        .add(direction.clone().multiplyScalar(step));
      segments.push({
        start: position.clone(),
        end: newPos.clone(),
        radius: currentScale,
      });
      position = newPos.clone();
      currentScale *= scaleDecay;
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
      currentScale *= scaleDecay;
      break;
    }
    case "]": {
      position = posStack.pop();
      direction = dirStack.pop();
      currentScale /= scaleDecay;
      break;
    }
  }
}

// --- Cylinder 브랜치 생성 ---
function createBranch(start, end, radius, color = 0x2266aa, taper = 0.7) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();

  // CylinderGeometry 기본은 중심 기준이므로 아래쪽 기준으로 옮겨야 함
  const geom = new THREE.CylinderGeometry(
    radius * taper,
    radius,
    len,
    12,
    1,
    false
  );
  geom.translate(0, len / 2, 0); // pivot을 아래로 이동

  const mat = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geom, mat);

  // 방향 회전
  const quat = new THREE.Quaternion();
  quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.applyQuaternion(quat);

  // start가 정확히 밑부분에 닿도록 설정
  mesh.position.copy(start);

  // 처음에는 길이 0에서 시작 → scale.y = 0
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
const growDuration = 1.0;

function animate(time) {
  requestAnimationFrame(animate);
  const delta = 0.016; // 프레임당 시간 고정 (부드럽게)

  if (growing) {
    elapsed += delta;
    const progress = Math.min(elapsed / growDuration, 1.0);
    growing.scale.y = progress; // 아래에서 위로 자람
    if (progress >= 1.0) {
      growing = null;
      elapsed = 0;
    }
  }

  if (!growing && currentIndex < segments.length) {
    const { start, end, radius } = segments[currentIndex];
    const color = currentIndex === 0 ? 0x00ff00 : 0x2266aa;
    growing = createBranch(start, end, radius, color);
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

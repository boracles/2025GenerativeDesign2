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
      const newPos = position
        .clone()
        .add(direction.clone().multiplyScalar(step));
      const nextRadius = currentScale * 0.7; // taper 비율만 반영

      segments.push({
        start: position.clone(),
        end: newPos.clone(),
        radiusBottom: currentScale,
        radiusTop: nextRadius,
      });

      position = newPos.clone();
      // ❌ currentScale *= scaleDecay;  ← 제거!
      currentScale = nextRadius; // 중심 줄기는 taper만으로 연결
      break;
    }

    case "+":
      rotate3D(direction, new THREE.Vector3(0, 0, 1), -angle);
      break;
    case "-":
      rotate3D(direction, new THREE.Vector3(0, 0, 1), angle);
      break;

    case "[": {
      // 가지 분기 시작 → 부모 상태 저장
      posStack.push(position.clone());
      dirStack.push(direction.clone());
      scaleStack.push(currentScale);
      currentScale *= scaleDecay; // 가지는 감쇠된 두께로 시작
      break;
    }

    case "]": {
      // 가지 분기 끝 → 부모 상태 복원
      position = posStack.pop();
      direction = dirStack.pop();
      currentScale = scaleStack.pop();
      break;
    }
  }
}

// --- Cylinder 생성 ---
function createBranch(start, end, radiusBottom, radiusTop, color = 0x2266aa) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();

  // 1️⃣ Cylinder 기본 생성
  const geom = new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    len,
    20,
    1,
    false
  );

  const mat = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geom, mat);

  // 2️⃣ 방향 회전 먼저 적용
  const quat = new THREE.Quaternion();
  quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.applyQuaternion(quat);

  // 3️⃣ 이제 pivot을 아래로 내리고 (회전 후 기준으로!)
  geom.translate(0, len / 2, 0);

  // 4️⃣ 회전된 방향에 따라 위치 정확히 보정
  mesh.position.copy(start);

  // 5️⃣ 길이 0에서 자라나는 애니메이션용 scale
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
    const { start, end, radiusBottom, radiusTop } = segments[currentIndex];
    const color = currentIndex === 0 ? 0x00ff00 : 0x2266aa;
    growing = createBranch(start, end, radiusBottom, radiusTop, color);
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

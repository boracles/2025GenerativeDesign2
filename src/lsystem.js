import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js";

// -------------------------------------------
// 🌱 기본 세팅
// -------------------------------------------
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

// -------------------------------------------
// 🌿 L-System 규칙 정의
// -------------------------------------------
const angle = THREE.MathUtils.degToRad(25);
const instructions = "F[+F]F[-F]F"; // 실행할 문자열 (문자열이 곧 규칙)
const step = 1.0;
const scaleDecay = 0.7; // 세대별 줄기 두께 감쇠 비율

// -------------------------------------------
// 상태 변수 (위치, 방향, 스케일, 높이 스택)
// -------------------------------------------
const posStack = [];
const dirStack = [];
const scaleStack = [];
const heightStack = []; // 전역 높이 스택
let heightFromRoot = 0; // 루트로부터 누적된 높이

let position = new THREE.Vector3(0, 0, 0);
let direction = new THREE.Vector3(0, 1, 0);
let currentScale = 0.12; // 초기 줄기 두께

// -------------------------------------------
// 회전 함수 (3D 벡터 방향 변경)
// -------------------------------------------
function rotate3D(dir, axis, radians) {
  const mat = new THREE.Matrix4().makeRotationAxis(axis, radians);
  dir.applyMatrix4(mat).normalize();
}

// -------------------------------------------
// L-System 문자열 해석 및 segment 생성
// -------------------------------------------
const segments = [];

/*
───────────────────────────────────────────────
📖 L-System 기호 설명
───────────────────────────────────────────────
기호 | 의미                | 동작
───────────────────────────────────────────────
F   | 앞으로 성장          | 줄기 위로 1단계 자람 (한 단위 길이 이동)
[   | 상태 저장 (가지 시작) | 현재 위치·방향·두께·높이를 스택에 저장
+   | 오른쪽 회전          | 오른쪽으로 angle(25°)만큼 방향 변경
]   | 상태 복원 (가지 끝)  | 스택에서 위치·방향·두께·높이 복원
-   | 왼쪽 회전            | 왼쪽으로 angle(25°)만큼 방향 변경
───────────────────────────────────────────────
*/

for (let char of instructions) {
  switch (char) {
    // -----------------------------------------
    // F: 앞으로 성장 (줄기 한 단위)
    // → 현재 방향으로 step만큼 전진하며 줄기 생성
    // -----------------------------------------
    case "F": {
      const len = step;
      const newPos = position
        .clone()
        .add(direction.clone().multiplyScalar(len));
      const nextRadius = currentScale * 0.7;

      // 줄기 segment 저장
      segments.push({
        start: position.clone(),
        end: newPos.clone(),
        radiusBottom: currentScale,
        radiusTop: nextRadius,
        hStart: heightFromRoot,
        hEnd: heightFromRoot + len,
      });

      // 위치 및 높이 갱신
      position = newPos.clone();
      heightFromRoot += len;
      currentScale = nextRadius;
      break;
    }

    // -----------------------------------------
    // +: 오른쪽 회전
    // → 오른쪽(z축 기준 시계방향)으로 angle만큼 회전
    // -----------------------------------------
    case "+":
      rotate3D(direction, new THREE.Vector3(0, 0, 1), -angle);
      break;

    // -----------------------------------------
    // -: 왼쪽 회전
    // → 왼쪽(z축 기준 반시계방향)으로 angle만큼 회전
    // -----------------------------------------
    case "-":
      rotate3D(direction, new THREE.Vector3(0, 0, 1), angle);
      break;

    // -----------------------------------------
    // [: 상태 저장 (가지 시작)
    // → 현재의 위치, 방향, 두께, 높이를 각각 스택에 저장
    //    이후의 성장은 이 지점을 기준으로 새 가지가 뻗음
    // -----------------------------------------
    case "[": {
      posStack.push(position.clone());
      dirStack.push(direction.clone());
      scaleStack.push(currentScale);
      heightStack.push(heightFromRoot);
      currentScale *= scaleDecay; // 가지로 갈수록 줄기 가늘어짐
      break;
    }

    // -----------------------------------------
    // ]: 상태 복원 (가지 끝)
    // → 가장 최근에 저장한 스택 상태로 되돌아감
    //    가지가 끝나고 원래 줄기로 복귀
    // -----------------------------------------
    case "]": {
      position = posStack.pop();
      direction = dirStack.pop();
      currentScale = scaleStack.pop();
      heightFromRoot = heightStack.pop();
      break;
    }
  }
}

// -------------------------------------------
// 전체 높이 계산 (그라데이션 기준값)
const maxHeight = segments.length ? segments[segments.length - 1].hEnd : 1;

// -------------------------------------------
// 색상: 루트→진녹색, 꼭대기→푸른색
const COLOR_BOTTOM = new THREE.Color(0x2e7d32);
const COLOR_TOP = new THREE.Color(0x1e3a8a);

// -------------------------------------------
// 줄기 메쉬 생성 함수 (그라데이션 적용)
// -------------------------------------------
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

  // 전역 높이에 따른 색상 보간
  const pos = geom.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const yLocal = pos.getY(i);
    const yWorld = hStart + (yLocal + len / 2);
    const t = THREE.MathUtils.clamp(yWorld / maxHeight, 0, 1);
    const col = COLOR_BOTTOM.clone().lerp(COLOR_TOP, t);
    colors[i * 3 + 0] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

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

// -------------------------------------------
// 조명 + 축 + 그리드
// -------------------------------------------
scene.add(new THREE.AxesHelper(2));
scene.add(new THREE.GridHelper(10, 10, 0x999999, 0xcccccc));
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const light = new THREE.DirectionalLight(0xffffff, 0.8);
light.position.set(3, 5, 4);
scene.add(light);

// -------------------------------------------
// 성장 애니메이션
// -------------------------------------------
let currentIndex = 0;
let growing = null;
let elapsed = 0;
const growDuration = 1.0; // 한 segment 자라는 시간

function animate() {
  requestAnimationFrame(animate);
  const delta = 0.016;

  // 현재 성장 중인 segment 처리
  if (growing) {
    elapsed += delta;
    const progress = Math.min(elapsed / growDuration, 1.0);
    growing.scale.y = progress; // 밑에서 위로 자라남
    if (progress >= 1.0) {
      growing = null;
      elapsed = 0;
    }
  }

  // 다음 segment 생성
  if (!growing && currentIndex < segments.length) {
    const { start, end, radiusBottom, radiusTop, hStart, hEnd } =
      segments[currentIndex];
    growing = createBranch(start, end, radiusBottom, radiusTop, hStart, hEnd);
    scene.add(growing);
    currentIndex++;
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

// -------------------------------------------
// 창 리사이즈 대응
// -------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

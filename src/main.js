import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { terrainRoot, tickUniforms } from "./terrain.js";
import { characterRoot } from "./character.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { initMovement, updateMovement, setMovementParams } from "./movement.js";

// 기본 장면/카메라/렌더러
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(90, 60, 90);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// ✅ 기본 환경광(IBL) 세팅: 실내 환경을 빠르게 적용
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// ✅ 라이트 추가 (둘 다 쓰면 안전)
const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.7);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.1);
dir.position.set(50, 80, 40);
dir.castShadow = false; // 그림자 필요하면 true
scene.add(dir);

// 컨트롤
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

// 지형 추가
scene.add(terrainRoot);
scene.add(characterRoot);
characterRoot.scale.setScalar(10);

console.log("[main] characterRoot.uuid =", characterRoot.uuid);

// 레이캐스트가 어느 면이든 맞도록(표시에도 큰 영향 없음)
if (terrainRoot.material) {
  const mats = Array.isArray(terrainRoot.material)
    ? terrainRoot.material
    : [terrainRoot.material];
  for (const m of mats) {
    if (m && m.side !== THREE.DoubleSide) {
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    }
  }
}

// 이동 시스템 초기화
initMovement({
  camera,
  renderer,
  terrainRoot,
  characterRoot,
});

setMovementParams({ speed: 120, heightOffset: 1.5, slopeAlign: 0.0 });

// 원하면 파라미터 튜닝
// setMovementParams({ speed: 10, heightOffset: 0.6, slopeAlign: 0.4 });

// main.js 안에서 initMovement 호출 바로 아래에 추가
renderer.domElement.style.pointerEvents = "auto";
controls.enabled = true;

// 리사이즈
window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// 루프
const clock = new THREE.Clock();

function animate() {
  const t = clock.getElapsedTime();
  const dt = clock.getDelta();
  // terrain 유니폼 시간 업데이트
  if (tickUniforms) {
    tickUniforms.uTime.value = t;
  }

  // 이동 업데이트
  updateMovement(dt);

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

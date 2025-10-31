import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { terrainRoot, tickUniforms } from "./terrain.js";
import { characterRoot } from "./character.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

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
scene.environment = pmrem.fromScene(
  new RoomEnvironment(renderer),
  0.04
).texture;

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
  // terrain 유니폼 시간 업데이트
  if (tickUniforms) {
    tickUniforms.uTime.value = t;
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

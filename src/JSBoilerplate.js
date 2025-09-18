// ─── Imports ───
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ─── Renderer ───
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// ─── Scene & Camera ───
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202020);

const camera = new THREE.PerspectiveCamera(
  60, // 시야각(FOV)
  window.innerWidth / window.innerHeight, // 종횡비
  0.1, // near
  1000 // far
);
camera.position.set(3, 2, 5);

// ─── Controls ───
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ─── Objects ───
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// ─── Light ───
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5);
scene.add(light);

// ─── Animation Loop ───
function animate() {
  requestAnimationFrame(animate);

  cube.rotation.y += 0.01; // 회전 예제
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ─── Resize 대응 ───
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

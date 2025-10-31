import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { terrainRoot, initTerrain, updateTerrain } from "./terrain.js";

let renderer, scene, camera, controls, clock;

init();
animate();

async function init() {
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  // Scene & Camera
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e13);
  scene.fog = new THREE.Fog(0x0b0e13, 120, 280);

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(70, 55, 90);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0, 0);
  controls.update();

  // Lights (지형 셰이더는 자체 램버트 계산을 하지만 씬 느낌을 위해 약간 추가)
  const hemi = new THREE.HemisphereLight(0x88aaff, 0x223344, 0.3);
  scene.add(hemi);

  // Terrain
  scene.add(terrainRoot);
  await initTerrain(); // GLSL 로드 및 머티리얼 연결

  // Clock
  clock = new THREE.Clock();

  // Resize
  window.addEventListener("resize", onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const t = clock ? clock.getElapsedTime() : 0.0;

  controls.update();
  updateTerrain(t);
  renderer.render(scene, camera);
}

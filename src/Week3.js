import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x92ced8);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(3, 2, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(5, 10, 7);
dirLight.castShadow = true;
scene.add(dirLight);

// 🔻 GLB 로딩 준비
const loader = new GLTFLoader();
let mixer; // 애니메이션용
const clock = new THREE.Clock();

// 🔻 GLB 로드 (여기 안에서만 model 사용)
loader.load(
  "./assets/models/Tentacles.glb",
  (gltf) => {
    const model = gltf.scene;
    scene.add(model);

    // 몸통 찾기
    let body = null;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
        if (/body|halophile/i.test(o.name)) body = o;

        // 머티리얼 보정
        const fix = (m) => {
          if (!m) return;
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          m.transparent = false;
          m.opacity = 1;
          m.alphaTest = 0;
          m.depthWrite = true;
          m.side = THREE.DoubleSide;
          if (m.roughness === undefined) m.roughness = 0.8;
          if (m.metalness === undefined) m.metalness = 0.0;
          if ("transmission" in m) m.transmission = 0;
          m.needsUpdate = true;
        };
        Array.isArray(o.material) ? o.material.forEach(fix) : fix(o.material);
      }
    });

    console.log("body mesh:", body?.name || "NOT IN GLB");

    // 테스트용 강제 머티리얼 (선택)
    if (body) {
      body.material = new THREE.MeshStandardMaterial({
        color: 0x6a7a7a,
        roughness: 0.6,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
    }

    // 애니메이션
    mixer = new THREE.AnimationMixer(model);
    const clip =
      THREE.AnimationClip.findByName(
        gltf.animations,
        "FeedingTentacle_WaveTest"
      ) || gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
  },
  undefined,
  (err) => console.error("GLB load error:", err)
);

// 리사이즈
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 루프
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (mixer) mixer.update(clock.getDelta());
  renderer.render(scene, camera);
}
animate();

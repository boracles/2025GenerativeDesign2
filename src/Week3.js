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

// ------------------------------------------------------------------
// 전역 변수
let rdMat = null;
let modelLoaded = null;

function toPOTTexture(srcImage, size = 1024) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  ctx.drawImage(srcImage, 0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // 이제 Repeat OK
  tex.generateMipmaps = true; // mipmap 활성화
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

// 텍스처 로드
const texLoader = new THREE.TextureLoader();
texLoader.load("./assets/textures/RD.png", (tex) => {
  // RD.png → 1024x1024로 리샘플
  const rdPOT = toPOTTexture(tex.image, 1024);

  rdMat = new THREE.MeshStandardMaterial({
    map: rdPOT,
    metalness: 0.0,
    roughness: 1.0,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.5,
    depthWrite: true,
  });

  // 원하는 타일 수로 (깨짐 없이)
  rdMat.map.repeat.set(8, 8); // ← 타일링 크게
  rdMat.map.needsUpdate = true;

  if (modelLoaded) applyRDToNamedMeshes(modelLoaded);
});

// ------------------------------------------------------------------
// GLB 로드
const loader = new GLTFLoader();
let mixer;
const clock = new THREE.Clock();

loader.load(
  "./assets/models/Tentacles.glb",
  (gltf) => {
    modelLoaded = gltf.scene;
    scene.add(modelLoaded);

    // 텍스처가 이미 준비된 경우 바로 적용
    if (rdMat) {
      applyRDToNamedMeshes(modelLoaded);
      console.log("✅ RD texture applied (after texture)");
    }

    // 애니메이션
    mixer = new THREE.AnimationMixer(modelLoaded);
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

// ------------------------------------------------------------------
// RD 적용 함수
function applyRDToNamedMeshes(root) {
  const hits = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (
      /body(\.\d+)?/i.test(o.name) ||
      /leg[_\s-]?ball(\.\d+)?/i.test(o.name)
    ) {
      o.material = rdMat;
      o.castShadow = o.receiveShadow = true;
      console.log("RD applied →", o.name);
      hits.push(o.name);
    }
  });
  console.log(`RD applied count: ${hits.length}`, hits);
}

// ------------------------------------------------------------------
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

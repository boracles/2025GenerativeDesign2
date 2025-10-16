// Instanced Tentacles (No skeletal animation) — Full Paste-In
// 요구: three >= r155, ./assets/models/Tentacles.glb, ./assets/textures/RD.png

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// ──────────────────────────────────────────────
// 옵션 스위치
const USE_TIME_WARP = 0; // 0 = 정적 왜곡(부하 최소), 1 = 약한 시간 왜곡
const COUNT = 100;
const COLS = 10;
const GAP_X = 3.0;
const GAP_Z = 3.0;
const GLB_PATH = "./assets/models/Tentacles.glb";

// ──────────────────────────────────────────────
// 기본 세팅 (경량화)
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x003e58);

const camera = new THREE.PerspectiveCamera(
  55,
  innerWidth / innerHeight,
  0.1,
  1000
);
camera.position.set(0, 18, 10);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: "high-performance",
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.physicallyCorrectLights = false;
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableRotate = true;
controls.enablePan = true;
controls.screenSpacePanning = false;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.minPolarAngle = Math.PI * 0.15;
controls.maxPolarAngle = Math.PI * 0.48;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.0));

// ──────────────────────────────────────────────
// FPS HUD
const hud = document.createElement("div");
hud.style.cssText = `
  position:fixed;left:10px;top:10px;font:12px/1.2 ui-monospace,monospace;
  color:#eaf6ff;background:rgba(0,0,0,.35);padding:8px 10px;border-radius:8px;
  border:1px solid rgba(255,255,255,.12);z-index:9999;user-select:none;`;
document.body.appendChild(hud);
let frames = 0,
  last = performance.now(),
  fps = 0,
  avg = 0,
  samples = 0;
function updateFPS() {
  const now = performance.now();
  frames++;
  if (now - last >= 1000) {
    fps = (frames * 1000) / (now - last);
    frames = 0;
    last = now;
    samples++;
    avg += (fps - avg) / samples;
    hud.innerHTML = `FPS: ${fps.toFixed(1)}<br>AVG: ${avg.toFixed(
      1
    )}<br>Inst: ${COUNT}`;
  }
}

// ──────────────────────────────────────────────
// RD 텍스처 (Lambert)
let rdMap = null;
const texLoader = new THREE.TextureLoader();
function toPOTTexture(img, size = 1024) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  c.getContext("2d").drawImage(img, 0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
texLoader.load("./assets/textures/RD.png", (tex) => {
  rdMap = toPOTTexture(tex.image, 1024);
  rdMap.repeat.set(8, 8);
  // 이미 인스턴스가 만들어졌다면 뒤늦게 맵 연결
  if (instanced && instanced.material && !instanced.material.map) {
    instanced.material.map = rdMap;
    instanced.material.needsUpdate = true;
  }
});

// ──────────────────────────────────────────────
// 인스턴싱 배치 좌표
const positions = [];
(function initLayout() {
  const rows = Math.ceil(COUNT / COLS);
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      if (i >= COUNT) break;
      const x = (c - (COLS - 1) / 2) * GAP_X;
      const z = (r - (rows - 1) / 2) * GAP_Z;
      positions[i++] = new THREE.Vector3(x, 0, z);
    }
  }
})();

// ──────────────────────────────────────────────
// Merge 전 지오메트리 정규화 헬퍼
function ensureMinAttributes(geom) {
  // 인덱스 제거(속성 수 불일치 방지)
  if (geom.index) geom = geom.toNonIndexed();

  // 허용 속성만 남기기: position / normal / uv
  const allow = new Set(["position", "normal", "uv"]);
  for (const name of Object.keys(geom.attributes)) {
    if (!allow.has(name)) geom.deleteAttribute(name);
  }

  // uv 없으면 dummy uv 생성
  if (!geom.getAttribute("uv")) {
    const pos = geom.getAttribute("position");
    const uv = new Float32Array(pos.count * 2);
    geom.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  }

  // normal 없으면 계산
  if (!geom.getAttribute("normal")) {
    geom.computeVertexNormals();
  }

  // morph / skin 제거
  geom.morphAttributes = {};
  geom.deleteAttribute("skinIndex");
  geom.deleteAttribute("skinWeight");

  return geom;
}
function bakeWorldTransform(geom, obj) {
  const g = geom.clone();
  g.applyMatrix4(obj.matrixWorld);
  return g;
}

// ──────────────────────────────────────────────
// GLB 로드 → 모든 Mesh를 하나의 BufferGeometry로 병합 → InstancedMesh
const loader = new GLTFLoader();
let instanced = null;
let uTime = { value: 0 };

loader.load(
  GLB_PATH,
  async (gltf) => {
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    const geoms = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      let g = bakeWorldTransform(o.geometry, o);
      g = ensureMinAttributes(g);
      geoms.push(g);
    });

    if (geoms.length === 0) {
      console.error("GLB에서 Mesh 지오메트리를 찾지 못함.");
      return;
    }

    const merged = BufferGeometryUtils.mergeGeometries(geoms, true);
    if (!merged) {
      console.error("mergeGeometries 실패: 속성 정규화 로직을 확인하세요.");
      return;
    }

    // ── 인스턴스별 속성(위상/세기) 부여
    const iPhase = new Float32Array(COUNT);
    const iAmp = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      iPhase[i] = Math.random() * Math.PI * 2;
      iAmp[i] = 0.035 + Math.random() * 0.035; // 왜곡 세기
    }
    merged.setAttribute(
      "iPhase",
      new THREE.InstancedBufferAttribute(iPhase, 1)
    );
    merged.setAttribute("iAmp", new THREE.InstancedBufferAttribute(iAmp, 1));

    // ── 머터리얼: Lambert + RD맵(있으면)
    const mat = new THREE.MeshLambertMaterial({
      map: rdMap || null,
      transparent: false,
      alphaTest: 0.6,
    });

    // ── 저비용 버텍스 왜곡 셰이더 주입
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;

      shader.vertexShader =
        `
        attribute float iPhase;
        attribute float iAmp;
        uniform float uTime;
        // 간단한 3축 사인 왜곡
        vec3 cheapWarp(vec3 p, float phase, float amp, float t){
          float w1 = sin(p.y*0.7 + phase + ${USE_TIME_WARP ? "t*0.7" : "0.0"});
          float w2 = cos(p.x*0.6 + phase*1.3 + ${
            USE_TIME_WARP ? "t*0.6" : "0.0"
          });
          float w3 = sin(p.z*0.8 - phase*0.7 + ${
            USE_TIME_WARP ? "t*0.5" : "0.0"
          });
          return p + vec3(w1, w2, w3) * amp;
        }
      ` +
        shader.vertexShader.replace(
          `#include <begin_vertex>`,
          `
          vec3 transformed = vec3(position);
          transformed = cheapWarp(transformed, iPhase, iAmp, uTime);
        `
        );
    };

    // ── InstancedMesh 생성/배치
    instanced = new THREE.InstancedMesh(merged, mat, COUNT);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < COUNT; i++) {
      const p = positions[i];
      q.setFromEuler(new THREE.Euler(0, Math.random() * Math.PI * 2, 0));
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(1, 1, 1));
      instanced.setMatrixAt(i, m);
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.frustumCulled = true;
    instanced.count = COUNT;

    scene.add(instanced);
  },
  undefined,
  (err) => console.error("GLB load error:", err)
);

// ──────────────────────────────────────────────
// 루프
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  if (USE_TIME_WARP && instanced) {
    uTime.value = performance.now() * 0.001;
  }

  renderer.render(scene, camera);
  updateFPS();
}
animate();

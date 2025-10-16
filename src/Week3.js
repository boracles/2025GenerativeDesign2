// VAT Instancing (LOOP-baked). 필요 파일: /VAT_meta.json, /VAT_pos.png, ./assets/models/Tentacle.glb
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// =============== 기본 씬 ===============
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x003e58);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 18, 10);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.minPolarAngle = Math.PI * 0.15;
controls.maxPolarAngle = Math.PI * 0.48;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(10, 20, 12);
dirLight.castShadow = true;
scene.add(dirLight);

const grid = new THREE.GridHelper(48, 24, 0x2aa9c8, 0x1f6a82);
scene.add(grid);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// =============== FPS HUD(선택) ===============
const hud = document.createElement("div");
hud.style.cssText = "position:fixed;left:10px;top:10px;font:12px/1.2 ui-monospace,monospace;color:#eaf6ff;background:rgba(0,0,0,.35);padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);z-index:9999;user-select:none;";
document.body.appendChild(hud);
let frames=0,last=performance.now(),fps=0,avg=0,samples=0;
function updateFPS() {
  const now = performance.now();
  frames++;
  if (now - last >= 1000) {
    fps = (frames * 1000) / (now - last);
    frames = 0; last = now;
    samples++; avg += (fps - avg) / samples;
    hud.innerHTML = `FPS: ${fps.toFixed(1)}<br>AVG: ${avg.toFixed(1)}`;
  }
}

// =============== 유틸 ===============
const norm = (s) => s.toLowerCase().replace(/\s+/g,"").replace(/_/g,"").replace(/\.\d+$/,"");

// =============== 메인 로직 ===============
const clock = new THREE.Clock();
let shaderMat = null;

(async function main() {
  // 1) 메타 로드
  const meta = await (await fetch("/VAT_meta.json")).json();
  const VCOUNT = meta.vertexCount;
  const FCOUNT = meta.frameCount;
  const FPS    = meta.fps;
  const BMIN   = new THREE.Vector3(...meta.boundsMin);
  const BMAX   = new THREE.Vector3(...meta.boundsMax);
  const TEX_W  = meta.layout.width;
  const TEX_H  = meta.layout.height;
  const PARTS  = meta.parts;

  // 2) VAT 텍스처 로드 (Non-Color, Nearest)
  const positionTex = await new Promise((res, rej) => {
    new THREE.TextureLoader().load(
      "/VAT_pos.png",
      (tex) => {
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.colorSpace = THREE.NoColorSpace;
        tex.flipY = false;
        res(tex);
      },
      undefined, rej
    );
  });

  // 3) GLB 로드
  const gltf = await new GLTFLoader().loadAsync("./assets/models/Tentacle.glb");
  const meshes = [];
  gltf.scene.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
  });

  // 이름→후보 맵
  const byNorm = new Map();
  for (const m of meshes) {
    const k = norm(m.name);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(m);
  }

  // 4) 파츠별 지오메트리 수집 (★항상 non-indexed, 루프 기준으로 VAT vcount와 일치 확인)
  const geoms = [];
  let sumV = 0;

  for (const p of PARTS) {
    const k = norm(p.name);
    let mesh = byNorm.get(k)?.[0];

    // 이름으로 못 찾으면 루프-버텍스 개수로 탐색 (non-indexed count)
    if (!mesh) {
      mesh = meshes.find((mm) => {
        const cntNon = (mm.geometry.index ? mm.geometry.toNonIndexed() : mm.geometry).attributes.position.count;
        return cntNon === p.vcount;
      });
    }
    if (!mesh) {
      console.warn(`[PART NOT FOUND] name='${p.name}' vcount=${p.vcount}`);
      throw new Error(`[VAT] GLB에 '${p.name}' 대응 Mesh 없음`);
    }

    // ★ non-indexed 강제
    let gNon = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const cntNon = gNon.attributes.position.count;

    if (cntNon !== p.vcount) {
      console.warn(`[PART MISMATCH] ${p.name}: VAT=${p.vcount}; GLB(nonIdx)=${cntNon}`);
      throw new Error(`[VAT] '${p.name}'의 루프 버텍스 수가 VAT와 다릅니다. (베이크/익스포트 기준을 통일하세요)`);
    }

    geoms.push(gNon);
    sumV += p.vcount;
  }

  if (sumV !== VCOUNT) {
    console.warn(`[SUM VCOUNT MISMATCH] meta.vertexCount=${VCOUNT}, sum(parts)=${sumV}`);
    // 강제 진행은 가능하지만, 데이터 불일치 시 애니가 어긋날 수 있음
  }

  // 5) 파츠 병합 (인덱스 없이)
  let merged = BufferGeometryUtils.mergeGeometries(geoms, /*useGroups=*/true);
  if (!merged) throw new Error("[VAT] 병합 실패");
  if (merged.index) merged = merged.toNonIndexed();

  const liveCount = merged.attributes.position.count;
  if (liveCount !== VCOUNT) {
    console.warn(`[LIVE COUNT] merged(nonIdx)=${liveCount}, meta.vertexCount=${VCOUNT}`);
  }

  // vertexIndex (0..liveCount-1)
  const vertexIndex = new Float32Array(liveCount);
  for (let i = 0; i < liveCount; i++) vertexIndex[i] = i;
  merged.setAttribute("vertexIndex", new THREE.BufferAttribute(vertexIndex, 1));

  // 6) 셰이더
  const vsh = `
  attribute mat4 instanceMatrix;

    uniform sampler2D positionTex;
    uniform vec3 boundsMin, boundsMax;
    uniform float frameCount, vertexCount, fps, globalTime;
    uniform float texWidth, texHeight;

    attribute float vertexIndex;
    attribute float instanceTimeOffset;

    void main(){
     void main(){
    float t = globalTime + instanceTimeOffset;
    float frameF = mod(t * fps, frameCount);
    float frame  = floor(frameF);

    float lin = frame * vertexCount + vertexIndex;
    float u = mod(lin, texWidth) + 0.5;
    float v = floor(lin / texWidth) + 0.5;
    vec2  uv = vec2(u / texWidth, v / texHeight);

    vec3 posN = texture2D(positionTex, uv).xyz;
    vec3 pos  = mix(boundsMin, boundsMax, posN);

    // ★ 인스턴스 행렬을 먼저 곱하고, 그 다음 모델뷰 행렬
    vec4 wPos  = instanceMatrix * vec4(pos, 1.0);
    vec4 mvPos = modelViewMatrix * wPos;
    gl_Position = projectionMatrix * mvPos;
  }`;

  const fsh = `
    void main(){
      gl_FragColor = vec4(0.90, 0.95, 1.00, 1.0);
    }`;

  shaderMat = new THREE.ShaderMaterial({
    vertexShader: vsh,
    fragmentShader: fsh,
    uniforms: {
      positionTex: { value: positionTex },
      boundsMin:   { value: BMIN },
      boundsMax:   { value: BMAX },
      frameCount:  { value: FCOUNT },
      vertexCount: { value: VCOUNT },
      fps:         { value: FPS },
      globalTime:  { value: 0 },
      texWidth:    { value: TEX_W },
      texHeight:   { value: TEX_H },
    },
    side: THREE.DoubleSide,
  });

// ★ instancing define 추가
shaderMat.defines = shaderMat.defines || {};
shaderMat.defines.USE_INSTANCING = 1;   // 일부 드라이버에서 필요
shaderMat.needsUpdate = true;

  // 7) 인스턴싱
  const INST = 100;            // 원하는 개수
  const COLS = 10;
  const GAP  = 3.0;

  const mesh = new THREE.InstancedMesh(merged, shaderMat, INST);
  const dummy = new THREE.Object3D();

  // per-instance 시간 오프셋
  const offsets = new Float32Array(INST);
  for (let i = 0; i < INST; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    dummy.position.set(
      (col - (COLS - 1) / 2) * GAP,
      0,
      (row - Math.ceil(INST / COLS - 1) / 2) * GAP
    );
    dummy.rotation.y = Math.random() * Math.PI * 2;
    dummy.scale.setScalar(1.0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    offsets[i] = Math.random() * 10.0;
  }
  merged.setAttribute("instanceTimeOffset", new THREE.InstancedBufferAttribute(offsets, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  console.log("[VAT] OK. meta VCOUNT=", VCOUNT, "merged liveCount=", liveCount);
})().catch((e) => console.error(e));

// =============== 루프 ===============
(function animate(){
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (shaderMat) shaderMat.uniforms.globalTime.value += dt;
  controls.update();
  renderer.render(scene, camera);
  updateFPS();
})();

console.log("TEX", positionTex.image?.width, positionTex.image?.height);
console.log("BMIN", BMIN, "BMAX", BMAX);
console.log("INST", INST, "VCOUNT", VCOUNT);
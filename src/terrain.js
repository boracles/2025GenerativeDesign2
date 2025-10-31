import * as THREE from "three";

// 외부에서 바로 add할 수 있게 빈 그룹을 먼저 export
export const terrainRoot = new THREE.Group();

let material = null;
let uniforms = null;

async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return await res.text();
}

export async function initTerrain() {
  const [vert, frag] = await Promise.all([
    loadText("./src/shaders/terrain.vert.glsl"),
    loadText("./src/shaders/terrain.frag.glsl"),
  ]);

  const size = 200;
  const segs = 256;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  uniforms = {
    uTime: { value: 0.0 },
    uAmp: { value: 2.6 },
    uFreq: { value: 0.035 },
    uSpeed: { value: 0.05 },
    uColorA: { value: new THREE.Color("#34213a") }, // 저지대
    uColorB: { value: new THREE.Color("#bba7d9") }, // 고지대
    uLightDir: { value: new THREE.Vector3(0.3, 0.8, 0.45).normalize() },

    // 커스텀 안개(Three 표준 fog 아님)
    uFogColor: { value: new THREE.Color("#0b0e13") },
    uFogNear: { value: 120.0 },
    uFogFar: { value: 280.0 },
  };

  material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    fog: false, // 🔴 Three 표준 안개 비활성화 (커스텀 안개만 사용)
    lights: false,
    wireframe: false,
  });

  const mesh = new THREE.Mesh(geo, material);
  terrainRoot.add(mesh);
}

export function updateTerrain(t) {
  if (!uniforms) return;
  uniforms.uTime.value = t;
}

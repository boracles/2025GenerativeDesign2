import * as THREE from "three";

// GLSL 파일을 브라우저에서 직접 불러오기 (번들러 없음)
const vertSrc = await (
  await fetch("./src/shaders/terrain.vert.glsl", { cache: "no-store" })
).text();
const fragSrc = await (
  await fetch("./src/shaders/terrain.frag.glsl", { cache: "no-store" })
).text();

// 지형용 PlaneGeometry: XZ 평면으로 눕히기
const size = 200;
const segs = 256;
const geometry = new THREE.PlaneGeometry(size, size, segs, segs);
geometry.rotateX(-Math.PI / 2);

// 유니폼 (요청: uTime, uAmp, uFreq 등)
export const tickUniforms = {
  uTime: { value: 0 },
  uAmp: { value: 3.0 }, // 변위 진폭
  uFreq: { value: 0.02 }, // 노이즈 주파수 (낮을수록 완만)
  uTintA: { value: new THREE.Color(0x265d74) }, // 보라계열 저지대
  uTintB: { value: new THREE.Color(0x407e88) }, // 보라계열 중간
  uTintC: { value: new THREE.Color(0xd17a8e) }, // 보라계열 고지대 하이라이트
};

// ShaderMaterial (fog: false 고정)
const material = new THREE.ShaderMaterial({
  vertexShader: vertSrc,
  fragmentShader: fragSrc,
  uniforms: tickUniforms,
  fog: false,
  wireframe: false,
});

export const terrainRoot = new THREE.Mesh(geometry, material);
terrainRoot.receiveShadow = false;
terrainRoot.castShadow = false;

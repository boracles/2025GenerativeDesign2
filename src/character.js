// src/character.js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ----- Export: 즉시 사용 가능한 placeholder -----
export const characterRoot = new THREE.Group();
characterRoot.name = "CharacterRoot";
characterRoot.position.set(0, 5, 0); // 지형 위로 살짝 띄운 임시 위치

// ----- 경로 -----
const MODEL_URL = "./assets/models/creature.glb";
const RD_URL = "./assets/textures/rd_pattern.png";

// ----- 스케일 기준(모델의 월드 높이를 이 값으로 보정) -----
const TARGET_HEIGHT = 1.0; // 필요 시 0.5~2.0 등으로 조정

// ----- RD 텍스처 로딩 -----
const textureLoader = new THREE.TextureLoader();
const rdTexture = textureLoader.load(
  RD_URL,
  (tex) => {
    // three r160: colorSpace API
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
  },
  undefined,
  (err) => {
    console.error("[character] RD texture load failed:", RD_URL, err);
  }
);

// ----- GLB 로딩 -----
const loader = new GLTFLoader();

loader.load(
  MODEL_URL,
  (gltf) => {
    try {
      const model = gltf.scene || gltf.scenes[0];
      model.updateMatrixWorld(true);
      model.position.set(0, 0, 0); // ✅ GLB 내부 오프셋 제거
      model.rotation.set(0, 0, 0);

      // 1) 바운딩 박스 → 스케일 보정
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const currentHeight = size.y > 0 ? size.y : 1.0;
      const scale = TARGET_HEIGHT / currentHeight;
      model.scale.setScalar(scale);

      // 스케일 반영 후 다시 계산
      model.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(model);
      const min2 = box2.min.clone();
      // 2) 피벗 정렬: 발바닥이 y=0에 오도록
      model.position.y -= min2.y;

      // 3) RD 머티리얼 적용
      applyRDMaterial(model, rdTexture);

      characterRoot.add(model);
      console.log(
        "[character] loaded:",
        MODEL_URL,
        "scaled to height:",
        TARGET_HEIGHT
      );
    } catch (e) {
      console.error("[character] post-load process error:", e);
    }
  },
  undefined,
  (err) => {
    console.error("[character] GLB load failed:", MODEL_URL, err);
  }
);

function applyRDMaterial(root, tex) {
  // glTF 메시와 정합: 커스텀 텍스처는 뒤집힘 방지
  tex.flipY = false; // ✅ glTF와 호환
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);

  root.traverse((obj) => {
    if (!obj.isMesh) return;

    const geom = obj.geometry;
    if (!geom || !geom.getAttribute) return;

    if (!geom.getAttribute("uv")) {
      console.warn(
        `[character] UV missing on mesh "${
          obj.name || "(unnamed)"
        }" — RD map skipped.`
      );
      return;
    }

    const oldMat = obj.material;

    // three r160+: skinning/morphTargets/morphNormals은 더 이상 머티리얼 속성이 아님 (자동 인식)
    const hasVertexColors = !!geom.getAttribute("color");

    const newMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.8,
      metalness: 0.1,
      vertexColors: hasVertexColors,
      // transparent: true, opacity: 0.85, roughness: 0.2  // ← 젤리 느낌 원할 때
    });

    obj.material = newMat;
    obj.material.needsUpdate = true;

    // 메모리 정리
    try {
      if (Array.isArray(oldMat)) oldMat.forEach((m) => m?.dispose?.());
      else oldMat?.dispose?.();
    } catch {}
  });
}

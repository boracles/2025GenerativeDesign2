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

// ----- RD 머티리얼 적용 유틸 -----
function applyRDMaterial(root, tex) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;

    const geom = obj.geometry;
    if (!geom || !geom.getAttribute) return;

    // UV 없으면 경고만 출력하고 기존 머티리얼 유지
    if (!geom.getAttribute("uv")) {
      console.warn(
        `[character] UV missing on mesh "${
          obj.name || "(unnamed)"
        }" — RD map skipped.`
      );
      return;
    }

    // 기존 재질 정리(메모리 관리)
    const oldMat = obj.material;

    // GLB 원본 특성 유지 플래그
    const hasVertexColors = !!geom.getAttribute("color");
    const isSkinned = obj.isSkinnedMesh === true;
    const hasMorphTargets =
      !!obj.morphTargetInfluences ||
      (geom.morphAttributes &&
        (geom.morphAttributes.position || geom.morphAttributes.normal));
    const hasMorphNormals = !!(
      geom.morphAttributes && geom.morphAttributes.normal
    );

    const newMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.8,
      metalness: 0.1,
      skinning: isSkinned,
      morphTargets: !!hasMorphTargets,
      morphNormals: !!hasMorphNormals,
      vertexColors: hasVertexColors,
      // 투명 젤리 느낌 원하면:
      // transparent: true,
      // opacity: 0.8,
    });

    obj.material = newMat;
    obj.material.needsUpdate = true;

    // 배열/단일 모두 안전 제거 시도
    try {
      if (Array.isArray(oldMat))
        oldMat.forEach((m) => m && m.dispose && m.dispose());
      else oldMat && oldMat.dispose && oldMat.dispose();
    } catch (_) {
      /* noop */
    }
  });
}

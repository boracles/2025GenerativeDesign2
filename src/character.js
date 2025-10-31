import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// 즉시 사용할 수 있는 placeholder 그룹을 export
export const characterRoot = new THREE.Group();
characterRoot.name = "CharacterRoot";
characterRoot.position.set(0, 5, 0); // 지형 위로 살짝 띄운 임시 위치

// 옵션: 로더와 드라코(필요 시)
// const draco = new DRACOLoader(); draco.setDecoderPath('...');

const loader = new GLTFLoader();
// loader.setDRACOLoader(draco);

// GLB 경로 (요청사항에 맞춰 creature.glb 사용)
const MODEL_URL = "./assets/models/creature.glb";

// 목표 캐릭터 키(월드 y-높이). 언덕 높이(~uAmp 3.0)의 ~1/10을 가정해 0.3~0.5 권장.
// GLB 원본 스케일이 들쭉날쭉할 수 있으니, 자동으로 맞춰줌.
const TARGET_HEIGHT = 0.4;

loader.load(
  MODEL_URL,
  (gltf) => {
    try {
      const model = gltf.scene || gltf.scenes[0];
      model.updateMatrixWorld(true);

      // 바운딩 박스로 크기/위치 추출
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      // 1) 스케일: 현재 모델 높이를 TARGET_HEIGHT로 맞춤
      const currentHeight = size.y > 0 ? size.y : 1.0;
      const scale = TARGET_HEIGHT / currentHeight;
      model.scale.setScalar(scale);

      // 스케일 반영 후 다시 측정
      model.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(model);
      const min2 = box2.min.clone();
      const center2 = box2.getCenter(new THREE.Vector3());

      // 2) 피벗 정렬: 발바닥이 y=0에 오도록 이동
      //   - 현재 최소 y값이 min2.y 이므로, 전체를 -min2.y 만큼 올림
      model.position.y -= min2.y;

      // 선택: 중앙 정렬(원점과 수평 중심 맞추고 싶다면 주석 해제)
      // model.position.x -= center2.x;
      // model.position.z -= center2.z;

      // 머티리얼 투명 젤리 느낌으로 바꾸고 싶으면 아래 참고 (원본 유지가 기본)
      // model.traverse((obj) => {
      //   if (obj.isMesh) {
      //     obj.material.transparent = true;
      //     obj.material.opacity = 0.75;
      //     obj.material.metalness = 0.0;
      //     obj.material.roughness = 0.2;
      //   }
      // });

      characterRoot.add(model);
      console.log("[character] loaded:", MODEL_URL, "height→", TARGET_HEIGHT);
    } catch (e) {
      console.error("[character] post-load process error:", e);
    }
  },
  (evt) => {
    // 진행률 로그 (필요시)
    if (evt.total) {
      const p = ((evt.loaded / evt.total) * 100).toFixed(1);
      // console.log(`[character] loading ${p}%`);
    }
  },
  (err) => {
    console.error("[character] GLB load failed:", MODEL_URL, err);
  }
);

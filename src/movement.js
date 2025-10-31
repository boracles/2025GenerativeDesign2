// 클릭으로 타겟 지정, 캐릭터를 부드럽게 이동 & 지형 높이에 안착
import * as THREE from "three";

let _camera, _renderer, _terrain, _character;
let _raycaster, _mouseNdc, _target, _hasTarget, _debugMarker;
let _downRay, _tmpV3a, _tmpV3b, _tmpQuat, _slopeQuat;
let _speed = 16; // 이동 속도 (유닛/초)
let _arriveEps = 0.1; // 도착 판정
let _heightOffset = 0.5; // 지면 위 떠 있는 높이
let _slopeAlign = 0.35; // 경사 보정 강도 0~1 (0 = 수직 고정, 1 = 노멀 완전 정렬)

export function initMovement({ camera, renderer, terrainRoot, characterRoot }) {
  _camera = camera;
  _renderer = renderer;
  _terrain = terrainRoot;
  _character = characterRoot;
  _renderer.domElement.style.touchAction = "none";
  _renderer.domElement.style.userSelect = "none";

  _raycaster = new THREE.Raycaster();
  _mouseNdc = new THREE.Vector2();
  _target = new THREE.Vector3();
  _hasTarget = false;

  _downRay = new THREE.Raycaster();
  _downRay.far = 1000;

  _tmpV3a = new THREE.Vector3();
  _tmpV3b = new THREE.Vector3();
  _tmpQuat = new THREE.Quaternion();
  _slopeQuat = new THREE.Quaternion();

  _renderer.domElement.addEventListener("pointerdown", onPointerDown, {
    passive: false,
  });

  // 이동 대상 노드의 행렬 자동 갱신을 보장
  _character.matrixAutoUpdate = true;
  // 혹시 상위에서 끈 경우를 대비해 씬 갱신 트리거
  _character.updateMatrixWorld(true);

  console.log("[movement] _character.uuid =", _character.uuid);

  // 🔎 디버그 타깃 마커
  const g = new THREE.SphereGeometry(0.25, 16, 12);
  const m = new THREE.MeshBasicMaterial({ color: 0x44ff88 });
  _debugMarker = new THREE.Mesh(g, m);
  _debugMarker.visible = false;
  // 씬에 직접 접근이 없으니, 캐릭터의 부모(있는 경우) 아니면 캐릭터에 얹음
  (_character.parent || _character).add(_debugMarker);
}

function onPointerDown(ev) {
  console.log("[pointerdown]", ev.clientX, ev.clientY);

  if (ev.isPrimary === false) return;
  ev.preventDefault();
  ev.stopPropagation();

  const rect = _renderer.domElement.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  _mouseNdc.set(x, y);

  _camera.updateMatrixWorld(true);
  _raycaster.setFromCamera(_mouseNdc, _camera);

  // 1차: 지형 우선
  let hitPoint = null;
  const hitsTerrain = _raycaster.intersectObject(_terrain, true);
  if (hitsTerrain.length > 0) {
    hitPoint = hitsTerrain[0].point.clone();
  }
  // 2차: 씬 전체로 보강(지형이 그룹/셰이더 변위 등으로 안 맞을 때)
  if (!hitPoint) {
    // 카메라나 캐릭터 자신 같은 건 제외하고 가장 가까운 바닥성 히트 선택
    const hitsAll = _raycaster
      .intersectObjects(
        (_character.parent || _character).parent?.children || [],
        true
      )
      .filter((h) => h.object !== _character && h.object.parent !== _character);
    if (hitsAll.length > 0) {
      hitPoint = hitsAll[0].point.clone();
    }
  }
  // 3차: 완전 폴백 — y=0 평면
  if (!hitPoint) {
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = _raycaster.ray;
    const tmp = new THREE.Vector3();
    if (ray.intersectPlane(groundPlane, tmp)) {
      hitPoint = tmp.clone();
    }
  }

  if (hitPoint) {
    console.log("[terrain hit]", hitPoint);
    _target.copy(hitPoint);
    _target.y += _heightOffset;
    _hasTarget = true;

    // 디버그 표시
    _debugMarker.position.copy(_target);
    _debugMarker.visible = true;
  } else {
    console.log("[terrain miss]");
  }
}

/**
 * 매 프레임 호출: 이동/안착/회전
 * @param {number} dt - 경과 시간(초)
 */
export function updateMovement(dt) {
  if (!(dt > 0)) dt = 1 / 60;
  if (!_character || !_terrain) return;

  // 현재 위치 (캐릭터 그룹의 월드 좌표)
  const pos = _character.position;

  // 1) 목표가 있으면 XZ 방향으로 이동
  if (_hasTarget) {
    console.log(
      "[move] posXZ=",
      _character.position.x.toFixed(2),
      _character.position.z.toFixed(2),
      "→ tgtXZ=",
      _target.x.toFixed(2),
      _target.z.toFixed(2)
    );

    // XZ 평면 거리
    _tmpV3a.set(_target.x - pos.x, 0, _target.z - pos.z);
    const distXZ = _tmpV3a.length();

    if (distXZ > _arriveEps) {
      // 정규화 → 속도 적용
      _tmpV3a.normalize().multiplyScalar(_speed * dt);

      // 오버슈트 방지
      if (_tmpV3a.length() > distXZ) {
        _tmpV3a.setLength(distXZ);
      }

      // 위치 갱신(XZ만) — set으로 직접 기록 + 강제 갱신
      _character.position.set(pos.x + _tmpV3a.x, pos.y, pos.z + _tmpV3a.z);
      _character.matrixAutoUpdate = true;
      _character.matrixWorldNeedsUpdate = true;
      _character.updateMatrix();
      _character.updateMatrixWorld(true);

      _target.x = _target.x;
      _target.z = _target.z;

      // 진행 방향 바라보기 (y축 회전)
      if (_tmpV3a.lengthSq() > 1e-6) {
        const heading = Math.atan2(_tmpV3a.x, _tmpV3a.z); // +Z 기준
        // y 회전만 보정: 부드럽게 보간
        const current = _character.quaternion.clone();
        const targetQ = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          heading
        );
        _character.quaternion.slerpQuaternions(
          current,
          targetQ,
          Math.min(1, dt * 6)
        );
      }
    } else {
      // 도착
      _hasTarget = false;
    }
  }

  // 2) 항상 아래로 레이캐스트해 지면 높이에 안착
  //   캐릭터 머리 위쪽에서 아래로 쏘면 안정적
  _tmpV3b.set(pos.x, pos.y + 50, pos.z);
  _downRay.set(_tmpV3b, new THREE.Vector3(0, -1, 0));
  const groundHits = _downRay.intersectObject(_terrain, true);

  if (groundHits.length > 0) {
    const g = groundHits[0];
    const groundY = g.point.y;
    const groundN = g.face ? g.face.normal.clone() : new THREE.Vector3(0, 1, 0);

    // 지오메트리의 로컬 노멀을 월드로 변환
    if (g.object) {
      g.object.updateMatrixWorld(true);
      groundN.transformDirection(g.object.matrixWorld);
    }

    // y 좌표: 지면 + 오프셋
    pos.y = groundY + _heightOffset;

    // ✅ Y 안착 직후 행렬 갱신
    _character.updateMatrix();
    _character.updateMatrixWorld(true);

    // 3) 경사면 보정(선택): 캐릭터 up을 지면 노멀과 일부 맞추기
    if (_slopeAlign > 0) {
      // y축 회전(방향)을 유지한 채, up을 노멀 쪽으로 기울이기
      // 방법: 현재 forward를 유지하고 up을 노멀로 한 lookAt 쿼터니언을 만들고 블렌드
      const forward = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(_character.quaternion)
        .normalize();
      // 목표 기준 프레임 구성: pos에서 forward 방향을 보고, up=groundN
      const targetM = new THREE.Matrix4().lookAt(
        new THREE.Vector3(0, 0, 0),
        forward, // 바라보는 방향 유지
        groundN // 업 벡터를 노멀로
      );
      _slopeQuat.setFromRotationMatrix(targetM);
      // 현재 회전과 블렌드
      _character.quaternion.slerp(
        _slopeQuat,
        _slopeAlign * Math.min(1, dt * 6)
      );
    }
  }
}

/** 필요 시 외부에서 파라미터 튜닝 */
export function setMovementParams({ speed, heightOffset, slopeAlign } = {}) {
  if (typeof speed === "number") _speed = speed;
  if (typeof heightOffset === "number") _heightOffset = heightOffset;
  if (typeof slopeAlign === "number")
    _slopeAlign = THREE.MathUtils.clamp(slopeAlign, 0, 1);
}

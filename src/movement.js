// 클릭으로 타겟 지정, 캐릭터를 부드럽게 이동 & 지형 높이에 안착
import * as THREE from "three";

let _camera, _renderer, _terrain, _character;
let _raycaster, _mouseNdc, _target, _hasTarget, _debugMarker;
let _downRay,
  _tmpV3a,
  _tmpV3b,
  _tmpQuat,
  _slopeQuat,
  _groundRadius = 0.6,
  _groundRadiusMul = 1.25,
  _footClearance = 0;
let _lastSafeY = 0; // 마지막 안전 y
let _terrainAABBWorld = null;
let _clampMargin = 0;
let _heightSampler = null; // (x,z) => height
let _speed = 16; // 이동 속도 (유닛/초)
let _arriveEps = 0.1; // 도착 판정
let _heightOffset = 0; // 지면 위 떠 있는 높이
let _slopeAlign = 0.35; // 경사 보정 강도 0~1 (0 = 수직 고정, 1 = 노멀 완전 정렬)

export function setTerrainHeightSampler(fn) {
  _heightSampler = typeof fn === "function" ? fn : null;
}

export function initMovement({ camera, renderer, terrainRoot, characterRoot }) {
  _camera = camera;
  _renderer = renderer;
  _terrain = terrainRoot;
  _character = characterRoot;

  // 캐릭터가 저장해둔 접지 반경 가져오기 (없으면 기본값)
  _groundRadius =
    _character?.userData?.groundRadius ??
    _character?.children?.[0]?.userData?.groundRadius ??
    0.6;

  _footClearance =
    _character?.userData?.footClearance ??
    _character?.children?.[0]?.userData?.footClearance ??
    0;

  // ✅ 루트/부모 스케일까지 반영 (루트에 setScalar(5) 등 적용된 경우)
  const _ws = new THREE.Vector3();
  _character.getWorldScale(_ws);
  _groundRadius *= Math.max(_ws.x, _ws.z);
  _footClearance *= _ws.y;
  _groundRadius *= _groundRadiusMul;
  _clampMargin = _groundRadius;

  // ✅ 지형 월드 AABB 계산 (변위(uAmp)만큼 y 여유)
  terrainRoot.updateMatrixWorld(true);
  const geo = _terrain.geometry;
  if (geo && !geo.boundingBox) geo.computeBoundingBox();
  if (geo && geo.boundingBox) {
    const bb = geo.boundingBox.clone(); // 로컬 AABB
    const uAmp = terrainRoot.material?.uniforms?.uAmp?.value ?? 0;
    bb.min.y -= uAmp; // 변위 여유
    bb.max.y += uAmp;
    // 월드로 변환
    _terrainAABBWorld = new THREE.Box3();
    _terrainAABBWorld.min.copy(bb.min);
    _terrainAABBWorld.max.copy(bb.max);
    _terrain.updateMatrixWorld(true);
    _terrainAABBWorld.applyMatrix4(_terrain.matrixWorld);
  }

  // 첫 안전 y 초기화
  _lastSafeY = _character.position.y;

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

export function recalcCharacterFootprint() {
  if (!_character) return;

  // GLB 로딩 후 userData 값 반영
  let gr =
    _character?.userData?.groundRadius ??
    _character?.children?.[0]?.userData?.groundRadius ??
    _groundRadius;

  let fc =
    _character?.userData?.footClearance ??
    _character?.children?.[0]?.userData?.footClearance ??
    _footClearance;

  // 월드 스케일까지 반영
  const ws = new THREE.Vector3();
  _character.getWorldScale(ws);
  _groundRadius = (gr ?? 0.6) * Math.max(ws.x, ws.z) * _groundRadiusMul;
  _footClearance = (fc ?? 0) * ws.y;

  _clampMargin = _groundRadius;
}

// 현재 (x,z) 지점의 높이 경사(gradient) 크기 추정
function sampleGradient(x, z) {
  if (!_heightSampler) return 0;
  const d = Math.max(0.05, _groundRadius * 0.2); // 미소 거리
  const hx1 = _heightSampler(x + d, z),
    hx2 = _heightSampler(x - d, z);
  const hz1 = _heightSampler(x, z + d),
    hz2 = _heightSampler(x, z - d);
  const gx =
    Number.isFinite(hx1) && Number.isFinite(hx2) ? (hx1 - hx2) / (2 * d) : 0;
  const gz =
    Number.isFinite(hz1) && Number.isFinite(hz2) ? (hz1 - hz2) / (2 * d) : 0;
  return Math.hypot(gx, gz);
}

// 중앙+4방향 샘플링으로 '가장 높은' 지면 y를 반환 (경사/능선에서 박힘 방지)
function sampleSurfaceMaxY(x, z) {
  if (!_heightSampler) return null;

  // 지형 바운드 밖이면 null 리턴 → 상위에서 폴백 처리
  if (_terrainAABBWorld) {
    if (
      x < _terrainAABBWorld.min.x ||
      x > _terrainAABBWorld.max.x ||
      z < _terrainAABBWorld.min.z ||
      z > _terrainAABBWorld.max.z
    ) {
      return null;
    }
  }

  // 1) 중앙 높이 & 경사 추정(중앙차분)
  let maxY = _heightSampler(x, z);
  const d = Math.max(0.05, _groundRadius * 0.2);
  const hx1 = _heightSampler(x + d, z),
    hx2 = _heightSampler(x - d, z);
  const hz1 = _heightSampler(x, z + d),
    hz2 = _heightSampler(x, z - d);
  const gx =
    Number.isFinite(hx1) && Number.isFinite(hx2) ? (hx1 - hx2) / (2 * d) : 0;
  const gz =
    Number.isFinite(hz1) && Number.isFinite(hz2) ? (hz1 - hz2) / (2 * d) : 0;
  const grad = Math.hypot(gx, gz); // 경사 크기

  // 2) 경사 기반 가변 반경 (경사가 클수록 footprint 확장)
  const kSlope = 0.7; // 가중치
  const rBase = _groundRadius * (1 + kSlope * Math.min(1.5, grad));
  const radii = [rBase * 0.7, rBase, rBase * 1.35];

  // 3) 24방향 × 3링 샘플
  const N = 24;
  for (let ri = 0; ri < radii.length; ri++) {
    const r = radii[ri];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      const yv = _heightSampler(sx, sz);
      if (Number.isFinite(yv)) maxY = Math.max(maxY, yv);
    }
  }
  return maxY;
}

// 하드 바닥: 아래로는 즉시 끌어올리고, 위로 내려올 때만 부드럽게
function snapYHardFloor(currentY, targetY, dt) {
  if (!Number.isFinite(targetY)) return currentY;
  const eps = Math.max(1e-3, 0.002 * _footClearance); // 발밑이 클수록 여유도 약간↑
  if (currentY <= targetY) return targetY + eps; // 절대 아래로 못가게 살짝 위로
  return currentY + (targetY - currentY) * Math.min(1, dt * 12);
}

// 지형 AABB(월드) 안으로 XZ를 클램프
function clampXZToTerrain(x, z, margin = 0) {
  if (!_terrainAABBWorld) return { x, z };
  const minX = _terrainAABBWorld.min.x + margin;
  const maxX = _terrainAABBWorld.max.x - margin;
  const minZ = _terrainAABBWorld.min.z + margin;
  const maxZ = _terrainAABBWorld.max.z - margin;
  return {
    x: Math.min(Math.max(x, minX), maxX),
    z: Math.min(Math.max(z, minZ), maxZ),
  };
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

    _target.set(hitPoint.x, hitPoint.y, hitPoint.z);
    if (_heightSampler) {
      const surfaceY = sampleSurfaceMaxY(hitPoint.x, hitPoint.z);
      if (Number.isFinite(surfaceY))
        _target.y = surfaceY + _footClearance + _heightOffset;
    } else {
      _target.y += _heightOffset; // 폴백
    }

    // ✅ AABB 안으로 XZ 클램프
    const clamped = clampXZToTerrain(_target.x, _target.z, _clampMargin);
    _target.x = clamped.x;
    _target.z = clamped.z;

    // 클램프된 XZ 기준으로 y 재계산
    if (_heightSampler) {
      const surfaceY2 = sampleSurfaceMaxY(_target.x, _target.z);
      if (Number.isFinite(surfaceY2)) {
        const grad = sampleGradient(_target.x, _target.z);
        // 정확식: r * grad / sqrt(1 + grad^2), 안전계수 1.1
        const tiltClearance =
          1.1 * _groundRadius * (grad / Math.sqrt(1 + grad * grad));

        _target.y = surfaceY2 + _footClearance + tiltClearance + _heightOffset;
      }
    }

    _hasTarget = true;

    // ✅ 최종 안전검사: 한 번 더 샘플해서 아래면 즉시 끌어올림
    const h2 = sampleSurfaceMaxY(_character.position.x, _character.position.z);
    if (Number.isFinite(h2)) {
      const grad2 = sampleGradient(
        _character.position.x,
        _character.position.z
      );
      const kTilt = 0.6;
      const tilt2 = grad2 * _groundRadius * kTilt;
      const minAllowed = h2 + _footClearance + tilt2 + _heightOffset + 1e-3;

      if (_character.position.y < minAllowed) {
        _character.position.y = minAllowed;
        _character.updateMatrixWorld(true);
      }
    }

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
      let nx = pos.x + _tmpV3a.x;
      let nz = pos.z + _tmpV3a.z;
      const cl = clampXZToTerrain(nx, nz, _clampMargin);
      _character.position.set(cl.x, pos.y, cl.z);

      _character.matrixAutoUpdate = true;
      _character.matrixWorldNeedsUpdate = true;
      _character.updateMatrix();
      _character.updateMatrixWorld(true);

      const tl = clampXZToTerrain(_target.x, _target.z, _clampMargin);
      _target.x = tl.x;
      _target.z = tl.z;

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

  // 2) 지형 높이 안착 — 우선 CPU 샘플러 사용, 실패 시 레이캐스트 폴백
  let didSnap = false;
  if (_heightSampler) {
    const h = sampleSurfaceMaxY(_character.position.x, _character.position.z);
    if (Number.isFinite(h)) {
      const grad = sampleGradient(_character.position.x, _character.position.z);
      const tiltClearance =
        1.1 * _groundRadius * (grad / Math.sqrt(1 + grad * grad));

      const targetY = h + _footClearance + tiltClearance + _heightOffset;

      const newY = snapYHardFloor(_character.position.y, targetY, dt);
      _character.position.y = newY;
      _character.updateMatrixWorld(true);
      didSnap = true;

      // ✅ 최종 안전검사: 2회 반복으로 예외적 뾰족 능선도 확실히 클램프
      for (let iter = 0; iter < 2; iter++) {
        const hh = sampleSurfaceMaxY(
          _character.position.x,
          _character.position.z
        );
        if (Number.isFinite(hh)) {
          const gradH = sampleGradient(
            _character.position.x,
            _character.position.z
          );
          const tiltH =
            1.1 * _groundRadius * (gradH / Math.sqrt(1 + gradH * gradH));
          const minAllowed = hh + _footClearance + tiltH + _heightOffset + 1e-3;
          if (_character.position.y < minAllowed) {
            _character.position.y = minAllowed;
            _character.updateMatrixWorld(true);
          }
        }
      }
      _lastSafeY = _character.position.y; // 안전 y 갱신
    } else {
      // ⛑ 바운드 밖: 마지막 안전 y로 고정 (또는 y=0 평면 등)
      _character.position.y = _lastSafeY;
      _character.updateMatrixWorld(true);
    }
  }

  if (!didSnap) {
    // 폴백: 아래로 레이캐스트(변위 전 지오메트리 기준)
    _tmpV3b.set(
      _character.position.x,
      _character.position.y + 50,
      _character.position.z
    );
    _downRay.set(_tmpV3b, new THREE.Vector3(0, -1, 0));
    const groundHits = _downRay.intersectObject(_terrain, true);
    if (groundHits.length > 0) {
      const g = groundHits[0];
      const groundY = g.point.y;
      _character.position.y = groundY + _footClearance + _heightOffset;
      _character.updateMatrixWorld(true);
    }
  }

  // 🔧 GLB 루트가 따로 렌더 기준이면 루트-자식 위치 동기화
  if (_character.children && _character.children.length > 0) {
    const childRoot = _character.children[0];
    if (childRoot && childRoot.isObject3D) {
      // 자식은 로컬 원점 유지 (대부분의 경우가 이게 맞음)
      childRoot.position.set(0, 0, 0);
      childRoot.updateMatrixWorld(true);
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

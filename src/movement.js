// src/movement.js
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
let _heightSampler = null; // (x,z) => height(nav)
let _speed = 2; // 이동 속도 (유닛/초)
let _arriveEps = 0.1; // 도착 판정
let _heightOffset = 0; // 지면 위 떠 있는 높이
let _slopeAlign = 0.35; // (지금은 회전에는 안 씀)

let _rootScene = null;
let _obstacles = []; // userData.isObstacle 객체들

export function setTerrainHeightSampler(fn) {
  _heightSampler = typeof fn === "function" ? fn : null;
}

export function initMovement({ camera, renderer, terrainRoot, characterRoot }) {
  _camera = camera;
  _renderer = renderer;
  _terrain = terrainRoot;
  _character = characterRoot;

  // 씬 루트 추적 (terrain이나 character의 parent를 씬으로 가정)
  _rootScene = terrainRoot.parent || _character.parent || null;

  // 캐릭터가 저장해둔 접지 반경 가져오기 (없으면 기본값)
  _groundRadius =
    _character?.userData?.groundRadius ??
    _character?.children?.[0]?.userData?.groundRadius ??
    0.6;

  _footClearance =
    _character?.userData?.footClearance ??
    _character?.children?.[0]?.userData?.footClearance ??
    0;

  // 루트/부모 스케일까지 반영
  const _ws = new THREE.Vector3();
  _character.getWorldScale(_ws);
  _groundRadius *= Math.max(_ws.x, _ws.z);
  _footClearance *= _ws.y;
  _groundRadius *= _groundRadiusMul;
  _clampMargin = _groundRadius;

  // 지형 월드 AABB 계산
  terrainRoot.updateMatrixWorld(true);
  const geo = _terrain.geometry;
  if (geo && !geo.boundingBox) geo.computeBoundingBox();
  if (geo && geo.boundingBox) {
    const bb = geo.boundingBox.clone(); // 로컬 AABB
    const uAmp = terrainRoot.material?.uniforms?.uAmp?.value ?? 0;
    bb.min.y -= uAmp;
    bb.max.y += uAmp;
    _terrainAABBWorld = new THREE.Box3();
    _terrainAABBWorld.min.copy(bb.min);
    _terrainAABBWorld.max.copy(bb.max);
    _terrain.updateMatrixWorld(true);
    _terrainAABBWorld.applyMatrix4(_terrain.matrixWorld);
  }

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

  _character.matrixAutoUpdate = true;
  _character.updateMatrixWorld(true);

  console.log("[movement] _character.uuid =", _character.uuid);

  // 디버그 타깃 마커
  const g = new THREE.SphereGeometry(0.25, 16, 12);
  const m = new THREE.MeshBasicMaterial({ color: 0x44ff88 });
  _debugMarker = new THREE.Mesh(g, m);
  _debugMarker.visible = false;
  (_character.parent || _character).add(_debugMarker);
}

export function recalcCharacterFootprint() {
  if (!_character) return;

  let gr =
    _character?.userData?.groundRadius ??
    _character?.children?.[0]?.userData?.groundRadius ??
    _groundRadius;

  let fc =
    _character?.userData?.footClearance ??
    _character?.children?.[0]?.userData?.footClearance ??
    _footClearance;

  const ws = new THREE.Vector3();
  _character.getWorldScale(ws);
  _groundRadius = (gr ?? 0.6) * Math.max(ws.x, ws.z) * _groundRadiusMul;
  _footClearance = (fc ?? 0) * ws.y;

  _clampMargin = _groundRadius;
}

// ----- 장애물 스캔 & 충돌 푸시 -----
function refreshObstacles() {
  if (!_rootScene) return;
  _obstacles.length = 0;

  _rootScene.traverse((obj) => {
    if (obj.userData && obj.userData.isObstacle) {
      _obstacles.push(obj);
    }
  });
}

// 캐릭터를 장애물 밖으로 수평 밀어내기
function pushOutFromObstacles(pos) {
  if (!_obstacles || _obstacles.length === 0) return;

  const cr = _groundRadius; // 캐릭터 반경

  for (const obj of _obstacles) {
    const p = obj.position; // 월드 좌표
    const r = (obj.userData.collisionRadius || 1.0) + cr * 0.6;

    const dx = pos.x - p.x;
    const dz = pos.z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = r - d + 1e-3;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
  }
}

// 중앙+4방향 높이 샘플 → 가장 높은 지점 반환 (수면+언덕 포함)
function sampleSurfaceMaxY(x, z) {
  if (!_heightSampler) return null;

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

  let maxY = _heightSampler(x, z);
  const d = Math.max(0.05, _groundRadius * 0.2);

  const hx1 = _heightSampler(x + d, z),
    hx2 = _heightSampler(x - d, z);
  const hz1 = _heightSampler(x, z + d),
    hz2 = _heightSampler(x, z - d);

  if (Number.isFinite(hx1)) maxY = Math.max(maxY, hx1);
  if (Number.isFinite(hx2)) maxY = Math.max(maxY, hx2);
  if (Number.isFinite(hz1)) maxY = Math.max(maxY, hz1);
  if (Number.isFinite(hz2)) maxY = Math.max(maxY, hz2);

  return maxY;
}

function snapYHardFloor(currentY, targetY, dt) {
  if (!Number.isFinite(targetY)) return currentY;
  const eps = Math.max(1e-3, 0.002 * _footClearance);
  if (currentY <= targetY) return targetY + eps;
  return currentY + (targetY - currentY) * Math.min(1, dt * 12);
}

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

  let hitPoint = null;
  const hitsTerrain = _raycaster.intersectObject(_terrain, true);
  if (hitsTerrain.length > 0) {
    hitPoint = hitsTerrain[0].point.clone();
  }

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
      _target.y += _heightOffset;
    }

    const clamped = clampXZToTerrain(_target.x, _target.z, _clampMargin);
    _target.x = clamped.x;
    _target.z = clamped.z;

    _hasTarget = true;

    _debugMarker.position.copy(_target);
    _debugMarker.visible = true;
  } else {
    console.log("[terrain miss]");
  }
}

export function updateMovement(dt) {
  if (!(dt > 0)) dt = 1 / 60;
  if (!_character || !_terrain) return;

  // 매 프레임 장애물 수집 (식물/boids)
  if (_rootScene) {
    refreshObstacles();
  }

  const pos = _character.position;

  // 1) 목표가 있으면 XZ 방향으로 이동
  if (_hasTarget) {
    _tmpV3a.set(_target.x - pos.x, 0, _target.z - pos.z);
    const distXZ = _tmpV3a.length();

    if (distXZ > _arriveEps) {
      _tmpV3a.normalize().multiplyScalar(_speed * dt);
      if (_tmpV3a.length() > distXZ) {
        _tmpV3a.setLength(distXZ);
      }

      let nx = pos.x + _tmpV3a.x;
      let nz = pos.z + _tmpV3a.z;

      // 월드 AABB 안으로 클램프
      const cl = clampXZToTerrain(nx, nz, _clampMargin);
      _character.position.set(cl.x, pos.y, cl.z);

      // 🔹 장애물들에 겹치면 수평으로 밀어내기
      pushOutFromObstacles(_character.position);

      _character.matrixAutoUpdate = true;
      _character.matrixWorldNeedsUpdate = true;
      _character.updateMatrix();
      _character.updateMatrixWorld(true);

      // 진행 방향 바라보기 (y축 회전)
      const heading = Math.atan2(_tmpV3a.x, _tmpV3a.z);
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
    } else {
      _hasTarget = false;
    }
  }

  // 2) 표면 높이(nav surface: water or hybrid)에 안착
  let didSnap = false;
  if (_heightSampler) {
    const h = sampleSurfaceMaxY(_character.position.x, _character.position.z);
    if (Number.isFinite(h)) {
      const targetY = h + _footClearance + _heightOffset;
      const newY = snapYHardFloor(_character.position.y, targetY, dt);
      _character.position.y = newY;
      _character.updateMatrixWorld(true);
      didSnap = true;
      _lastSafeY = _character.position.y;
    } else {
      _character.position.y = _lastSafeY;
      _character.updateMatrixWorld(true);
    }
  }

  // 폴백: 지형 레이캐스트
  if (!didSnap) {
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

  // GLB 루트-자식 위치 동기화
  if (_character.children && _character.children.length > 0) {
    const childRoot = _character.children[0];
    if (childRoot && childRoot.isObject3D) {
      childRoot.position.set(0, 0, 0);
      childRoot.updateMatrixWorld(true);
    }
  }
}

export function setMovementParams({ speed, heightOffset, slopeAlign } = {}) {
  if (typeof speed === "number") _speed = speed;
  if (typeof heightOffset === "number") _heightOffset = heightOffset;
  if (typeof slopeAlign === "number")
    _slopeAlign = THREE.MathUtils.clamp(slopeAlign, 0, 1);
}

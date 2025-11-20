import * as THREE from "three";

/* ──────────────────────────────────────────────────────────
   WeirdPlant L-System (garlic scape / 마늘쫑, 감쇠 + 가지)
   ────────────────────────────────────────────────────────── */

let _root = null;
let _t = 0;

export const api = {
  // 스케일 & 감쇠
  step: 0.42,
  radius: 0.032,
  radiusDecay: 0.86, // F마다 줄기 반경 감쇠
  stepDecay: 0.992, // F마다 길이 감쇠
  branchEnterRadiusMul: 0.85,
  branchEnterStepMul: 0.9,

  // 곡률(각도)
  arcDeg: 24,
  pitchDeg: 10,

  // 분기/봉오리
  forceBranchEveryN: 2,
  branchProb: 0.55,
  budProb: 0.24,
  budRadiusMul: 5.0, // ← 열매 반경 = 현재 줄기반경 × 이 값

  // 곡선 노이즈 & 흔들림
  jitter: 0.08,
  driftMul: 0.45,
  swayAmp: 0.1,
  swayFreq: 0.6,

  // 컬러
  colorBottom: 0xa72633,
  colorTop: 0xf23c6d,
  budColor: 0xd32f2f,

  // 전체 스케일
  plantScale: 2.8, // ← 식물 전체 크기 업
  genMax: 6,
};

const deg = (d) => THREE.MathUtils.degToRad(d);

class TurtleState {
  constructor(p, dir, right, up, step, rad, h) {
    this.p = p.clone();
    this.dir = dir.clone();
    this.right = right.clone();
    this.up = up.clone();
    this.step = step;
    this.rad = rad;
    this.h = h;
  }
}

/* ---------------- 확장 ---------------- */
function expand(axiom, iterations) {
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  let s = axiom;

  for (let i = 0; i < iterations; i++) {
    let out = "";
    for (const ch of s) {
      if (ch === "X") {
        out += pick([
          "F R F R F r F R F",
          "F r F R F r R F",
          "F R F r F R R F",
          "F R F R F r r F",
        ]);
      } else if (ch === "F") {
        out += Math.random() < 0.12 ? "FF" : "F";
      } else {
        out += ch;
      }
    }
    s = out;
  }

  // 강제/확률 사이드 브랜치 삽입
  let out2 = "";
  let fCount = 0;
  for (const ch of s) {
    out2 += ch;
    if (ch === "F") {
      fCount++;
      const forced =
        api.forceBranchEveryN > 0 && fCount % api.forceBranchEveryN === 0;
      if (forced || Math.random() < api.branchProb) {
        out2 += ` [ ${Math.random() < 0.5 ? "R" : "r"} F F B ] `;
      }
    }
  }
  return out2;
}

/* ---------------- 토터스 → 세그먼트 ---------------- */
function buildSegments(instructions) {
  const yawStep = deg(api.arcDeg);
  const pitchStep = deg(api.pitchDeg);

  const stack = [];
  const segments = []; // {start,end,r0,r1,h0,h1}
  const buds = []; // {pos, r}
  let pos = new THREE.Vector3(0, 0, 0);
  let dir = new THREE.Vector3(0, 1, 0);
  let right = new THREE.Vector3(1, 0, 0);
  let up = new THREE.Vector3(0, 0, 1);
  let step = api.step;
  let rad = api.radius;
  let hAcc = 0;

  const push = () =>
    stack.push(new TurtleState(pos, dir, right, up, step, rad, hAcc));
  const pop = () => {
    const s = stack.pop();
    if (!s) return;
    pos.copy(s.p);
    dir.copy(s.dir);
    right.copy(s.right);
    up.copy(s.up);
    step = s.step;
    rad = s.rad;
    hAcc = s.h;
  };

  const rotYaw = (a) => {
    const m = new THREE.Matrix4().makeRotationAxis(up, a);
    dir.applyMatrix4(m).normalize();
    right.applyMatrix4(m).normalize();
  };
  const rotPitch = (a) => {
    const m = new THREE.Matrix4().makeRotationAxis(right, a);
    dir.applyMatrix4(m).normalize();
    up.applyMatrix4(m).normalize();
  };

  for (const ch of instructions) {
    if (ch === "F") {
      // 다음 위치
      const len = step;
      const p1 = pos.clone().addScaledVector(dir, len);
      // 지터
      p1.addScaledVector(right, (Math.random() - 0.5) * api.jitter);
      p1.addScaledVector(up, (Math.random() - 0.5) * api.jitter);

      // 세그먼트(반경 감쇠)
      const r0 = rad;
      const r1 = r0 * api.radiusDecay;
      segments.push({
        start: pos.clone(),
        end: p1.clone(),
        r0,
        r1,
        h0: hAcc,
        h1: hAcc + len,
      });

      // 상태 갱신
      pos.copy(p1);
      hAcc += len;
      rad = r1;
      step *= api.stepDecay;

      // 연속 드리프트: 항상 한 방향으로 서서히 말리게
      const driftYaw = yawStep * api.driftMul;
      rotYaw(driftYaw);

      // 살짝 뒤로 젖혀지도록 pitch도 조금씩 누적
      const driftPitch = -pitchStep * 0.3;
      rotPitch(driftPitch);

      // 확률 봉오리: 현재 줄기 반경 기반
      if (Math.random() < api.budProb)
        buds.push({
          pos: pos.clone(),
          r: Math.max(0.006, rad * api.budRadiusMul),
        });
    } else if (ch === "R") rotYaw(yawStep);
    else if (ch === "r") rotYaw(-yawStep);
    else if (ch === "U") rotPitch(pitchStep);
    else if (ch === "D") rotPitch(-pitchStep);
    else if (ch === "[") {
      push();
      step *= api.branchEnterStepMul;
      rad *= api.branchEnterRadiusMul;
    } else if (ch === "]") pop();
    else if (ch === "B")
      buds.push({
        pos: pos.clone(),
        r: Math.max(0.006, rad * api.budRadiusMul),
      });
  }

  return { segments, buds, totalHeight: hAcc };
}

/* ---------------- 세그먼트 → 메쉬 ---------------- */
function buildMeshes({ segments, buds, totalHeight }) {
  const group = new THREE.Group();

  // 줄기: 세그먼트별 실린더
  const colA = new THREE.Color(api.colorBottom);
  const colB = new THREE.Color(api.colorTop);

  for (const s of segments) {
    const dir = new THREE.Vector3().subVectors(s.end, s.start);
    const len = dir.length();
    if (len <= 1e-5) continue;

    const g = new THREE.CylinderGeometry(
      Math.max(1e-4, s.r1),
      Math.max(1e-4, s.r0),
      len,
      14,
      1,
      false
    );

    // 그라데이션(전체 높이 기준)
    const posAttr = g.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const yLocal = posAttr.getY(i);
      const yWorld = s.h0 + (yLocal + len / 2);
      const t = THREE.MathUtils.clamp(
        yWorld / Math.max(1e-4, totalHeight),
        0,
        1
      );
      const c = colA.clone().lerp(colB, t);
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const m = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
    );
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize()
    );
    m.quaternion.copy(q);
    g.translate(0, len / 2, 0);
    m.position.copy(s.start);
    group.add(m);
  }

  // 봉오리: 줄기 반경 연동
  if (buds.length) {
    const unitGeo = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshStandardMaterial({
        color: api.budColor,
        roughness: 0.75,
      })
    );

    for (const b of buds) {
      const bm = unitGeo.clone();
      bm.position.copy(b.pos);
      bm.scale.setScalar(b.r);

      // 🔹 이 메쉬가 "봉오리"라는 것을 표시 (파티클 emitter가 이걸 찾음)
      bm.userData.isBud = true;

      group.add(bm);
    }
  }

  return group;
}

let _swayNode = null;

export function createWeirdPlantRoot(opts = {}) {
  Object.assign(api, opts);
  if (_root && _root.parent) _root.parent.remove(_root);
  _root = new THREE.Group();
  _root.name = "WeirdPlantRoot";

  const instr = expand("UXRFX", api.genMax);
  const data = buildSegments(instr);
  const plant = buildMeshes(data);

  plant.scale.setScalar(api.plantScale);

  // sway 전용 노드로 분리
  _swayNode = new THREE.Group();
  _swayNode.add(plant);
  _root.add(_swayNode);

  _root.rotation.y = Math.random() * Math.PI * 2;
  return _root;
}

export function updateWeirdPlant(dt) {
  if (!_swayNode) return;
  _t += dt * api.swayFreq;
  const s = Math.sin(_t) * api.swayAmp;
  const c = Math.cos(_t * 0.8) * api.swayAmp * 0.6;
  _swayNode.rotation.z = s * 0.35; // sway는 child에만 적용
  _swayNode.rotation.x = c * 0.25;
}

// 🔹 L-system 식물용 꽃가루 파티클 emitter 생성 (맨 꼭대기 봉오리 기준)
function attachPlantParticles(root, options = {}) {
  const count = options.count ?? 80; // 파티클 개수
  const spread = options.spread ?? 0.15; // 봉오리 주변 퍼지는 정도
  const riseHeight = options.riseHeight ?? 1.2;

  // 1) 이 식물(root) 안의 봉오리들 중 "가장 높은 y" 하나 찾기 (로컬 좌표 기준)
  const budPositions = [];
  root.traverse((obj) => {
    if (obj.userData && obj.userData.isBud) {
      budPositions.push(obj.position.clone());
    }
  });

  if (budPositions.length === 0) {
    console.warn("[lsystem] no buds found for pollen emitter");
    return;
  }

  // 🔹 y가 가장 큰 봉오리 선택 (맨 꼭대기 봉오리)
  let topBud = budPositions[0];
  for (let i = 1; i < budPositions.length; i++) {
    if (budPositions[i].y > topBud.y) {
      topBud = budPositions[i];
    }
  }
  // clone 해서 저장
  topBud = topBud.clone();

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const lifetimes = new Float32Array(count);
  const maxLifetimes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // 항상 "topBud" 기준으로 spawn
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * spread;

    const ox = Math.cos(angle) * r;
    const oz = Math.sin(angle) * r;
    const oy = (Math.random() - 0.5) * spread * 0.4;

    const x = topBud.x + ox;
    const y = topBud.y + oy;
    const z = topBud.z + oz;

    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // 꽃가루가 살짝 위로 + 옆으로 흩어지게
    velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.25;
    velocities[i * 3 + 1] = 0.25 + Math.random() * 0.35;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.25;

    const life = 1.5 + Math.random() * 2.0; // 1.5~3.5초 살다가 사라짐
    lifetimes[i] = Math.random() * life;
    maxLifetimes[i] = life;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("velocity", new THREE.BufferAttribute(velocities, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xfff7e6,
    size: 0.05,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  points.name = "PlantPollen";

  const emitter = new THREE.Group();
  emitter.add(points);
  emitter.position.set(0, 0, 0); // root 기준

  root.add(emitter);

  root.userData.particles = {
    emitter,
    geo,
    positions,
    velocities,
    lifetimes,
    maxLifetimes,
    topBud, // 🔹 봉오리 위치 하나만 저장
    spread,
    riseHeight,
    count,
    time: Math.random() * 10,
    material: mat,
  };
}

export function createWeirdPlantInstance(opts = {}) {
  // api 임시 덮어쓰기로 생성(확장/빌드 함수가 api를 참조하므로)
  const apiBackup = { ...api };
  Object.assign(api, opts);

  const instr = expand("UXRFX", api.genMax);
  const data = buildSegments(instr);
  const plant = buildMeshes(data);

  // 🔹 전체 스케일 먼저 적용
  plant.scale.setScalar(api.plantScale);

  // 🔹 이 상태에서 로컬 기준 높이 계산
  const box = new THREE.Box3().setFromObject(plant);
  const baseHeight = box.max.y - box.min.y; // 식물 로컬 높이

  // sway 분리 노드
  const swayNode = new THREE.Group();
  swayNode.add(plant);

  const root = new THREE.Group();
  root.add(swayNode);

  // 인스턴스별 흔들림 상태 저장
  root.userData.sway = {
    amp: api.swayAmp,
    freq: api.swayFreq,
    phase: Math.random() * Math.PI * 2,
    node: swayNode,
  };

  // 🔹 나중에 "수면 위까지" 스케일 계산할 때 쓰는 기본 높이
  root.userData.baseHeight = baseHeight;

  attachPlantParticles(root, {
    count: 70,
    spread: baseHeight * 0.12,
    riseHeight: baseHeight * 0.5,
  });

  // api 원복
  Object.assign(api, apiBackup);
  return root;
}

export function updateWeirdPlantInstance(root, dt) {
  // 1) sway (원래 있던 흔들림)
  const s = root?.userData?.sway;
  if (s) {
    s.phase += dt * s.freq;
    const z = Math.sin(s.phase) * s.amp * 0.35;
    const x = Math.cos(s.phase * 0.8) * s.amp * 0.25;
    s.node.rotation.z = z;
    s.node.rotation.x = x;
  }

  // 2) 꽃가루 파티클
  const pData = root.userData.particles;
  if (!pData) return;

  const {
    geo,
    positions,
    velocities,
    lifetimes,
    maxLifetimes,
    topBud, // 🔹 맨 꼭대기 봉오리 위치
    spread,
    riseHeight,
    count,
    material,
  } = pData;

  const posAttr = geo.getAttribute("position");
  pData.time += dt;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;

    let x = positions[i3 + 0];
    let y = positions[i3 + 1];
    let z = positions[i3 + 2];

    const vx = velocities[i3 + 0];
    const vy = velocities[i3 + 1];
    const vz = velocities[i3 + 2];

    // 위로 + 옆으로 이동
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;

    lifetimes[i] += dt;

    const tooHigh = y > topBud.y + riseHeight * 2.0;
    const dead = lifetimes[i] > maxLifetimes[i];

    if (tooHigh || dead) {
      // 🔹 새로 spawn: 항상 topBud 주변에서만
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;

      const ox = Math.cos(angle) * r;
      const oz = Math.sin(angle) * r;
      const oy = (Math.random() - 0.5) * spread * 0.4;

      x = topBud.x + ox;
      y = topBud.y + oy;
      z = topBud.z + oz;

      velocities[i3 + 0] = (Math.random() - 0.5) * 0.25;
      velocities[i3 + 1] = 0.25 + Math.random() * 0.35;
      velocities[i3 + 2] = (Math.random() - 0.5) * 0.25;

      const life = 1.5 + Math.random() * 2.0;
      lifetimes[i] = 0;
      maxLifetimes[i] = life;
    }

    positions[i3 + 0] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;
  }

  posAttr.needsUpdate = true;

  // 전체 구름 opacity 살짝 펄스
  if (material) {
    const pulse = 0.75 + 0.25 * Math.sin(pData.time * 0.4);
    material.opacity = 0.4 + 0.5 * pulse;
    material.needsUpdate = true;
  }
}

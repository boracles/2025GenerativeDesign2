import * as THREE from "three";

/* ──────────────────────────────────────────────────────────
   WeirdPlant L-System (garlic scape / 마늘쫑, 감쇠 + 가지)
   ────────────────────────────────────────────────────────── */

let _root = null;
let _t = 0;

export const api = {
  // 스케일 & 감쇠
  step: 0.28,
  radius: 0.035,
  radiusDecay: 0.86, // F마다 줄기 반경 감쇠
  stepDecay: 0.96, // F마다 길이 감쇠
  branchEnterRadiusMul: 0.85,
  branchEnterStepMul: 0.9,

  // 곡률(각도)
  arcDeg: 22,
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
  colorBottom: 0x8b1a1a,
  colorTop: 0xff6b6b,
  budColor: 0xd32f2f,

  // 전체 스케일
  plantScale: 1.5, // ← 식물 전체 크기 업

  genMax: 4,
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

      // 연속 드리프트
      const drift = yawStep * (Math.random() < 0.5 ? 1 : -1) * api.driftMul;
      rotYaw(drift);

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
    const unitGeo = new THREE.SphereGeometry(1, 16, 12); // 유닛 구 → 스케일로 반경 반영
    const bMat = new THREE.MeshStandardMaterial({
      color: api.budColor,
      roughness: 0.75,
    });
    for (const b of buds) {
      const bm = new THREE.Mesh(unitGeo, bMat);
      bm.position.copy(b.pos);
      bm.scale.setScalar(b.r); // ← 여기서 크기 연동!
      group.add(bm);
    }
  }

  return group;
}

/* ---------------- 공개 API ---------------- */
export function createWeirdPlantRoot(opts = {}) {
  Object.assign(api, opts);
  if (_root && _root.parent) _root.parent.remove(_root);
  _root = new THREE.Group();
  _root.name = "WeirdPlantRoot";

  const instr = expand("UXRFX", api.genMax);
  const data = buildSegments(instr);
  const plant = buildMeshes(data);

  plant.scale.setScalar(api.plantScale); // ← 전체 스케일업
  _root.add(plant);

  _root.rotation.y = Math.random() * Math.PI * 2;
  return _root;
}

export function updateWeirdPlant(dt) {
  if (!_root) return;
  _t += dt * api.swayFreq;
  const s = Math.sin(_t) * api.swayAmp;
  const c = Math.cos(_t * 0.8) * api.swayAmp * 0.6;
  _root.rotation.z = s * 0.35;
  _root.rotation.x = c * 0.25;
}

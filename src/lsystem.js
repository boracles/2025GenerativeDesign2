import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* ============ 공통 세팅 ============ */
const hud = document.getElementById("hud");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setScissorTest(true); // ← 멀티 뷰포트
document.body.appendChild(renderer.domElement);

let GLOBAL_COMPARE_BOUNDS = null; // {min, max}

// 비교 프리셋 (2 × 3)
const PRESETS = [
  { angleDeg: 10, decay: 0.95 },
  { angleDeg: 25, decay: 0.95 },
  { angleDeg: 40, decay: 0.95 },
  { angleDeg: 10, decay: 0.6 },
  { angleDeg: 25, decay: 0.6 },
  { angleDeg: 40, decay: 0.6 },
];
const GRID = { cols: 3, rows: 2 };

/* 전역 파라미터: 규칙/세대/길이/색 */
const params = {
  axiom: "F",
  rule: { F: "F[+F]F[-F]F" },
  genMax: 2, // 0~2세대
  step: 1.0,
  baseRadius: 0.12,
  growDuration: 0.8, // 세그먼트 하나 성장 시간
  colorBottom: 0x2e7d32,
  colorTop: 0x1e3a8a,
};

/* ============ 문자열 확장/세그먼트 생성 ============ */
// 2세대 문자열 예시: F[+F]F[-F]F [ + F[+F]F[-F]F ] F[+F]F[-F]F [ - F[+F]F[-F]F ] F[+F]F[-F]F
function expand(axiom, rule, iterations) {
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = "";
    for (const ch of s) next += rule[ch] ?? ch;
    s = next;
  }
  return s;
}

function buildSegments(instructions, { step, angleRad, decay, baseRadius }) {
  const posStack = [],
    dirStack = [],
    scaleStack = [],
    heightStack = [];
  let position = new THREE.Vector3(0, 0, 0);
  let direction = new THREE.Vector3(0, 1, 0);
  let currentScale = baseRadius;
  let heightFromRoot = 0;

  const segments = [];
  const rotate3D = (dir, axis, rad) => {
    const m = new THREE.Matrix4().makeRotationAxis(axis, rad);
    dir.applyMatrix4(m).normalize();
  };

  for (const ch of instructions) {
    switch (ch) {
      case "F": {
        const len = step;
        const newPos = position
          .clone()
          .add(direction.clone().multiplyScalar(len));
        const nextRadius = currentScale * 0.7;
        segments.push({
          start: position.clone(),
          end: newPos.clone(),
          radiusBottom: currentScale,
          radiusTop: nextRadius,
          hStart: heightFromRoot,
          hEnd: heightFromRoot + len,
        });
        position = newPos;
        heightFromRoot += len;
        currentScale = nextRadius;
        break;
      }
      case "+":
        rotate3D(direction, new THREE.Vector3(0, 0, 1), -angleRad);
        break;
      case "-":
        rotate3D(direction, new THREE.Vector3(0, 0, 1), angleRad);
        break;
      case "[": {
        posStack.push(position.clone());
        dirStack.push(direction.clone());
        scaleStack.push(currentScale);
        heightStack.push(heightFromRoot);
        currentScale *= decay;
        break;
      }
      case "]": {
        position = posStack.pop();
        direction = dirStack.pop();
        currentScale = scaleStack.pop();
        heightFromRoot = heightStack.pop();
        break;
      }
    }
  }
  return segments;
}

/* ============ 세그먼트 → 메쉬 (전역높이 고정 그라데이션) ============ */
function meshesFromSegments(
  segments,
  { colorBottom, colorTop, globalMaxHeight }
) {
  if (!segments.length) return [];
  const maxHeight = globalMaxHeight ?? 1;
  const COLOR_BOTTOM = new THREE.Color(colorBottom);
  const COLOR_TOP = new THREE.Color(colorTop);

  const list = [];
  for (const s of segments) {
    const dir = new THREE.Vector3().subVectors(s.end, s.start);
    const len = dir.length();
    const geom = new THREE.CylinderGeometry(
      s.radiusTop,
      s.radiusBottom,
      len,
      24,
      1,
      false
    );

    // 전역 기준 그라데이션
    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const yLocal = pos.getY(i);
      const yWorld = s.hStart + (yLocal + len / 2);
      const t = THREE.MathUtils.clamp(yWorld / maxHeight, 0, 1);
      const c = COLOR_BOTTOM.clone().lerp(COLOR_TOP, t);
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geom, mat);

    const quat = new THREE.Quaternion();
    quat.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize()
    );
    mesh.applyQuaternion(quat);

    geom.translate(0, len / 2, 0);
    mesh.position.copy(s.start);
    mesh.scale.set(1, 0, 1); // 성장 애니메이션용
    list.push(mesh);
  }
  return list;
}

/* ============ Pane(칸) 구조 ============ */
class Pane {
  constructor(preset, idx) {
    this.preset = preset; // {angleDeg, decay}
    this.idx = idx;

    // 씬/카메라/조명
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);

    // 가이드(작게)
    const grid = new THREE.GridHelper(10, 10, 0x88aabb, 0xaad3df);
    this.scene.add(grid);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9);
    dl.position.set(3, 5, 4);
    this.scene.add(dl);

    // 상태
    this.allSegments = [];
    this.stems = [];
    this.currentSeg = 0;
    this.growing = null;
    this.elapsed = 0;
    this.currentGen = 0;
    this.playing = true;
    this.globalMaxHeight = 1;

    // 라벨 DOM
    this.label = document.createElement("div");
    this.label.style.position = "absolute";
    this.label.style.fontSize = "11px";
    this.label.style.opacity = "0.9";
    this.label.style.pointerEvents = "none";
    this.label.textContent = `θ ${preset.angleDeg}°, decay ${preset.decay}`;
    document.body.appendChild(this.label);
  }

  expandForGen(gen) {
    const s = expand(params.axiom, params.rule, gen);
    return buildSegments(s, {
      step: params.step,
      angleRad: THREE.MathUtils.degToRad(this.preset.angleDeg),
      decay: this.preset.decay,
      baseRadius: params.baseRadius,
    });
  }

  recomputeGlobalMax() {
    const finalSegs = this.expandForGen(params.genMax);
    this.globalMaxHeight = finalSegs.length
      ? finalSegs[finalSegs.length - 1].hEnd
      : 1;
  }

  buildGeneration(gen) {
    // 현재 세대의 전체 세그먼트
    const segs = this.expandForGen(gen);
    const newSegs = segs.slice(this.allSegments.length);
    this.allSegments = segs;

    const newMeshes = meshesFromSegments(newSegs, {
      colorBottom: params.colorBottom,
      colorTop: params.colorTop,
      globalMaxHeight: this.globalMaxHeight,
    });

    this.stems.push(...newMeshes);
    for (const m of newMeshes) this.scene.add(m);

    this.currentSeg = this.allSegments.length - newSegs.length;
    this.growing = null;
    this.elapsed = 0;

    // 카메라 프레이밍(현재 세대 기준, 세로기준)
    fitCameraToSegments(this.camera, this.scene, segs, 0.65);
  }
}

/* ============ 비교 panes 생성 ============ */
const PANES = PRESETS.map((p, i) => new Pane(p, i));

// 전역 HUD
function updateHUD() {
  hud.innerHTML = `Compare: ${GRID.cols}×${GRID.rows} — GenMax ${params.genMax}
  <br>Space: 재생/일시정지  &nbsp;[/ ]: 세대수 ↓/↑`;
}

function getBoundsFromSegments(segs) {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const s of segs) {
    min.min(s.start);
    min.min(s.end);
    max.max(s.start);
    max.max(s.end);
  }
  return { min, max };
}

function mergeBounds(a, b) {
  return { min: a.min.clone().min(b.min), max: a.max.clone().max(b.max) };
}

function expandFor(preset, genMax) {
  const s = expand(params.axiom, params.rule, genMax);
  return buildSegments(s, {
    step: params.step,
    angleRad: THREE.MathUtils.degToRad(preset.angleDeg),
    decay: preset.decay,
    baseRadius: params.baseRadius,
  });
}

// 모두 리셋 & 재빌드
function resetAll() {
  for (const pane of PANES) {
    // 씬에서 기존 줄기 제거
    for (const m of pane.stems) pane.scene.remove(m);
    pane.stems = [];
    pane.allSegments = [];
    pane.currentSeg = 0;
    pane.growing = null;
    pane.elapsed = 0;
    pane.currentGen = 0;
    pane.playing = true;
    pane.recomputeGlobalMax();
    pane.buildGeneration(0);
  }
  updateHUD();
}
resetAll();

/* ============ 루프 ============ */
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  const w = innerWidth,
    h = innerHeight;
  const cellW = Math.floor(w / GRID.cols);
  const cellH = Math.floor(h / GRID.rows);

  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      const i = r * GRID.cols + c;
      const pane = PANES[i];
      if (!pane) continue;

      // 성장 애니메이션
      if (pane.growing) {
        pane.elapsed += delta;
        const t = Math.min(pane.elapsed / params.growDuration, 1.0);
        pane.growing.scale.y = t;
        if (t >= 1.0) {
          pane.growing = null;
          pane.elapsed = 0;
        }
      }
      if (!pane.growing && pane.currentSeg < pane.stems.length) {
        pane.growing = pane.stems[pane.currentSeg];
        pane.currentSeg++;
      }
      if (
        pane.playing &&
        !pane.growing &&
        pane.currentSeg >= pane.stems.length
      ) {
        if (pane.currentGen < params.genMax) {
          pane.currentGen++;
          pane.buildGeneration(pane.currentGen);
        } else {
          pane.playing = false;
        }
      }

      // 뷰포트/시저/렌더
      const x = c * cellW;
      const y = h - (r + 1) * cellH; // WebGL 하단 원점
      pane.camera.aspect = cellW / cellH;
      pane.camera.updateProjectionMatrix();

      renderer.setViewport(x, y, cellW, cellH);
      renderer.setScissor(x, y, cellW, cellH);
      renderer.render(pane.scene, pane.camera);

      // 라벨 위치
      pane.label.style.left = `${x + 8}px`;
      pane.label.style.top = `${r * cellH + 8}px`;
    }
  }
}
animate();

/* ============ 프레이밍 유틸(세로 기준) ============ */
function fitCameraToSegments(cam, scn, segs, padding = 1.0) {
  if (!segs.length) return;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const s of segs) {
    min.min(s.start);
    min.min(s.end);
    max.max(s.start);
    max.max(s.end);
  }

  const radiusMargin = Math.max(params.baseRadius, params.step * 0.5);
  min.addScalar(-radiusMargin);
  max.addScalar(+radiusMargin);

  const box = new THREE.Box3(min, max);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const vFov = THREE.MathUtils.degToRad(cam.fov);
  const halfHeight = size.y * 0.5 * padding;
  const dist = halfHeight / Math.tan(vFov / 2);

  // 시선 방향(기본값)
  const dir = new THREE.Vector3(1, 1, 2).normalize();
  cam.position.copy(center).add(dir.multiplyScalar(dist));

  const target = center.clone();
  target.y -= size.y * 0.15;
  cam.near = Math.max(0.01, dist / 100);
  cam.far = dist * 10 + size.length() * 2;
  cam.lookAt(target);
}

/* ============ 리사이즈/키 ============ */
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  updateHUD();
});

addEventListener("keydown", (e) => {
  if (e.key === " ") {
    // 전체 재생/정지 토글
    for (const p of PANES) p.playing = !p.playing;
  } else if (e.key === "[") {
    params.genMax = Math.max(0, params.genMax - 1);
    resetAll();
  } else if (e.key === "]") {
    params.genMax = Math.min(6, params.genMax + 1);
    resetAll();
  }
});

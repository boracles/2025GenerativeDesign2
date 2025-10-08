// ./src/utils/pds.js
// Bridson Poisson Disk Sampling (2D, integer pixel grid)
// pdsSample({ width, height, r, k, acceptFn }) -> { points, grid, active }

export function pdsSample({ width, height, r = 8, k = 20, acceptFn }) {
  const TWO_PI = Math.PI * 2.0;

  // 가속 그리드
  const cell = r / Math.SQRT2;
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const grid = new Int32Array(gw * gh).fill(-1);

  const points = [];
  const active = [];

  // 헬퍼들
  const gi = (x, y) => y * gw + x;
  const inBounds = (x, y) => x >= 0 && x < width && y >= 0 && y < height;

  function fits(nx, ny) {
    // 그리드 이웃만 검사 (3x3)
    const gx = Math.floor(nx / cell);
    const gy = Math.floor(ny / cell);
    const gx0 = Math.max(gx - 2, 0);
    const gy0 = Math.max(gy - 2, 0);
    const gx1 = Math.min(gx + 2, gw - 1);
    const gy1 = Math.min(gy + 2, gh - 1);
    for (let yy = gy0; yy <= gy1; yy++) {
      for (let xx = gx0; xx <= gx1; xx++) {
        const pi = grid[gi(xx, yy)];
        if (pi >= 0) {
          const px = points[pi].x;
          const py = points[pi].y;
          const dx = px - nx;
          const dy = py - ny;
          if (dx * dx + dy * dy < r * r) return false;
        }
      }
    }
    return true;
  }

  function pushPoint(x, y) {
    const p = { x: Math.floor(x), y: Math.floor(y) };
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    grid[gi(gx, gy)] = points.length;
    points.push(p);
    active.push(p);
  }

  // 초기 시드
  let tries = 0;
  while (active.length === 0 && tries < 1000) {
    const sx = Math.floor(Math.random() * width);
    const sy = Math.floor(Math.random() * height);
    if (!acceptFn || acceptFn(sx, sy)) {
      pushPoint(sx, sy);
      break;
    }
    tries++;
  }
  if (active.length === 0) return { points, grid, active };

  // 메인 루프
  while (active.length) {
    const pick = Math.floor(Math.random() * active.length);
    const s = active[pick];
    let placed = false;

    for (let i = 0; i < k; i++) {
      // 반경 r~2r, 균등한 환형 표본
      const ang = Math.random() * TWO_PI;
      const rad = r * (1.0 + Math.random());
      const nx = s.x + Math.cos(ang) * rad;
      const ny = s.y + Math.sin(ang) * rad;

      if (!inBounds(nx, ny)) continue;
      if (acceptFn && !acceptFn(nx | 0, ny | 0)) continue;
      if (!fits(nx, ny)) continue;

      pushPoint(nx, ny);
      placed = true;
      break;
    }

    if (!placed) {
      // 더 못 놓으면 active에서 제거
      active.splice(pick, 1);
    }
  }

  return { points, grid, active };
}

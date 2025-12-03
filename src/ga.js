// ga.js
// ============================================================================
// Genetic Algorithm for "Solema" creatures (palette / pattern / size / movement)
// 설계서 기반 구현
// ============================================================================

/**
 * Genome 타입
 * hue: 120~300 (float)       // 색상
 * value: 0.1~1.0 (float)     // 밝기
 * patternId: 0~4 (int)       // RD 패턴 인덱스
 * bodyScale: 1.0~3.0 (float) // 몸집
 * baseSpeed: 1.0~10.0 (float)// 기본 이동 속도
 * showOff: 0.0~8.0 (float)   // 과시 행동 강도
 */

// ───────────────────────────────
// 상수들 (설계서 그대로 반영)
// ───────────────────────────────

// Palette (색)
const PALETTE_GOOD_HUE_MIN = 160;
const PALETTE_GOOD_HUE_MAX = 210;
const PALETTE_GOOD_VAL_MIN = 0.4;
const PALETTE_GOOD_VAL_MAX = 0.8;

// Pattern (무늬)
const PATTERN_GOOD_SPOTCOUNT_MIN = 15;
const PATTERN_GOOD_SPOTCOUNT_MAX = 30;
const PATTERN_GOOD_SPOTSIZE_MIN = 0.1;
const PATTERN_GOOD_SPOTSIZE_MAX = 0.25;

// RD 패턴 메타 (A~E)
const RD_PATTERN_TABLE = [
  {
    // A
    spotCount: 35,
    spotSize: 0.07,
    roughness: 0.8,
    type: "dense",
  },
  {
    // B
    spotCount: 20,
    spotSize: 0.12,
    roughness: 0.6,
    type: "medium",
  },
  {
    // C
    spotCount: 10,
    spotSize: 0.2,
    roughness: 0.4,
    type: "bold",
  },
  {
    // D
    spotCount: 4,
    spotSize: 0.3,
    roughness: 0.2,
    type: "showoff",
  },
  {
    // E
    spotCount: 0,
    spotSize: 0.0,
    roughness: 0.1,
    type: "plain",
  },
];

// Size (몸집)
const SIZE_GOOD_MIN = 1.8;
const SIZE_GOOD_MAX = 2.0;

// Movement (속도·모션)
const MOVE_GOOD_SPEED_MIN = 3.0;
const MOVE_GOOD_SPEED_MAX = 6.0;
const MOVE_GOOD_SHOWOFF_MIN = 4.8;

// 유전자 범위
const HUE_MIN = 120;
const HUE_MAX = 300;
const VALUE_MIN = 0.1;
const VALUE_MAX = 1.0;
const PATTERN_MIN = 0;
const PATTERN_MAX = 4;
const SCALE_MIN = 0.9;
const SCALE_MAX = 1.8;
const SPEED_MIN = 1.0;
const SPEED_MAX = 10.0;
const SHOWOFF_MIN = 0.0;
const SHOWOFF_MAX = 8.0;

// GA 설정 기본값
const DEFAULT_SURVIVAL_RATE = 0.4; // 상위 40% 생존
const DEFAULT_MUTATION_RATE = 0.15;
const DEFAULT_CROSSOVER_RATE = 0.9;
const TOURNAMENT_K = 3;

export const DEATH_ANIM_DURATION = 2.0; // 설계서 값
export const NEWBORN_ANIM_DURATION = 1.0; // 편의상 추가

// ───────────────────────────────
// 유틸 함수
// ───────────────────────────────
function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function cloneGenome(g) {
  return {
    hue: g.hue,
    value: g.value,
    patternId: g.patternId,
    bodyScale: g.bodyScale,
    baseSpeed: g.baseSpeed,
    showOff: g.showOff,
  };
}

// ───────────────────────────────
// GeneticAlgorithm 클래스
// ───────────────────────────────
export class GeneticAlgorithm {
  constructor({
    populationSize = 40,
    survivalRate = DEFAULT_SURVIVAL_RATE,
    mutationRate = DEFAULT_MUTATION_RATE,
    crossoverRate = DEFAULT_CROSSOVER_RATE,
    slotPatternIds = null, // ★ 추가
  } = {}) {
    this.populationSize = populationSize;
    this.survivalRate = survivalRate;
    this.mutationRate = mutationRate;
    this.crossoverRate = crossoverRate;

    this.slotPatternIds = slotPatternIds; // ★ index별 고정 패턴 슬롯

    this.population = [];
    this.fitnesses = [];
    this.rankedIndices = [];
    this.survivorIndices = [];
    this.doomedIndices = [];
    this.nextPopulation = null;

    this.generation = 0;
  }

  // ───────────── 초기화 ─────────────
  initPopulation() {
    this.population = [];
    for (let i = 0; i < this.populationSize; i++) {
      this.population.push(this.createRandomGenome(i)); // ★ index 넘겨줌
    }
    this.generation = 0;
    this.fitnesses = [];
    this.rankedIndices = [];
    this.survivorIndices = [];
    this.doomedIndices = [];
    this.nextPopulation = null;
  }

  createRandomGenome(index) {
    // 이 슬롯의 패턴 타입을 고정으로 가져온다.
    const slotPid = Array.isArray(this.slotPatternIds)
      ? this.slotPatternIds[index] ?? 0
      : (Math.random() * 5) | 0; // fallback

    return {
      hue: randRange(HUE_MIN, HUE_MAX),
      value: randRange(VALUE_MIN, VALUE_MAX),
      patternId: slotPid, // ★ 슬롯 패턴으로 고정
      bodyScale: randRange(SCALE_MIN, SCALE_MAX),
      baseSpeed: randRange(SPEED_MIN, SPEED_MAX),
      showOff: randRange(SHOWOFF_MIN, SHOWOFF_MAX),
    };
  }

  // ───────────── Score 함수들 ─────────────

  paletteScore(genome) {
    let score = 0;
    if (
      genome.hue >= PALETTE_GOOD_HUE_MIN &&
      genome.hue <= PALETTE_GOOD_HUE_MAX
    ) {
      score += 0.5;
    }
    if (
      genome.value >= PALETTE_GOOD_VAL_MIN &&
      genome.value <= PALETTE_GOOD_VAL_MAX
    ) {
      score += 0.5;
    }
    return score; // 0 / 0.5 / 1
  }

  patternScore(genome) {
    const id = clamp(genome.patternId | 0, PATTERN_MIN, PATTERN_MAX);
    const meta = RD_PATTERN_TABLE[id];
    let score = 0;

    if (
      meta.spotCount >= PATTERN_GOOD_SPOTCOUNT_MIN &&
      meta.spotCount <= PATTERN_GOOD_SPOTCOUNT_MAX
    ) {
      score += 0.5;
    }
    if (
      meta.spotSize >= PATTERN_GOOD_SPOTSIZE_MIN &&
      meta.spotSize <= PATTERN_GOOD_SPOTSIZE_MAX
    ) {
      score += 0.5;
    }
    return score;
  }

  sizeScore(genome) {
    if (
      genome.bodyScale >= SIZE_GOOD_MIN &&
      genome.bodyScale <= SIZE_GOOD_MAX
    ) {
      return 1.0;
    }
    return 0.0;
  }

  movementScore(genome) {
    let score = 0;
    if (
      genome.baseSpeed >= MOVE_GOOD_SPEED_MIN &&
      genome.baseSpeed <= MOVE_GOOD_SPEED_MAX
    ) {
      score += 0.5;
    }
    if (genome.showOff >= MOVE_GOOD_SHOWOFF_MIN) {
      score += 0.5;
    }
    return score;
  }

  fitness(genome) {
    const palette = this.paletteScore(genome);
    const pattern = this.patternScore(genome);
    const size = this.sizeScore(genome);
    const movement = this.movementScore(genome);
    return (palette + pattern + size + movement) / 4.0;
  }

  // ───────────── 평가 ─────────────
  evaluatePopulation() {
    const n = this.population.length;
    this.fitnesses = new Array(n);
    for (let i = 0; i < n; i++) {
      this.fitnesses[i] = this.fitness(this.population[i]);
    }

    this.rankedIndices = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => this.fitnesses[b] - this.fitnesses[a]
    );

    const survivorCount = Math.max(
      1,
      Math.floor(this.populationSize * this.survivalRate)
    );
    this.survivorIndices = this.rankedIndices.slice(0, survivorCount);
    this.doomedIndices = this.rankedIndices.slice(survivorCount);

    return {
      fitnesses: this.fitnesses.slice(),
      rankedIndices: this.rankedIndices.slice(),
      survivorIndices: this.survivorIndices.slice(),
      doomedIndices: this.doomedIndices.slice(),
    };
  }

  // ───────────── Selection (Tournament) ─────────────
  selectParentIndex() {
    const n = this.population.length;
    if (!this.fitnesses || this.fitnesses.length !== n) {
      this.evaluatePopulation();
    }
    let bestIndex = (Math.random() * n) | 0;
    let bestFit = this.fitnesses[bestIndex];
    for (let k = 1; k < TOURNAMENT_K; k++) {
      const idx = (Math.random() * n) | 0;
      const f = this.fitnesses[idx];
      if (f > bestFit) {
        bestFit = f;
        bestIndex = idx;
      }
    }
    return bestIndex;
  }

  // ───────────── Crossover (균등 교차) ─────────────
  crossover(g1, g2) {
    const c1 = {};
    const c2 = {};
    const keys = [
      "hue",
      "value",
      "patternId",
      "bodyScale",
      "baseSpeed",
      "showOff",
    ];
    for (const key of keys) {
      if (Math.random() < 0.5) {
        c1[key] = g1[key];
        c2[key] = g2[key];
      } else {
        c1[key] = g2[key];
        c2[key] = g1[key];
      }
    }
    return [c1, c2];
  }

  // ───────────── Mutation ─────────────
  mutate(genome) {
    const g = cloneGenome(genome);

    const mutateFloat = (value, min, max, scale) => {
      if (Math.random() < this.mutationRate) {
        const range = (max - min) * scale;
        const delta = randRange(-range, range);
        return clamp(value + delta, min, max);
      }
      return value;
    };

    const mutateInt = (value, min, max) => {
      if (Math.random() < this.mutationRate) {
        let v = value;
        // 인접 패턴으로 살짝 움직이거나 완전 랜덤
        if (Math.random() < 0.7) {
          v += Math.random() < 0.5 ? -1 : 1;
        } else {
          v = (Math.random() * (max - min + 1)) | 0;
        }
        return clamp(v, min, max) | 0;
      }
      return value | 0;
    };

    g.hue = mutateFloat(g.hue, HUE_MIN, HUE_MAX, 0.1);
    g.value = mutateFloat(g.value, VALUE_MIN, VALUE_MAX, 0.2);
    g.bodyScale = mutateFloat(g.bodyScale, SCALE_MIN, SCALE_MAX, 0.2);
    g.baseSpeed = mutateFloat(g.baseSpeed, SPEED_MIN, SPEED_MAX, 0.2);
    g.showOff = mutateFloat(g.showOff, SHOWOFF_MIN, SHOWOFF_MAX, 0.25);

    return g;
  }

  // ───────────── 다음 세대 준비/커밋 ─────────────

  /**
   * 현재 population + fitness를 기반으로
   * nextPopulation을 생성한다. (아직 커밋 X)
   */
  prepareNextGeneration() {
    if (!this.fitnesses || this.fitnesses.length !== this.population.length) {
      this.evaluatePopulation();
    }

    const n = this.populationSize;
    const newPop = [];

    // 1) 엘리트
    const eliteCount = Math.max(
      1,
      Math.floor(this.populationSize * this.survivalRate)
    );
    for (let i = 0; i < eliteCount; i++) {
      const idx = this.rankedIndices[i];
      const g = cloneGenome(this.population[idx]);
      newPop.push(g);
    }

    // 2) 나머지는 부모 선택 + 교차 + 변이
    while (newPop.length < n) {
      const pIdx1 = this.selectParentIndex();
      const pIdx2 = this.selectParentIndex();
      const parent1 = this.population[pIdx1];
      const parent2 = this.population[pIdx2];

      let children;
      if (Math.random() < this.crossoverRate) {
        children = this.crossover(parent1, parent2);
      } else {
        children = [cloneGenome(parent1), cloneGenome(parent2)];
      }

      const c1 = this.mutate(children[0]);
      const c2 = this.mutate(children[1]);

      newPop.push(c1);
      if (newPop.length < n) newPop.push(c2);
    }

    // ★★ 여기에서 슬롯 패턴 강제 적용 ★★
    if (Array.isArray(this.slotPatternIds)) {
      for (let i = 0; i < newPop.length; i++) {
        const pid = this.slotPatternIds[i] ?? 0;
        newPop[i].patternId = pid;
      }
    }

    this.nextPopulation = newPop;
  }

  /**
   * prepareNextGeneration()에서 만든 nextPopulation을
   * 실제 population으로 커밋.
   */
  commitNextGeneration() {
    if (!this.nextPopulation) return;
    this.population = this.nextPopulation;
    this.nextPopulation = null;
    this.generation += 1;
  }

  /**
   * 현재 평가 결과(survivorIndices, doomedIndices)에 따라
   * ★ 죽은 개체들만 새 genome로 교체 ★하고,
   * 살아남은 개체는 그대로 유지하는 방식의 세대 전환.
   */
  nextGeneration() {
    // 평가 안 되어 있으면 먼저 평가
    if (!this.fitnesses || this.fitnesses.length !== this.population.length) {
      this.evaluatePopulation();
    }

    const n = this.populationSize;
    // 기존 population을 복사해서 시작 (slot 유지)
    const newPop = this.population.map((g) => cloneGenome(g));

    // 교체 대상 인덱스: doomedIndices가 있으면 그걸 쓰고,
    // 없으면 상위 survivalRate%를 제외한 나머지를 교체
    const eliteCount = Math.max(1, Math.floor(n * this.survivalRate));
    const defaultTargets = this.rankedIndices.slice(eliteCount);
    const targets =
      this.doomedIndices && this.doomedIndices.length
        ? this.doomedIndices
        : defaultTargets;

    // 자식 한 개 만드는 헬퍼
    const makeChild = () => {
      const pIdx1 = this.selectParentIndex();
      const pIdx2 = this.selectParentIndex();
      const parent1 = this.population[pIdx1];
      const parent2 = this.population[pIdx2];

      let children;
      if (Math.random() < this.crossoverRate) {
        children = this.crossover(parent1, parent2);
      } else {
        children = [cloneGenome(parent1), cloneGenome(parent2)];
      }

      const child = this.mutate(children[0]);

      // 슬롯별 patternId 고정
      if (Array.isArray(this.slotPatternIds)) {
        const pid = this.slotPatternIds[pIdx1] ?? child.patternId;
        child.patternId = pid;
      }

      return child;
    };

    // ★ 죽는 인덱스들만 새 child로 교체
    for (const idx of targets) {
      if (idx == null || idx < 0 || idx >= n) continue;
      const child = makeChild();

      if (Array.isArray(this.slotPatternIds)) {
        child.patternId = this.slotPatternIds[idx] ?? child.patternId;
      }

      newPop[idx] = child;
    }

    this.population = newPop;
    this.generation += 1;
  }

  // ───────────── Getter들 ─────────────
  getPopulation() {
    return this.population;
  }

  getLastEvaluation() {
    return {
      fitnesses: this.fitnesses.slice(),
      rankedIndices: this.rankedIndices.slice(),
      survivorIndices: this.survivorIndices.slice(),
      doomedIndices: this.doomedIndices.slice(),
    };
  }

  getSurvivorAndDoomedIndices() {
    return {
      survivors: this.survivorIndices.slice(),
      doomed: this.doomedIndices.slice(),
    };
  }
}

import type {
  AugmentDefinition,
  HorseAnim,
  HorseInfo,
  HorseSnapshot,
  RankingEntry
} from '../../../shared/src/types';
import {
  COURSE_LENGTH,
  MAX_STACKS_PER_CARD,
  SPEED_MULT_MAX,
  SPEED_MULT_MIN
} from '../../../shared/src/constants';

export interface ActiveEffect {
  defId: string;
  effectType: AugmentDefinition['effectType'];
  value: number;
  expiresAt: number; // 시뮬레이션 시간(ms) 기준
  hostile: boolean;
  emoji: string;
  anim?: HorseAnim;
}

export interface SimHorse {
  info: HorseInfo;
  pos: number;
  prevPos: number;
  speed: number;
  stamina: number;
  staminaMax: number;
  fatigued: boolean;
  finished: boolean;
  finishTime: number | null;
  effects: ActiveEffect[];
  shield: number;
  luckMult: number;
  luckTimer: number;
  /** 경주마다 달라지는 당일 컨디션 배율 (행운이 높으면 평균이 약간 유리) */
  form: number;
  /** 직전 틱에 정지/역주행 중이었는지 — 효과가 시작되고 끝나는 순간을 잡는다 */
  wasStopped: boolean;
  wasReversing: boolean;
  anim: HorseAnim;
}

export interface ApplyResult {
  ok: boolean;
  targets: number[]; // 효과가 실제 적용된 말
  blocked: number[]; // 방어막/비행으로 무효화된 말
  message?: string;
}

export interface BetTotals {
  /** 말 ID → 우승 배팅금 합계 */
  win: Map<number, number>;
  /** 말 ID → 전체 배팅금 합계 */
  total: Map<number, number>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 지구력이 이 비율 아래로 내려가면 느려지기 시작한다 */
export const FATIGUE_START = 1.0;
/** 지구력이 0일 때의 속력 배율 */
export const FATIGUE_FLOOR = 0.78;

/**
 * 서버 권한 경주 시뮬레이션.
 * 고정 틱으로 진행하며 증강 효과, 피로, 몸무게, 행운을 반영한다.
 */
export class RaceSim {
  now = 0; // 시뮬레이션 경과 시간 (ms)
  horses: SimHorse[];
  private rng: () => number;

  constructor(infos: HorseInfo[], rng: () => number = Math.random) {
    this.rng = rng;
    this.horses = infos.map((info) => ({
      info,
      pos: 0,
      prevPos: 0,
      speed: 0,
      stamina: 55 + info.stats.stamina * 0.95,
      // 코스가 길어져도 지치는 정도가 같도록 코스 길이에 비례시킨다 (기준 1000)
      staminaMax: (55 + info.stats.stamina * 0.95) * (COURSE_LENGTH / 1000),
      fatigued: false,
      finished: false,
      finishTime: null,
      effects: [],
      shield: 0,
      luckMult: 1,
      luckTimer: 0,
      form: 1 + (rng() * 2 - 1) * 0.06 + (info.stats.luck - 50) * 0.0006,
      wasStopped: false,
      wasReversing: false,
      anim: 'idle'
    }));
  }

  /** 기본 최고 속력 (단위/초) */
  private baseMaxSpeed(h: SimHorse): number {
    return 17 + h.info.stats.speed * 0.09;
  }

  tick(dtMs: number): void {
    const dt = dtMs / 1000;
    this.now += dtMs;

    for (const h of this.horses) {
      if (h.finished) {
        h.anim = 'finished';
        continue;
      }
      h.prevPos = h.pos;

      // 만료된 효과 제거
      h.effects = h.effects.filter((e) => e.expiresAt > this.now);

      // 행운: 주기적으로 소규모 배율 재추출
      h.luckTimer -= dtMs;
      if (h.luckTimer <= 0) {
        h.luckTimer = 1000;
        h.luckMult =
          1 + (this.rng() * 2 - 1) * 0.05 + (h.info.stats.luck - 50) * 0.0004;
      }

      const stopped = h.effects.some((e) => e.effectType === 'stop');
      const reversing = h.effects.some((e) => e.effectType === 'reverse');
      const flying = h.effects.some((e) => e.effectType === 'fly');

      // 속력 배율 (0.2~2.0 범위로 제한)
      let speedMult = 1;
      for (const e of h.effects) {
        if (e.effectType === 'speedMult' || e.effectType === 'fly') {
          speedMult *= 1 + e.value;
        }
      }

      // 몸무게 배율 (증강에 의한)
      let weightRatio = 1;
      let accelMult = 1;
      for (const e of h.effects) {
        if (e.effectType === 'weightMult') weightRatio *= e.value;
        if (e.effectType === 'accelMult') accelMult *= 1 + e.value;
      }
      weightRatio = clamp(weightRatio, 0.2, 5);

      const effWeight = clamp(h.info.stats.weight * weightRatio, 100, 2500);
      const accel = Math.max(
        0.8,
        (4 + h.info.stats.accel * 0.1) * (500 / effWeight) * accelMult
      );
      // 증강으로 무거워지면 최고 속력도 줄고, 가벼워지면 는다 (몸무게 절반 ≈ +19%, 3배 ≈ -24%)
      const weightSpeedFactor = clamp(Math.pow(weightRatio, -0.25), 0.7, 1.25);
      // 증강에 의한 최종 속력 배율은 모두 합쳐 0.2~2.0배 안에서만 움직인다
      const totalMult = clamp(speedMult * weightSpeedFactor, SPEED_MULT_MIN, SPEED_MULT_MAX);

      // 지구력 소모 (달리는 속도에 비례)
      const baseMax = this.baseMaxSpeed(h);
      const drain = stopped ? 0 : 2.2 * (Math.max(h.speed, 0) / baseMax) * dt;
      h.stamina = Math.max(0, h.stamina - drain);
      // 피로: 지구력이 30% 아래로 내려가면 서서히 느려져 바닥에서 55%까지 떨어진다.
      // (바닥날 때만 갑자기 느려지면 지구력 회복 카드가 대부분의 말에게 쓸모가 없어진다)
      const staminaFrac = h.stamina / h.staminaMax;
      const fatigueFactor =
        staminaFrac >= FATIGUE_START ? 1 : FATIGUE_FLOOR + (1 - FATIGUE_FLOOR) * (staminaFrac / FATIGUE_START);
      h.fatigued = staminaFrac < 0.15;

      // 목표 속도 계산 및 가감속
      const target = baseMax * totalMult * fatigueFactor * h.luckMult * h.form;
      if (stopped) {
        // 정지: 그 자리에 멈춘다. 멈추는 순간 속도의 60%를 잃고, 풀리면 남은 속도에서 다시 달린다
        if (!h.wasStopped) h.speed = Math.max(0, h.speed) * 0.4;
      } else if (reversing) {
        // 역주행: 걸리는 즉시 뒤로 달린다
        h.speed = -0.5 * baseMax;
      } else {
        // 역주행이 끝나면 제자리에서 다시 출발한다 (뒤로 계속 밀리지 않게)
        if (h.wasReversing && h.speed < 0) h.speed = 0;
        if (h.speed < target) {
          h.speed = Math.min(target, h.speed + accel * dt);
        } else if (h.speed > target) {
          h.speed = Math.max(target, h.speed - Math.max(accel, 12) * dt);
        }
      }
      h.wasStopped = stopped;
      h.wasReversing = reversing && !stopped;

      if (!stopped) h.pos = Math.max(0, h.pos + h.speed * dt);

      // 결승선 판정 (틱 사이 통과 시각 보간)
      if (h.pos >= COURSE_LENGTH) {
        const travelled = h.pos - h.prevPos;
        const f = travelled > 0 ? (COURSE_LENGTH - h.prevPos) / travelled : 1;
        h.finishTime = this.now - dtMs + f * dtMs;
        h.finished = true;
        h.pos = COURSE_LENGTH;
        h.anim = 'finished';
        continue;
      }

      // 애니메이션 상태 결정
      // 여러 효과가 겹치면 더 눈에 띄는 상태가 이긴다: 정지 > 역주행 > 넘어짐 > 비행 > 가속/감속
      if (stopped) h.anim = 'stunned';
      else if (reversing) h.anim = 'reverse';
      else if (h.effects.some((e) => e.anim === 'fallen')) h.anim = 'fallen';
      else if (flying) h.anim = 'flying';
      else if (totalMult > 1.12) h.anim = 'boost';
      else if (totalMult < 0.88) h.anim = 'slow';
      else if (h.fatigued) h.anim = 'tired';
      else h.anim = 'run';
    }
  }

  allFinished(): boolean {
    return this.horses.every((h) => h.finished);
  }

  leaderPos(): number {
    return Math.max(...this.horses.map((h) => h.pos));
  }

  /**
   * 현재 순위 (말 ID 배열, 1등부터).
   * 완주한 말이 먼저(통과 시각 순), 나머지는 위치 내림차순, 동률이면 ID 오름차순.
   */
  currentRanking(): number[] {
    const sorted = [...this.horses].sort((a, b) => {
      if (a.finished && b.finished) {
        if (a.finishTime! !== b.finishTime!) return a.finishTime! - b.finishTime!;
        return a.info.id - b.info.id;
      }
      if (a.finished) return -1;
      if (b.finished) return 1;
      if (a.pos !== b.pos) return b.pos - a.pos;
      return a.info.id - b.info.id;
    });
    return sorted.map((h) => h.info.id);
  }

  /** 최종 순위 (미완주 말은 위치 기준으로 뒤에 배치 — 안전장치) */
  finalRankings(): RankingEntry[] {
    return this.currentRanking().map((horseId, i) => {
      const h = this.horse(horseId);
      return { horseId, rank: i + 1, timeMs: Math.round(h.finishTime ?? this.now) };
    });
  }

  horse(id: number): SimHorse {
    return this.horses.find((h) => h.info.id === id)!;
  }

  /** 증강 대상 해석. 완주한 말은 제외한다. */
  resolveTargets(def: AugmentDefinition, opts: { targetHorseId?: number; bets?: BetTotals }): number[] {
    const unfinished = this.horses.filter((h) => !h.finished);
    const alive = (ids: number[]) =>
      ids.filter((id) => unfinished.some((h) => h.info.id === id));
    const ranking = this.currentRanking();

    const byStat = (
      key: (h: SimHorse) => number,
      desc: boolean,
      n: number
    ): number[] =>
      [...unfinished]
        .sort((a, b) => {
          const d = desc ? key(b) - key(a) : key(a) - key(b);
          return d !== 0 ? d : a.info.id - b.info.id;
        })
        .slice(0, n)
        .map((h) => h.info.id);

    const byBet = (map: Map<number, number> | undefined, most: boolean): number[] => {
      if (unfinished.length === 0) return [];
      let best: SimHorse | null = null;
      let bestVal = most ? -Infinity : Infinity;
      for (const h of unfinished) {
        const v = map?.get(h.info.id) ?? 0; // 배팅 없는 말은 0으로 간주
        if (most ? v > bestVal : v < bestVal) {
          bestVal = v;
          best = h;
        } else if (v === bestVal && best && h.info.id < best.info.id) {
          best = h; // 동률이면 낮은 ID
        }
      }
      return best ? [best.info.id] : [];
    };

    switch (def.targetType) {
      case 'single': {
        if (opts.targetHorseId == null) return [];
        return alive([opts.targetHorseId]);
      }
      case 'odd':
        return alive([1, 3, 5]);
      case 'even':
        return alive([2, 4, 6]);
      case 'front3':
        return alive(ranking.slice(0, 3));
      case 'back3':
        return alive(ranking.slice(3, 6));
      case 'rank1':
        return alive(ranking.slice(0, 1));
      case 'rank2':
        return alive(ranking.slice(1, 2));
      case 'rank6':
        return alive(ranking.slice(5, 6));
      case 'rank23':
        return alive(ranking.slice(1, 3));
      case 'rank34':
        return alive(ranking.slice(2, 4));
      case 'fastest2':
        return byStat((h) => h.info.stats.speed, true, 2);
      case 'slowest2':
        return byStat((h) => h.info.stats.speed, false, 2);
      case 'heaviest2':
        return byStat((h) => h.info.stats.weight, true, 2);
      case 'mostStamina2':
        return byStat((h) => h.stamina, true, 2);
      case 'leastStamina2':
        return byStat((h) => h.stamina, false, 2);
      case 'mostBetWin':
        return byBet(opts.bets?.win, true);
      case 'leastBetWin':
        return byBet(opts.bets?.win, false);
      case 'mostBetTotal':
        return byBet(opts.bets?.total, true);
      case 'swap16': {
        // 미완주 말 중 최상위와 최하위
        const aliveRank = ranking.filter((id) =>
          unfinished.some((h) => h.info.id === id)
        );
        if (aliveRank.length < 2) return [];
        return [aliveRank[0], aliveRank[aliveRank.length - 1]];
      }
    }
  }

  /**
   * 증강 적용. 대상은 적용 시점에 한 번 확정되며 이후 바뀌지 않는다.
   */
  applyAugment(
    def: AugmentDefinition,
    opts: { targetHorseId?: number; bets?: BetTotals } = {}
  ): ApplyResult {
    const targetIds = this.resolveTargets(def, opts);
    if (targetIds.length === 0) {
      return { ok: false, targets: [], blocked: [], message: '유효한 대상이 없습니다.' };
    }

    // 위치 교환은 별도 처리
    if (def.effectType === 'swapPositions') {
      const a = this.horse(targetIds[0]);
      const b = this.horse(targetIds[targetIds.length - 1]);
      if (a === b) return { ok: false, targets: [], blocked: [], message: '유효한 대상이 없습니다.' };
      // 비행/방어막은 교환도 방해로 간주하여 차단
      const blocked: number[] = [];
      for (const h of [a, b]) {
        if (h.effects.some((e) => e.effectType === 'fly')) blocked.push(h.info.id);
        else if (h.shield > 0) {
          h.shield--;
          blocked.push(h.info.id);
        }
      }
      if (blocked.length > 0) {
        return { ok: true, targets: [], blocked, message: '방어 효과로 교환이 무효화되었습니다.' };
      }
      const tmp = a.pos;
      a.pos = b.pos;
      b.pos = tmp;
      a.prevPos = a.pos;
      b.prevPos = b.pos;
      return { ok: true, targets: [a.info.id, b.info.id], blocked: [] };
    }

    const applied: number[] = [];
    const blocked: number[] = [];
    let capped = 0; // 같은 카드가 이미 최대로 걸려 있어 건너뛴 말 수

    for (const id of targetIds) {
      const h = this.horse(id);

      // 방해 효과: 비행 중 면역 → 방어막 소모 순으로 차단
      if (def.hostile) {
        if (h.effects.some((e) => e.effectType === 'fly')) {
          blocked.push(id);
          continue;
        }
        if (h.shield > 0) {
          h.shield--;
          blocked.push(id);
          continue;
        }
      }

      // 동일 카드 중첩 제한
      const stacks = h.effects.filter((e) => e.defId === def.id).length;
      if (def.durationMs > 0 && stacks >= MAX_STACKS_PER_CARD) {
        capped++;
        continue;
      }

      switch (def.effectType) {
        case 'teleport': {
          h.pos += COURSE_LENGTH * def.value;
          if (h.pos >= COURSE_LENGTH) {
            h.pos = COURSE_LENGTH;
            h.finished = true;
            h.finishTime = this.now;
            h.anim = 'finished';
          } else {
            h.prevPos = h.pos;
          }
          break;
        }
        case 'staminaRestorePct': {
          h.stamina = Math.min(h.staminaMax, h.stamina + (h.staminaMax * def.value) / 100);
          if (h.stamina > 0) h.fatigued = false;
          break;
        }
        case 'staminaDrainPct': {
          h.stamina = Math.max(0, h.stamina * (1 - def.value / 100));
          if (h.stamina <= 0) h.fatigued = true;
          break;
        }
        case 'shield': {
          h.shield += 1;
          break;
        }
        case 'fly': {
          // 비행 시작 시 이미 걸린 방해 효과 해제
          h.effects = h.effects.filter((e) => !e.hostile);
          h.effects.push(this.makeEffect(def));
          break;
        }
        case 'stop': {
          // 동일한 정지 효과의 지속시간은 합산하지 않음 (더 긴 쪽 유지)
          const existing = h.effects.find((e) => e.effectType === 'stop');
          const newExpiry = this.now + def.durationMs;
          if (existing) {
            existing.expiresAt = Math.max(existing.expiresAt, newExpiry);
          } else {
            h.effects.push(this.makeEffect(def));
          }
          break;
        }
        case 'rankBasedSpeed': {
          // 적용 시점 순위에 따라 +20% ~ +45%
          const rank = this.currentRanking().indexOf(id) + 1;
          const bonus = 0.2 + (rank - 1) * 0.05;
          h.effects.push({ ...this.makeEffect(def), effectType: 'speedMult', value: bonus });
          break;
        }
        case 'accelMult': {
          // 가속력은 속도가 떨어져 있을 때만 의미가 있으므로, 감소 카드는 급제동을 함께 건다
          if (def.value < 0) h.speed = Math.max(0, h.speed) * 0.3;
          h.effects.push(this.makeEffect(def));
          break;
        }
        default: {
          // speedMult / weightMult / reverse
          h.effects.push(this.makeEffect(def));
        }
      }
      applied.push(id);
    }

    if (applied.length === 0 && blocked.length === 0) {
      return {
        ok: false,
        targets: [],
        blocked: [],
        message: capped > 0 ? '이미 같은 효과가 최대로 걸려 있습니다.' : '유효한 대상이 없습니다.'
      };
    }
    return { ok: true, targets: applied, blocked };
  }

  private makeEffect(def: AugmentDefinition): ActiveEffect {
    return {
      defId: def.id,
      effectType: def.effectType,
      value: def.value,
      expiresAt: this.now + def.durationMs,
      hostile: def.hostile,
      emoji: def.emoji,
      anim: def.anim
    };
  }

  snapshot(): HorseSnapshot[] {
    const ranking = this.currentRanking();
    return this.horses.map((h) => ({
      id: h.info.id,
      pos: Math.round(h.pos * 10) / 10,
      speed: Math.round(h.speed * 10) / 10,
      rank: ranking.indexOf(h.info.id) + 1,
      finished: h.finished,
      stamina: Math.round(h.stamina),
      staminaMax: Math.round(h.staminaMax),
      anim: h.anim,
      effects: h.effects.map((e) => ({
        defId: e.defId,
        emoji: e.emoji,
        hostile: e.hostile,
        remainMs: Math.max(0, e.expiresAt - this.now)
      })),
      shield: h.shield
    }));
  }
}

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
  /** 자석·나란히 달리기·업히기: 이 효과가 묶어 둔 상대 말 */
  linkId?: number;
  /** 겉모습 연출 없이 수치만 걸린 효과 */
  quiet?: boolean;
  /** 이 효과가 끝나면 이만큼 멈춘다 (당근 낚싯대의 허탈함) */
  afterStopMs?: number;
  /** 이 효과가 끝나면 한 등수 뒤 말에게 같은 감속이 옮는다 (재채기 릴레이) */
  relay?: boolean;
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

/** 자석에 끌려가는 속도 (코스 단위/초, 달리는 속도에 더해진다) */
const MAGNET_PULL = 55;
/** 업히러 앞 말을 따라잡는 속도 (코스 단위/초) */
const PIGGYBACK_CATCH = 90;
/** 나란히 달리기에서 두 말이 가운데로 모이는 빠르기 */
const PAIR_RATE = 1.6;

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
  /** 결승선 위치 (코스 단위). '결승선 당기기' 카드로 앞당겨질 수 있다 */
  finishLine = COURSE_LENGTH;
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
    // 속력 능력치 1점의 영향을 줄여(0.09 → 0.06) 가장 빠른 말과 느린 말의 차이를 약 17%로 좁혔다.
    // 기본값은 능력치 65인 말의 속력이 전과 같도록 맞췄다
    return 19 + h.info.stats.speed * 0.06;
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

      // 만료된 효과 제거. 끝나면서 뒤따르는 일이 있는 효과는 여기서 처리한다
      for (const e of h.effects) {
        if (e.expiresAt > this.now) continue;
        if (e.afterStopMs) {
          h.effects.push({ defId: e.defId, effectType: 'stop', value: 0, expiresAt: this.now + e.afterStopMs, hostile: false, emoji: '😮‍💨', anim: 'stunned', quiet: true });
        }
        if (e.relay) this.passSneeze(h, e);
      }
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

      // 다른 말과 묶인 효과: 자석(앞 말 뒤로 끌려감), 나란히 달리기(옆 말과 가운데로 모임)
      if (!stopped) {
        for (const e of h.effects) {
          if (e.linkId == null) continue;
          const other = this.horse(e.linkId);
          if (e.effectType === 'magnet') {
            const goal = Math.min(other.pos - e.value, this.finishLine - 1);
            if (h.pos < goal) h.pos += Math.min(goal - h.pos, MAGNET_PULL * dt);
            else e.expiresAt = this.now; // 다 붙었으면 끝
          } else if (e.effectType === 'piggyback') {
            // 업힌 말은 업은 말 바로 뒤에 붙어 함께 간다. 업은 말이 들어오면 내려서 제 발로 달린다
            if (other.finished) e.expiresAt = this.now;
            else {
              const seat = other.pos - 0.5;
              h.pos = h.pos < seat ? Math.min(seat, h.pos + PIGGYBACK_CATCH * dt) : seat;
              h.speed = other.speed;
            }
          } else if (e.effectType === 'pairUp' && !other.finished) {
            const d = ((other.pos - h.pos) / 2) * (1 - Math.exp(-dt * PAIR_RATE));
            h.pos = Math.max(0, h.pos + d);
            other.pos = Math.max(0, other.pos - d);
          }
        }
      }

      // 결승선 판정 (틱 사이 통과 시각 보간)
      if (h.pos >= this.finishLine) {
        const travelled = h.pos - h.prevPos;
        const f = travelled > 0 ? Math.min(1, Math.max(0, (this.finishLine - h.prevPos) / travelled)) : 1;
        h.finishTime = this.now - dtMs + f * dtMs;
        h.finished = true;
        h.pos = this.finishLine;
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
      case 'all':
        return unfinished.map((h) => h.info.id);
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
   * 지금 이 카드를 쓸 수 있는 말이 한 마리라도 있는지. 카드를 뽑을 때 써서, 쓸 수 없는 카드는 손에 들어오지 않게 한다.
   * (방어막이나 비행으로 막히는 것은 "쓸 수 없음"이 아니라 승부의 일부라서 따지지 않는다)
   */
  usableNow(def: AugmentDefinition, opts: { bets?: BetTotals } = {}): boolean {
    const unfinished = this.horses.filter((h) => !h.finished);
    if (unfinished.length === 0) return false;
    if (def.effectType === 'finishLine') {
      const line = COURSE_LENGTH * def.value;
      return this.finishLine > line && this.leaderPos() < line - 30;
    }
    if (def.effectType === 'shuffleAll') return unfinished.length >= 2;
    if (def.targetType !== 'single') return this.resolveTargets(def, opts).length > 0;
    const full = this.currentRanking();
    const order = full.filter((id) => !this.horse(id).finished);
    if (def.effectType === 'magnet') return order.some((id, idx) => idx >= 2 && full.indexOf(id) >= 3);
    if (def.effectType === 'piggyback') return order.length >= 2;
    if (def.effectType === 'pairUp') {
      return unfinished.some((h) => unfinished.some((o) => Math.abs(o.info.id - h.info.id) === 1));
    }
    return true;
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
      return { ok: false, targets: [], blocked: [], message: '카드를 쓸 수 있는 말이 없습니다.' };
    }

    // 결승선 옮기기: 말이 아니라 코스를 바꾼다
    if (def.effectType === 'finishLine') {
      const line = COURSE_LENGTH * def.value;
      if (this.finishLine <= line) return { ok: false, targets: [], blocked: [], message: '결승선은 이미 옮겨졌습니다.' };
      if (this.leaderPos() >= line - 30) return { ok: false, targets: [], blocked: [], message: '결승선을 옮기기에는 너무 늦었습니다.' };
      this.finishLine = line;
      // 다들 깜짝 놀라 펄쩍 뛴다 (연출만)
      if (def.visualMs) for (const id of targetIds) this.horse(id).effects.push(this.makeCosmetic(def));
      return { ok: true, targets: targetIds, blocked: [] };
    }

    // 전체 자리 섞기: 방어막이나 비행 중인 말은 제자리를 지킨다
    if (def.effectType === 'shuffleAll') {
      const blocked: number[] = [];
      const movable: SimHorse[] = [];
      for (const id of targetIds) {
        const h = this.horse(id);
        if (h.effects.some((e) => e.effectType === 'fly')) blocked.push(id);
        else if (h.shield > 0) {
          h.shield--;
          blocked.push(id);
        } else movable.push(h);
      }
      if (movable.length < 2) return { ok: true, targets: [], blocked, message: '자리를 바꿀 말이 모자랍니다.' };
      const before = movable.map((h) => h.pos);
      let after = before;
      // 아무도 안 움직이는 결과는 다시 뽑는다
      for (let tries = 0; tries < 12; tries++) {
        after = [...before];
        for (let i = after.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [after[i], after[j]] = [after[j], after[i]];
        }
        if (after.some((v, i) => v !== before[i])) break;
      }
      movable.forEach((h, i) => {
        h.pos = after[i];
        h.prevPos = h.pos;
        if (def.visualMs) h.effects.push(this.makeCosmetic(def));
      });
      return { ok: true, targets: movable.map((h) => h.info.id), blocked };
    }

    // 말을 고르는 카드 중 조건이 붙은 것: 조건에 안 맞으면 카드를 잃지 않고 안내만 한다
    let linkId: number | undefined;
    if (def.effectType === 'magnet') {
      const order = this.currentRanking().filter((id) => !this.horse(id).finished);
      const idx = order.indexOf(targetIds[0]);
      if (this.currentRanking().indexOf(targetIds[0]) < 3 || idx < 2) {
        return { ok: false, targets: [], blocked: [], message: '4등 아래의 말에게만 쓸 수 있습니다.' };
      }
      linkId = order[idx - 2];
    }
    if (def.effectType === 'piggyback') {
      const order = this.currentRanking().filter((id) => !this.horse(id).finished);
      const idx = order.indexOf(targetIds[0]);
      if (idx < 1) return { ok: false, targets: [], blocked: [], message: '맨 앞의 말은 업힐 말이 없습니다.' };
      const carrier = this.horse(order[idx - 1]);
      // 업는 쪽은 느려지므로 방해로 본다: 비행 중이거나 방어막이 있으면 못 업힌다
      if (carrier.effects.some((e) => e.effectType === 'fly')) {
        return { ok: true, targets: [], blocked: [carrier.info.id], message: '날고 있는 말에게는 업힐 수 없습니다.' };
      }
      if (carrier.shield > 0) {
        carrier.shield--;
        return { ok: true, targets: [], blocked: [carrier.info.id], message: '방어막 때문에 업히지 못했습니다.' };
      }
      linkId = carrier.info.id;
    }
    if (def.effectType === 'pairUp') {
      const me = this.horse(targetIds[0]);
      const sides = this.horses.filter((h) => !h.finished && Math.abs(h.info.id - me.info.id) === 1);
      if (sides.length === 0) return { ok: false, targets: [], blocked: [], message: '옆 레인에 달리는 말이 없습니다.' };
      // 더 가까운 쪽. 같으면 앞서 있는 쪽
      sides.sort((a, b) => Math.abs(a.pos - me.pos) - Math.abs(b.pos - me.pos) || b.pos - a.pos);
      linkId = sides[0].info.id;
    }

    // 위치 교환은 별도 처리
    if (def.effectType === 'swapPositions') {
      const a = this.horse(targetIds[0]);
      const b = this.horse(targetIds[targetIds.length - 1]);
      if (a === b) return { ok: false, targets: [], blocked: [], message: '카드를 쓸 수 있는 말이 없습니다.' };
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
        return { ok: true, targets: [], blocked, message: '방어막 때문에 자리를 바꾸지 못했습니다.' };
      }
      const tmp = a.pos;
      a.pos = b.pos;
      b.pos = tmp;
      a.prevPos = a.pos;
      b.prevPos = b.pos;
      if (def.visualMs) for (const h of [a, b]) h.effects.push(this.makeCosmetic(def));
      return { ok: true, targets: [a.info.id, b.info.id], blocked: [] };
    }

    const applied: number[] = [];
    const blocked: number[] = [];
    let capped = 0; // 같은 카드가 이미 최대로 걸려 있어 건너뛴 말 수
    const alsoHit: number[] = []; // 고른 말 말고 함께 영향을 받은 말

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
          if (h.pos >= this.finishLine) {
            h.pos = this.finishLine;
            h.finished = true;
            h.finishTime = this.now;
            h.anim = 'finished';
          } else {
            h.prevPos = h.pos;
            if (def.visualMs) h.effects.push(this.makeCosmetic(def));
          }
          break;
        }
        case 'staminaRestorePct': {
          h.stamina = Math.min(h.staminaMax, h.stamina + (h.staminaMax * def.value) / 100);
          if (h.stamina > 0) h.fatigued = false;
          if (def.visualMs) h.effects.push(this.makeCosmetic(def));
          break;
        }
        case 'staminaDrainPct': {
          h.stamina = Math.max(0, h.stamina * (1 - def.value / 100));
          if (h.stamina <= 0) h.fatigued = true;
          if (def.visualMs) h.effects.push(this.makeCosmetic(def));
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
        case 'magnet': {
          h.effects.push({ ...this.makeEffect(def), linkId });
          break;
        }
        case 'pairUp': {
          h.effects.push({ ...this.makeEffect(def), linkId });
          // 상대 말도 같은 동작을 하도록 연출만 걸어 둔다 (위치는 고른 말 쪽 효과가 함께 옮긴다)
          this.horse(linkId!).effects.push({ ...this.makeEffect(def), effectType: 'cosmetic', value: 0, linkId: h.info.id });
          break;
        }
        case 'cheer': {
          h.effects.push({ ...this.makeEffect(def), effectType: 'speedMult' });
          // 선두는 응원 소리에 집중이 흐트러진다 (비행 중이면 안 들리고, 방어막은 한 번 막아 준다)
          const leader = this.horse(this.currentRanking().find((x) => !this.horse(x).finished)!);
          if (leader !== h && !leader.effects.some((e) => e.effectType === 'fly')) {
            if (leader.shield > 0) {
              leader.shield--;
              blocked.push(leader.info.id);
            } else {
              leader.effects.push({ ...this.makeEffect(def), effectType: 'speedMult', value: -0.1, hostile: true, quiet: true, emoji: '🙉', anim: undefined });
              alsoHit.push(leader.info.id);
            }
          }
          break;
        }
        case 'carrotRod': {
          h.effects.push({ ...this.makeEffect(def), effectType: 'speedMult', afterStopMs: 800 });
          break;
        }
        case 'sneeze': {
          h.effects.push({ ...this.makeEffect(def), effectType: 'speedMult', relay: true });
          break;
        }
        case 'piggyback': {
          h.effects.push({ ...this.makeEffect(def), linkId });
          // 업혀 쉬는 동안 숨을 돌린다
          h.stamina = Math.min(h.staminaMax, h.stamina + h.staminaMax * 0.1);
          // 업은 말은 그동안 느려진다 (겉모습 연출은 없다)
          this.horse(linkId!).effects.push({ ...this.makeEffect(def), effectType: 'speedMult', value: def.value, hostile: true, quiet: true });
          break;
        }
        default: {
          // speedMult / weightMult / reverse
          h.effects.push(this.makeEffect(def));
        }
      }
      applied.push(id);
      // 함께 영향을 받은 말은 고른 말 뒤에 적는다 (첫 번째가 늘 카드의 주인공)
      applied.push(...alsoHit.splice(0));
      // 나란히 달리기는 상대 말도 함께 움직이므로 대상으로 알린다
      if ((def.effectType === 'pairUp' || def.effectType === 'piggyback') && linkId != null) applied.push(linkId);
    }

    if (applied.length === 0 && blocked.length === 0) {
      return {
        ok: false,
        targets: [],
        blocked: [],
        message: capped > 0 ? '같은 효과가 이미 최대로 걸려 있습니다.' : '카드를 쓸 수 있는 말이 없습니다.'
      };
    }
    return { ok: true, targets: applied, blocked };
  }

  /** 재채기가 끝나면 한 등수 뒤에서 달리는 말에게 같은 감속을 한 번 옮긴다 */
  private passSneeze(from: SimHorse, e: ActiveEffect): void {
    const order = this.currentRanking().filter((id) => !this.horse(id).finished);
    const next = order[order.indexOf(from.info.id) + 1];
    if (next == null) return;
    const h = this.horse(next);
    if (h.effects.some((x) => x.effectType === 'fly')) return;
    if (h.shield > 0) {
      h.shield--;
      return;
    }
    h.effects.push({ ...e, expiresAt: this.now + 2000, relay: false });
  }

  /** 능력치에 영향이 없는 연출 전용 표시 */
  private makeCosmetic(def: AugmentDefinition): ActiveEffect {
    return { ...this.makeEffect(def), effectType: 'cosmetic', value: 0, expiresAt: this.now + (def.visualMs ?? 0), anim: undefined };
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
        remainMs: Math.max(0, e.expiresAt - this.now),
        ...(e.linkId != null ? { link: e.linkId } : {}),
        ...(e.quiet ? { quiet: true } : {})
      })),
      shield: h.shield
    }));
  }
}

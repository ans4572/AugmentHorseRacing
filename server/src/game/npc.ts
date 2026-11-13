import type {
  AugmentDefinition,
  BetType,
  HorseInfo,
  NpcPersona,
  OddsTable
} from '../../../shared/src/types';
import { BET_MIN, NPC_BET_RATIO } from '../../../shared/src/constants';
import type { RaceSim } from '../sim/race';

export interface NpcBetChoice {
  type: BetType;
  horseId: number;
  amount: number;
}

/** 배팅할 때 NPC가 놓인 처지. 코인 순위와 마지막 라운드 여부에 따라 과감함이 달라진다 */
export interface NpcBetSituation {
  /** 코인 순위로 본 처지 */
  standing?: 'lead' | 'mid' | 'behind';
  finalRound?: boolean;
}

const BET_TYPES: BetType[] = ['winner', 'last', 'top3', 'bottom3'];

/** 성격별로 가진 코인 중 얼마까지 거는지 (기준 비율에 곱한다) */
const SPEND_SCALE: Record<NpcPersona, number> = {
  winner: 1,
  gambler: 1.5,
  saboteur: 1,
  avenger: 1.1,
  angel: 0.7,
  chaos: 1
};

/** 우승 배당이 낮은 순(=유력한 순)으로 말 ID 정렬 */
function favorites(horses: HorseInfo[], odds: OddsTable): number[] {
  return [...horses]
    .sort((a, b) => odds[a.id].winner - odds[b.id].winner)
    .map((h) => h.id);
}

function roundTo10(v: number): number {
  return Math.max(BET_MIN, Math.floor(v / 10) * 10);
}

/** [가중치, 값] 목록에서 가중치에 비례해 하나를 뽑는다 */
function pickWeighted<T>(options: [number, T][], rng: () => number): T {
  const total = options.reduce((s, [w]) => s + w, 0);
  let r = rng() * total;
  for (const [w, v] of options) {
    r -= w;
    if (r < 0) return v;
  }
  return options[options.length - 1][1];
}

/** 한 번의 배팅 계획: [종류, 말, 예산에서 차지하는 몫] */
type BetPlan = [BetType, number, number][];

function personaPlans(
  persona: NpcPersona,
  fav: number[],
  risk: number,
  rng: () => number
): [number, BetPlan][] {
  const n = fav.length;
  const top = fav[0];
  const second = fav[1];
  const third = fav[2];
  const mid = fav[Math.min(3, n - 1)];
  const weak = fav[n - 1];
  const weak2 = fav[n - 2];
  const any = () => fav[Math.floor(rng() * n)];
  // risk > 0 이면 배당 높은 쪽 계획이, risk < 0 이면 안전한 계획이 더 자주 뽑힌다
  const safe = Math.max(0.3, 1 - risk);
  const bold = Math.max(0.3, 1 + risk);

  switch (persona) {
    case 'winner':
      return [
        [5.5 * safe, [['winner', top, 1]]],
        [2.5 * safe, [['winner', top, 0.6], ['top3', second, 0.4]]],
        [2 * bold, [['winner', second, 1]]],
        [1 * bold, [['winner', third, 0.6], ['top3', top, 0.4]]]
      ];
    case 'gambler':
      return [
        [4 * bold, [['winner', weak, 1]]],
        [2.5, [['winner', weak2, 1]]],
        [2, [['winner', weak, 0.5], ['winner', mid, 0.5]]],
        [1.5 * bold, [['last', top, 1]]],
        [1.5 * safe, [['winner', third, 0.6], ['top3', weak, 0.4]]]
      ];
    case 'saboteur':
      return [
        [4, [['top3', top, 0.5], ['last', weak, 0.5]]],
        // 유력마가 무너지는 쪽에 걸고 직접 방해한다
        [3 * bold, [['bottom3', top, 1]]],
        [2, [['last', weak, 0.5], ['bottom3', weak2, 0.5]]],
        [1.5 * bold, [['bottom3', top, 0.6], ['bottom3', second, 0.4]]]
      ];
    case 'avenger':
      return [
        // 선두를 끌어내리면 이기는 자리에 건다
        [4.5, [['winner', second, 1]]],
        [3 * bold, [['winner', third, 1]]],
        [2.5 * safe, [['top3', second, 0.5], ['top3', third, 0.5]]],
        [1.5, [['winner', top, 1]]]
      ];
    case 'angel':
      return [
        [4.5, [['top3', weak, 1]]],
        [3, [['top3', weak, 0.5], ['top3', weak2, 0.5]]],
        [2.5 * safe, [['top3', mid, 1]]],
        [1 * bold, [['winner', weak2, 1]]]
      ];
    case 'chaos': {
      const count = 1 + Math.floor(rng() * 3);
      const plan: BetPlan = [];
      for (let i = 0; i < count; i++) plan.push([BET_TYPES[Math.floor(rng() * 4)], any(), 1 / count]);
      return [[1, plan]];
    }
  }
}

/** NPC 배팅 결정 — 성격마다 계획이 여럿이고, 코인 순위에 따라 과감함이 달라진다. */
export function npcChooseBets(
  persona: NpcPersona,
  coins: number,
  horses: HorseInfo[],
  odds: OddsTable,
  rng: () => number = Math.random,
  situation: NpcBetSituation = {}
): NpcBetChoice[] {
  // 뒤처졌으면 크게, 앞서면 조심스럽게. 마지막 라운드에는 그 차이가 더 벌어진다
  let risk = 0;
  if (situation.standing === 'behind') risk = situation.finalRound ? 0.8 : 0.4;
  if (situation.standing === 'lead') risk = situation.finalRound ? -0.6 : -0.3;

  let ratio = NPC_BET_RATIO * SPEND_SCALE[persona] * (1 + risk * 0.6);
  if (persona === 'chaos') ratio = NPC_BET_RATIO * (0.4 + rng() * 1.6);
  const limit = Math.floor(coins * Math.min(0.85, ratio));
  if (limit < BET_MIN) return [];
  const fav = favorites(horses, odds);

  const spendRatio = 0.5 + rng() * 0.5; // 한도의 50~100% 사용
  const budget = roundTo10(limit * spendRatio);

  // 10% 확률로 완전 랜덤 배팅 (비효율 허용)
  if (rng() < 0.1) {
    return [{ type: BET_TYPES[Math.floor(rng() * 4)], horseId: fav[Math.floor(rng() * fav.length)], amount: budget }];
  }

  const plan = pickWeighted(personaPlans(persona, fav, risk, rng), rng);
  const out: NpcBetChoice[] = [];
  let left = budget;
  plan.forEach(([type, horseId, share], i) => {
    const amount = i === plan.length - 1 ? Math.floor(left / 10) * 10 : roundTo10(budget * share);
    if (amount < BET_MIN || amount > left) return;
    // 같은 말에 같은 종류를 두 번 걸게 되면 하나로 합친다
    const same = out.find((b) => b.type === type && b.horseId === horseId);
    if (same) same.amount += amount;
    else out.push({ type, horseId, amount });
    left -= amount;
  });
  if (out.length === 0) out.push({ type: plan[0][0], horseId: plan[0][1], amount: budget });
  return out;
}

export interface NpcAugmentChoice {
  index: number; // 손패 내 카드 인덱스
  targetHorseId?: number;
  /** 가장 좋은 카드의 점수. 낮으면 손패가 나쁘다는 뜻이다 */
  bestScore: number;
  /** 점수가 가장 낮은 카드. 새로고침할 후보 */
  worstIndex: number;
}

export interface NpcAugmentContext {
  sim: RaceSim;
  /** 이 NPC가 배팅한 말 ID 목록 (우승/top3 기준) */
  myBoostTargets: number[];
  /** 이 NPC의 꼴찌/bottom3 배팅 대상 */
  myHinderTargets: number[];
  /** 이 NPC의 배팅 전부. 있으면 종류와 지금 순위까지 따져서 고른다 */
  myBets?: { type: BetType; horseId: number }[];
  /** 전체 배팅금이 가장 많은 말 */
  mostBetHorse: number | null;
  /** 플레이어가 직접 출전시킨 말 (싱글 모드). 앞서 달리면 NPC가 견제한다 */
  ownerHorse?: number | null;
}

/** 내 말이 이 순위 안에 있을 때만 NPC가 견제한다 */
const OWNER_GUARD_RANK = 2;

function ownerHorseAhead(ctx: NpcAugmentContext, unfinished: number[]): number | null {
  const id = ctx.ownerHorse;
  if (id == null || !unfinished.includes(id)) return null;
  const rank = ctx.sim.currentRanking().indexOf(id) + 1;
  return rank >= 1 && rank <= OWNER_GUARD_RANK ? id : null;
}

/**
 * 말마다 "빨라졌으면 하는 정도"를 매긴다. 양수면 빨라지길, 음수면 느려지길 바란다.
 * 내가 건 말뿐 아니라, 그 배팅이 맞으려면 비켜 줘야 하는 말도 함께 따진다.
 */
function computeWants(ctx: NpcAugmentContext, ranking: number[]): Map<number, number> {
  const bets =
    ctx.myBets ??
    [
      ...ctx.myBoostTargets.map((horseId) => ({ type: 'winner' as BetType, horseId })),
      ...ctx.myHinderTargets.map((horseId) => ({ type: 'last' as BetType, horseId }))
    ];
  const want = new Map<number, number>();
  const add = (id: number | undefined, v: number) => {
    if (id != null) want.set(id, (want.get(id) ?? 0) + v);
  };
  const last = ranking.length;
  for (const b of bets) {
    const r = ranking.indexOf(b.horseId) + 1;
    if (r < 1) continue;
    switch (b.type) {
      case 'winner':
        add(b.horseId, r === 1 ? 3 : r <= 3 ? 4 : 2.5);
        // 앞에 있는 말이 느려져야 이긴다
        for (let i = 0; i < r - 1; i++) add(ranking[i], i === 0 ? -3 : -1.5);
        break;
      case 'top3':
        add(b.horseId, r <= 3 ? 2.5 : r === 4 ? 4 : 3);
        if (r > 3) add(ranking[2], -2.5);
        if (r === 3) add(ranking[3], -1.5);
        break;
      case 'last':
        add(b.horseId, r === last ? -2.5 : r === last - 1 ? -4 : -2.5);
        // 뒤에 있는 말이 앞질러 줘야 꼴찌가 된다
        for (let i = r; i < last; i++) add(ranking[i], i === last - 1 ? 2.5 : 1.5);
        break;
      case 'bottom3':
        add(b.horseId, r >= 4 ? -2.5 : r === 3 ? -4 : -3);
        if (r <= 3) add(ranking[3], 2);
        if (r === 4) add(ranking[2], 1.5);
        break;
    }
  }
  return want;
}

interface TargetPick {
  horseId: number | undefined;
  /** 이 대상에게 썼을 때 내 배팅에 주는 이득 */
  gain: number;
}

/** 대상을 한 마리 고르는 카드의 대상 선택. 내가 건 말을 방해하거나 지길 바라는 말을 돕지 않는다 */
function pickSingleTarget(
  def: AugmentDefinition,
  persona: NpcPersona,
  ctx: NpcAugmentContext,
  want: Map<number, number>,
  rng: () => number
): TargetPick {
  if (def.targetType !== 'single') return { horseId: undefined, gain: 0 };
  const unfinished = ctx.sim.horses.filter((h) => !h.finished).map((h) => h.info.id);
  if (unfinished.length === 0) return { horseId: undefined, gain: 0 };
  const ranking = ctx.sim.currentRanking().filter((id) => unfinished.includes(id));
  const sign = def.hostile ? -1 : 1;
  const w = (id: number) => want.get(id) ?? 0;
  // 방해 카드는 내가 밀어주는 말을, 도움 카드는 내가 지길 바라는 말을 대상에서 뺀다
  const allowed = ranking.filter((id) => sign * w(id) >= 0);
  if (allowed.length === 0) {
    const least = [...ranking].sort((a, b) => sign * w(b) - sign * w(a))[0];
    return { horseId: least, gain: -6 };
  }

  if (def.hostile) {
    // 플레이어의 말이 선두권이면 35% 확률로 노린다 (자기가 건 말이면 봐준다)
    const ownerAhead = ownerHorseAhead(ctx, unfinished);
    if (ownerAhead != null && allowed.includes(ownerAhead) && w(ownerAhead) <= 0 && rng() < 0.35) {
      return { horseId: ownerAhead, gain: -w(ownerAhead) };
    }
  }

  const leader = ranking[0];
  const tail = ranking[ranking.length - 1];
  let best = allowed[0];
  let bestValue = -Infinity;
  for (const id of allowed) {
    let v = sign * w(id) + rng();
    if (def.hostile) {
      if (id === leader) v += persona === 'avenger' ? 4.5 : 1.5;
      if (id === ctx.mostBetHorse) v += persona === 'saboteur' ? 4 : 1;
    } else {
      if (id === tail) v += persona === 'angel' ? 3 : 0.5;
    }
    if (v > bestValue) {
      bestValue = v;
      best = id;
    }
  }
  return { horseId: best, gain: sign * w(best) };
}

/** 성격별 고르는 폭. 클수록 점수가 낮은 카드도 자주 고른다 */
const CHOICE_SPREAD: Record<NpcPersona, number> = {
  winner: 1.2,
  saboteur: 1.4,
  avenger: 1.4,
  gambler: 2.2,
  angel: 1.4,
  chaos: 3.5
};

/** NPC 증강 카드 선택 — 내 배팅과 지금 순위로 점수를 매기고, 점수에 비례한 확률로 고른다 */
export function npcChooseAugment(
  persona: NpcPersona,
  hand: AugmentDefinition[],
  ctx: NpcAugmentContext,
  rng: () => number = Math.random
): NpcAugmentChoice | null {
  if (hand.length === 0) return null;
  const fullRanking = ctx.sim.currentRanking();
  const unfinished = ctx.sim.horses.filter((h) => !h.finished).map((h) => h.info.id);
  if (unfinished.length === 0) return null;
  const leader = fullRanking.find((id) => unfinished.includes(id)) ?? null;
  const want = computeWants(ctx, fullRanking);
  const ownerAhead = ownerHorseAhead(ctx, unfinished);

  const picks: TargetPick[] = [];
  const scores = hand.map((def, idx) => {
    let score = rng() * 2; // 소량의 랜덤성
    const sign = def.hostile ? -1 : 1;
    const pick = pickSingleTarget(def, persona, ctx, want, rng);
    picks[idx] = pick;

    const targets =
      def.targetType === 'single'
        ? pick.horseId != null ? [pick.horseId] : []
        : ctx.sim.resolveTargets(def, {}).filter((id) => unfinished.includes(id));
    const gain =
      def.targetType === 'single'
        ? pick.gain
        : targets.reduce((s, id) => s + sign * (want.get(id) ?? 0), 0);
    score += Math.max(-9, Math.min(9, gain * 1.3));

    const helpsMine = !def.hostile && targets.some((id) => (want.get(id) ?? 0) > 0);
    const hitsLeader = def.hostile && leader != null && targets.includes(leader);
    const hitsPopular = def.hostile && ctx.mostBetHorse != null && targets.includes(ctx.mostBetHorse);

    // 플레이어의 말이 선두권이면 방해 카드를 조금 더 선호한다 (자기가 밀어주는 말이 아닐 때만)
    if (
      def.hostile &&
      ownerAhead != null &&
      (def.targetType === 'single' || targets.includes(ownerAhead)) &&
      (want.get(ownerAhead) ?? 0) <= 0
    ) {
      score += 2.5;
    }

    switch (persona) {
      case 'winner':
        if (helpsMine) score += 3;
        if (def.hostile && def.targetType === 'single') score += 1.5; // 경쟁마 방해
        break;
      case 'saboteur':
        if (hitsPopular) score += 5;
        if (def.hostile) score += 3;
        break;
      case 'avenger':
        if (hitsLeader) score += 5;
        if (def.hostile) score += 2;
        break;
      case 'gambler':
        if (def.rarity === 'legendary') score += 6;
        if (def.rarity === 'epic') score += 3;
        break;
      case 'angel':
        if (!def.hostile) score += 4;
        if (def.targetType === 'back3' || def.targetType === 'rank6' || def.targetType === 'slowest2') score += 3;
        break;
      case 'chaos':
        if (def.effectType === 'swapPositions' || def.effectType === 'teleport') score += 7;
        if (def.value >= 0.4 || def.value <= -0.4) score += 3;
        break;
    }
    return score;
  });

  let bestIdx = 0;
  let worstIdx = 0;
  scores.forEach((s, i) => {
    if (s > scores[bestIdx]) bestIdx = i;
    if (s < scores[worstIdx]) worstIdx = i;
  });

  // 점수가 높을수록 자주 고르되 늘 같은 카드만 고르지는 않는다. 10%는 아무 카드나 고른다
  let index: number;
  if (rng() < 0.1) {
    index = Math.floor(rng() * hand.length);
  } else {
    const spread = CHOICE_SPREAD[persona];
    index = pickWeighted(
      scores.map((s, i) => [Math.exp((s - scores[bestIdx]) / spread), i] as [number, number]),
      rng
    );
  }

  return {
    index,
    targetHorseId: picks[index].horseId,
    bestScore: scores[bestIdx],
    worstIndex: worstIdx
  };
}

import type {
  AugmentDefinition,
  Bet,
  BetType,
  HorseInfo,
  NpcPersona,
  OddsTable
} from '../../../shared/src/types';
import { BET_MIN } from '../../../shared/src/constants';
import { betLimit } from './betting';
import type { RaceSim } from '../sim/race';

export interface NpcBetChoice {
  type: BetType;
  horseId: number;
  amount: number;
}

/** 우승 배당이 낮은 순(=유력한 순)으로 말 ID 정렬 */
function favorites(horses: HorseInfo[], odds: OddsTable): number[] {
  return [...horses]
    .sort((a, b) => odds[a.id].winner - odds[b.id].winner)
    .map((h) => h.id);
}

function roundTo10(v: number): number {
  return Math.max(BET_MIN, Math.floor(v / 10) * 10);
}

/** NPC 배팅 결정 — 성격별 선호가 다르며, 일정 확률로 비효율적 선택을 한다. */
export function npcChooseBets(
  persona: NpcPersona,
  coins: number,
  horses: HorseInfo[],
  odds: OddsTable,
  rng: () => number = Math.random
): NpcBetChoice[] {
  const limit = betLimit(coins);
  if (limit < BET_MIN) return [];
  const fav = favorites(horses, odds);
  const randomHorse = () => horses[Math.floor(rng() * horses.length)].id;

  const spendRatio = 0.5 + rng() * 0.5; // 한도의 50~100% 사용
  const budget = roundTo10(limit * spendRatio);

  // 15% 확률로 완전 랜덤 배팅 (비효율 허용)
  if (rng() < 0.15) {
    const types: BetType[] = ['winner', 'last', 'top3', 'bottom3'];
    return [{ type: types[Math.floor(rng() * 4)], horseId: randomHorse(), amount: budget }];
  }

  switch (persona) {
    case 'winner':
      // 유력마 우승 배팅
      return [{ type: 'winner', horseId: fav[0], amount: budget }];
    case 'gambler':
      // 배당 높은 말에 우승 배팅
      return [{ type: 'winner', horseId: fav[fav.length - 1], amount: budget }];
    case 'saboteur': {
      // 유력마 TOP3에 절반, 비유력마 꼴찌에 절반
      const half = roundTo10(budget / 2);
      const rest = budget - half;
      const out: NpcBetChoice[] = [{ type: 'top3', horseId: fav[0], amount: half }];
      if (rest >= BET_MIN) out.push({ type: 'last', horseId: fav[fav.length - 1], amount: rest });
      return out;
    }
    case 'avenger':
      // 상위 유력 2마리 중 하나에 우승 배팅
      return [{ type: 'winner', horseId: fav[rng() < 0.5 ? 0 : 1], amount: budget }];
    case 'angel':
      // 약한 말의 TOP3 역전 기원
      return [{ type: 'top3', horseId: fav[fav.length - 1], amount: budget }];
    case 'chaos': {
      const types: BetType[] = ['winner', 'last', 'top3', 'bottom3'];
      return [{ type: types[Math.floor(rng() * 4)], horseId: randomHorse(), amount: budget }];
    }
  }
}

export interface NpcAugmentChoice {
  index: number; // 손패 내 카드 인덱스
  targetHorseId?: number;
}

export interface NpcAugmentContext {
  sim: RaceSim;
  /** 이 NPC가 배팅한 말 ID 목록 (우승/top3 기준) */
  myBoostTargets: number[];
  /** 이 NPC의 꼴찌/bottom3 배팅 대상 */
  myHinderTargets: number[];
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

/** NPC 증강 카드 선택 — 성격별 가중 점수로 결정 */
export function npcChooseAugment(
  persona: NpcPersona,
  hand: AugmentDefinition[],
  ctx: NpcAugmentContext,
  rng: () => number = Math.random
): NpcAugmentChoice | null {
  if (hand.length === 0) return null;
  const ranking = ctx.sim.currentRanking();
  const unfinished = ctx.sim.horses.filter((h) => !h.finished).map((h) => h.info.id);
  if (unfinished.length === 0) return null;
  const leader = ranking.find((id) => unfinished.includes(id)) ?? null;

  // 10% 확률로 완전 랜덤 (비효율 허용)
  if (rng() < 0.1) {
    const idx = Math.floor(rng() * hand.length);
    return { index: idx, targetHorseId: pickSingleTarget(hand[idx], ctx, rng) };
  }

  const ownerAhead = ownerHorseAhead(ctx, unfinished);
  let bestIdx = 0;
  let bestScore = -Infinity;
  hand.forEach((def, idx) => {
    let score = rng() * 2; // 소량의 랜덤성

    const groupTargets =
      def.targetType === 'single' ? unfinished : ctx.sim.resolveTargets(def, {});
    const helpsMine =
      !def.hostile && ctx.myBoostTargets.some((id) => groupTargets.includes(id));
    const hurtsMine =
      def.hostile && ctx.myBoostTargets.some((id) => groupTargets.includes(id)) &&
      def.targetType !== 'single';
    const hitsLeader = def.hostile && leader != null && groupTargets.includes(leader);
    const hitsPopular =
      def.hostile && ctx.mostBetHorse != null && groupTargets.includes(ctx.mostBetHorse);

    if (helpsMine) score += 5;
    if (hurtsMine) score -= 6;
    // 플레이어의 말이 선두권이면 방해 카드를 조금 더 선호한다 (자기 배팅마가 아닐 때만)
    if (
      def.hostile &&
      ownerAhead != null &&
      groupTargets.includes(ownerAhead) &&
      !ctx.myBoostTargets.includes(ownerAhead)
    ) {
      score += 2.5;
    }

    switch (persona) {
      case 'winner':
        if (helpsMine) score += 4;
        if (def.hostile && def.targetType === 'single') score += 2; // 경쟁마 방해
        break;
      case 'saboteur':
        if (hitsPopular) score += 6;
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

    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  return {
    index: bestIdx,
    targetHorseId: pickSingleTarget(hand[bestIdx], ctx, rng)
  };
}

function pickSingleTarget(
  def: AugmentDefinition,
  ctx: NpcAugmentContext,
  rng: () => number
): number | undefined {
  if (def.targetType !== 'single') return undefined;
  const unfinished = ctx.sim.horses.filter((h) => !h.finished).map((h) => h.info.id);
  if (unfinished.length === 0) return undefined;
  const ranking = ctx.sim.currentRanking().filter((id) => unfinished.includes(id));

  if (!def.hostile) {
    // 강화: 내 배팅마 우선
    const mine = ctx.myBoostTargets.filter((id) => unfinished.includes(id));
    if (mine.length > 0) return mine[Math.floor(rng() * mine.length)];
    return ranking[ranking.length - 1]; // 없으면 꼴찌 응원
  }
  // 플레이어의 말이 선두권이면 35% 확률로 노린다 (자기가 건 말이면 봐준다)
  const ownerAhead = ownerHorseAhead(ctx, unfinished);
  if (ownerAhead != null && !ctx.myBoostTargets.includes(ownerAhead) && rng() < 0.35) {
    return ownerAhead;
  }
  // 방해: 인기마 > 선두 > 내 꼴찌 배팅마
  if (ctx.mostBetHorse != null && unfinished.includes(ctx.mostBetHorse) && rng() < 0.5) {
    return ctx.mostBetHorse;
  }
  const hinder = ctx.myHinderTargets.filter((id) => unfinished.includes(id));
  if (hinder.length > 0 && rng() < 0.5) return hinder[Math.floor(rng() * hinder.length)];
  return ranking[0];
}

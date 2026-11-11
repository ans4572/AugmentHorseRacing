import type { AugmentDefinition, AugmentTier, Rarity } from '../../../shared/src/types';
import { AUGMENTS } from '../../../shared/src/augments';
import {
  CARDS_PER_PHASE,
  PHASE_TIER_WEIGHTS,
  RARITY_WEIGHTS,
  TIER_FALLBACK,
  TIER_OF_RARITY
} from '../../../shared/src/constants';
import type { BetTotals, RaceSim } from '../sim/race';

export function tierOf(def: AugmentDefinition): AugmentTier {
  return TIER_OF_RARITY[def.rarity];
}

/**
 * 증강 구간의 등급을 추첨한다. 한 구간에 한 번만 뽑아 모든 플레이어가 같은 등급을 받는다.
 * 뒤 구간일수록 높은 등급이 잘 나온다 (PHASE_TIER_WEIGHTS).
 */
export function rollTier(phase: number, rng: () => number = Math.random): AugmentTier {
  const weights = PHASE_TIER_WEIGHTS[phase] ?? PHASE_TIER_WEIGHTS[1];
  const tiers = Object.keys(weights) as AugmentTier[];
  const total = tiers.reduce((s, t) => s + weights[t], 0);
  let roll = rng() * total;
  for (const t of tiers) {
    roll -= weights[t];
    if (roll < 0) return t;
  }
  return tiers[tiers.length - 1];
}

/**
 * 한 플레이어에게 제시할 증강 카드 3장을 뽑는다.
 * - 주어진 등급 안에서만 뽑는다 (등급은 전원 공통, 카드는 플레이어마다 다름)
 * - 해당 구간에서 허용되는 카드만
 * - 뽑는 시점에 유효한 대상이 존재하는 카드만
 * - 한 손패 안에서는 중복 없음
 * - 등급 안에 뽑을 카드가 모자라면 가까운 등급에서 채운다
 */
export function drawCards(
  sim: RaceSim,
  phase: number,
  tier: AugmentTier,
  bets: BetTotals,
  rng: () => number = Math.random
): AugmentDefinition[] {
  const hasUnfinished = sim.horses.some((h) => !h.finished);
  const valid = AUGMENTS.filter((def) => {
    if (!def.allowedPhases.includes(phase)) return false;
    if (def.targetType === 'single') return hasUnfinished;
    return sim.resolveTargets(def, { bets }).length > 0;
  });

  const hand: AugmentDefinition[] = [];
  for (const t of [tier, ...TIER_FALLBACK[tier]]) {
    const pool = valid.filter((d) => tierOf(d) === t);
    let guard = 0;
    while (hand.length < CARDS_PER_PHASE && guard++ < 100) {
      const candidates = pool.filter((d) => !hand.some((h) => h.id === d.id));
      if (candidates.length === 0) break;

      // 등급 안에서도 희귀도 가중치를 유지한다 (플래티넘에서 전설이 영웅보다 드물게)
      const rarities = [...new Set(candidates.map((c) => c.rarity))];
      const totalWeight = rarities.reduce((s, r) => s + RARITY_WEIGHTS[r], 0);
      let roll = rng() * totalWeight;
      let chosen: Rarity = rarities[0];
      for (const r of rarities) {
        roll -= RARITY_WEIGHTS[r];
        if (roll <= 0) {
          chosen = r;
          break;
        }
      }
      const ofRarity = candidates.filter((c) => c.rarity === chosen);
      hand.push(ofRarity[Math.floor(rng() * ofRarity.length)]);
    }
    if (hand.length >= CARDS_PER_PHASE) break;
  }
  return hand;
}

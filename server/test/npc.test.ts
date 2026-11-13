import { describe, expect, it } from 'vitest';
import { AUGMENTS } from '../../shared/src/augments';
import type { BetType, NpcPersona } from '../../shared/src/types';
import { BET_MIN } from '../../shared/src/constants';
import { generateHorses } from '../src/sim/horses';
import { computeOdds } from '../src/game/odds';
import { RaceSim } from '../src/sim/race';
import { mulberry32 } from '../src/sim/rng';
import { npcChooseAugment, npcChooseBets } from '../src/game/npc';

const PERSONAS: NpcPersona[] = ['winner', 'saboteur', 'avenger', 'gambler', 'angel', 'chaos'];
const SINGLE_HOSTILE = AUGMENTS.filter((a) => a.targetType === 'single' && a.hostile);
const SINGLE_FRIENDLY = AUGMENTS.filter((a) => a.targetType === 'single' && !a.hostile);

function midRace(seed: number): RaceSim {
  const sim = new RaceSim(generateHorses(mulberry32(seed)), mulberry32(seed + 1));
  for (let i = 0; i < 120; i++) sim.tick(50);
  return sim;
}

describe('NPC 증강 대상', () => {
  it('방해 카드를 자기가 우승이나 1~3위로 건 말에 쓰지 않는다', () => {
    expect(SINGLE_HOSTILE.length).toBeGreaterThan(0);
    const rng = mulberry32(11);
    for (const persona of PERSONAS) {
      for (let seed = 1; seed <= 6; seed++) {
        const sim = midRace(seed);
        const ranking = sim.currentRanking();
        // 선두이면서 배팅금도 가장 몰린 말에 걸었다: 예전에는 여기서 자기 말을 방해했다
        const mine = ranking[0];
        for (const type of ['winner', 'top3'] as BetType[]) {
          for (let i = 0; i < 60; i++) {
            const def = SINGLE_HOSTILE[i % SINGLE_HOSTILE.length];
            const c = npcChooseAugment(persona, [def], {
              sim, myBoostTargets: [mine], myHinderTargets: [], myBets: [{ type, horseId: mine }],
              mostBetHorse: mine, ownerHorse: null
            }, rng);
            expect(c?.targetHorseId).not.toBe(mine);
          }
        }
      }
    }
  });

  it('도움 카드를 자기가 꼴찌나 4~6위로 건 말에 쓰지 않는다', () => {
    expect(SINGLE_FRIENDLY.length).toBeGreaterThan(0);
    const rng = mulberry32(12);
    for (const persona of PERSONAS) {
      for (let seed = 1; seed <= 6; seed++) {
        const sim = midRace(seed);
        const ranking = sim.currentRanking();
        const mine = ranking[ranking.length - 1]; // 지금 꼴찌: 예전에는 "꼴찌 응원"으로 도왔다
        for (const type of ['last', 'bottom3'] as BetType[]) {
          for (let i = 0; i < 60; i++) {
            const def = SINGLE_FRIENDLY[i % SINGLE_FRIENDLY.length];
            const c = npcChooseAugment(persona, [def], {
              sim, myBoostTargets: [], myHinderTargets: [mine], myBets: [{ type, horseId: mine }],
              mostBetHorse: null, ownerHorse: null
            }, rng);
            expect(c?.targetHorseId).not.toBe(mine);
          }
        }
      }
    }
  });

  it('꼴찌로 건 말이 4등이면 그 말을 방해하거나 뒤의 말을 돕는다', () => {
    const rng = mulberry32(13);
    const sim = midRace(3);
    const ranking = sim.currentRanking();
    const mine = ranking[3];
    const behind = ranking.slice(4);
    let useful = 0;
    const trials = 400;
    for (let i = 0; i < trials; i++) {
      const hand = [SINGLE_HOSTILE[i % SINGLE_HOSTILE.length], SINGLE_FRIENDLY[i % SINGLE_FRIENDLY.length]];
      const c = npcChooseAugment('winner', hand, {
        sim, myBoostTargets: [], myHinderTargets: [mine], myBets: [{ type: 'last', horseId: mine }],
        mostBetHorse: null, ownerHorse: null
      }, rng)!;
      const def = hand[c.index];
      if (def.hostile ? c.targetHorseId === mine : behind.includes(c.targetHorseId!)) useful++;
    }
    expect(useful / trials).toBeGreaterThan(0.8);
  });
});

describe('NPC 배팅', () => {
  const horses = generateHorses(mulberry32(21));
  const odds = computeOdds(horses);

  it('금액은 최소 금액 이상이고 합계가 가진 코인을 넘지 않는다', () => {
    const rng = mulberry32(31);
    for (const persona of PERSONAS) {
      for (const standing of ['lead', 'mid', 'behind'] as const) {
        for (let i = 0; i < 200; i++) {
          const coins = 100 + Math.floor(rng() * 3000);
          const bets = npcChooseBets(persona, coins, horses, odds, rng, { standing, finalRound: i % 2 === 0 });
          let total = 0;
          for (const b of bets) {
            expect(Number.isInteger(b.amount)).toBe(true);
            expect(b.amount).toBeGreaterThanOrEqual(BET_MIN);
            total += b.amount;
          }
          expect(total).toBeLessThanOrEqual(coins);
        }
      }
    }
  });

  it('같은 성격이라도 여러 가지로 건다', () => {
    const rng = mulberry32(32);
    for (const persona of PERSONAS) {
      const seen = new Set<string>();
      for (let i = 0; i < 300; i++) {
        const bets = npcChooseBets(persona, 1000, horses, odds, rng);
        seen.add(bets.map((b) => `${b.type}:${b.horseId}`).sort().join('+'));
      }
      expect(seen.size).toBeGreaterThanOrEqual(4);
    }
  });

  it('마지막 라운드에 뒤처지면 앞설 때보다 많이 건다', () => {
    const avg = (standing: 'lead' | 'behind') => {
      const rng = mulberry32(33);
      let sum = 0;
      for (let i = 0; i < 500; i++) {
        sum += npcChooseBets('winner', 1000, horses, odds, rng, { standing, finalRound: true })
          .reduce((s, b) => s + b.amount, 0);
      }
      return sum / 500;
    };
    expect(avg('behind')).toBeGreaterThan(avg('lead') * 1.5);
  });
});

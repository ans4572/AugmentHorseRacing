import { describe, expect, it } from 'vitest';
import type { HorseInfo } from '../../shared/src/types';
import { AUGMENT_BY_ID, AUGMENTS } from '../../shared/src/augments';
import { COURSE_LENGTH, MAX_STACKS_PER_CARD, PHASE_TIER_WEIGHTS } from '../../shared/src/constants';
import { RaceSim } from '../src/sim/race';
import { mulberry32 } from '../src/sim/rng';
import { drawCards, rollTier, tierOf } from '../src/game/deck';

function makeHorse(id: number, speed = 50, accel = 50, stamina = 50, weight = 500): HorseInfo {
  return { id, name: `말${id}`, color: '#fff', breed: 'horse', stats: { speed, accel, stamina, weight, luck: 50 } };
}

function sixHorses(): HorseInfo[] {
  return [1, 2, 3, 4, 5, 6].map((id) => makeHorse(id));
}

function setPositions(sim: RaceSim, positions: Record<number, number>): void {
  for (const [id, pos] of Object.entries(positions)) {
    sim.horse(Number(id)).pos = pos;
  }
}

describe('증강 대상 판정', () => {
  it('홀수 카드는 1·3·5번만 대상으로 한다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    const targets = sim.resolveTargets(AUGMENT_BY_ID['odd_bless'], {});
    expect(targets.sort()).toEqual([1, 3, 5]);
  });

  it('짝수 카드는 2·4·6번만 대상으로 한다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    const targets = sim.resolveTargets(AUGMENT_BY_ID['even_curse'], {});
    expect(targets.sort()).toEqual([2, 4, 6]);
  });

  it('선두권/하위권은 현재 순위 기준이다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    setPositions(sim, { 1: 100, 2: 600, 3: 300, 4: 500, 5: 200, 6: 400 });
    const front = sim.resolveTargets(AUGMENT_BY_ID['front_check'], {});
    expect(front.sort()).toEqual([2, 4, 6]); // 600, 500, 400
    const back = sim.resolveTargets(AUGMENT_BY_ID['back_rebellion'], {});
    expect(back.sort()).toEqual([1, 3, 5]);
  });

  it('완주한 말은 그룹 대상에서 자동 제외된다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    const h1 = sim.horse(1);
    h1.finished = true;
    h1.finishTime = 1000;
    h1.pos = COURSE_LENGTH;
    const odd = sim.resolveTargets(AUGMENT_BY_ID['odd_bless'], {});
    expect(odd.sort()).toEqual([3, 5]);
    const single = sim.resolveTargets(AUGMENT_BY_ID['rocket_booster'], { targetHorseId: 1 });
    expect(single).toEqual([]);
  });

  it('능력치 동률이면 말 ID 오름차순으로 선정한다', () => {
    const horses = [
      makeHorse(1, 70), makeHorse(2, 70), makeHorse(3, 70),
      makeHorse(4, 30), makeHorse(5, 30), makeHorse(6, 50)
    ];
    const sim = new RaceSim(horses, mulberry32(1));
    const fastest = sim.resolveTargets(AUGMENT_BY_ID['catch_fast'], {});
    expect(fastest).toEqual([1, 2]);
    const slowest = sim.resolveTargets(AUGMENT_BY_ID['slow_cheer'], {});
    expect(slowest).toEqual([4, 5]);
  });

  it('우승 배팅금 최다/최소 말을 찾는다 (배팅 없으면 0으로 간주, 동률은 낮은 ID)', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    const bets = { win: new Map([[3, 500], [5, 100]]), total: new Map() };
    expect(sim.resolveTargets(AUGMENT_BY_ID['popular_tragedy'], { bets })).toEqual([3]);
    // 최소: 1,2,4,6이 모두 0 → 가장 낮은 ID인 1
    expect(sim.resolveTargets(AUGMENT_BY_ID['unpopular_rebellion'], { bets })).toEqual([1]);
  });
});

describe('증강 효과 적용', () => {
  it('속력 증가 효과가 적용되고 지속시간 후 만료된다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    const result = sim.applyAugment(AUGMENT_BY_ID['rocket_booster'], { targetHorseId: 2 });
    expect(result.ok).toBe(true);
    expect(result.targets).toEqual([2]);
    expect(sim.horse(2).effects).toHaveLength(1);
    // 4초 경과 후 만료
    for (let i = 0; i < 85; i++) sim.tick(50);
    expect(sim.horse(2).effects).toHaveLength(0);
  });

  it('동일 카드는 최대 중첩 수를 넘지 않는다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    for (let i = 0; i < 4; i++) {
      sim.applyAugment(AUGMENT_BY_ID['rocket_booster'], { targetHorseId: 1 });
    }
    const stacks = sim.horse(1).effects.filter((e) => e.defId === 'rocket_booster').length;
    expect(stacks).toBe(MAX_STACKS_PER_CARD);
  });

  it('정지 효과 중에는 이동하지 않고, 정지 지속시간은 합산되지 않는다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    const h = sim.horse(1);
    h.pos = 100;
    sim.applyAugment(AUGMENT_BY_ID['mukbang'], { targetHorseId: 1 }); // 2초 정지
    sim.applyAugment(AUGMENT_BY_ID['sudden_sleep'], { targetHorseId: 1 }); // 1.5초 정지 — 합산 X
    const stopEffects = h.effects.filter((e) => e.effectType === 'stop');
    expect(stopEffects).toHaveLength(1);
    expect(stopEffects[0].expiresAt).toBe(2000); // max(2000, 1500)
    sim.tick(50);
    expect(h.pos).toBe(100); // 정지 중 이동 없음
  });

  it('방어막은 다음 방해 증강 1회를 무효화한다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    sim.applyAugment(AUGMENT_BY_ID['shield'], { targetHorseId: 4 });
    expect(sim.horse(4).shield).toBe(1);
    const result = sim.applyAugment(AUGMENT_BY_ID['banana_peel'], { targetHorseId: 4 });
    expect(result.blocked).toEqual([4]);
    expect(sim.horse(4).shield).toBe(0);
    expect(sim.horse(4).effects).toHaveLength(0);
    // 두 번째 방해는 적용됨
    const second = sim.applyAugment(AUGMENT_BY_ID['banana_peel'], { targetHorseId: 4 });
    expect(second.targets).toEqual([4]);
  });

  it('비행 중에는 방해 면역이고, 비행 시작 시 기존 방해가 해제된다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    sim.applyAugment(AUGMENT_BY_ID['leg_tangle'], { targetHorseId: 2 });
    expect(sim.horse(2).effects.some((e) => e.hostile)).toBe(true);
    sim.applyAugment(AUGMENT_BY_ID['angel_wings'], { targetHorseId: 2 });
    expect(sim.horse(2).effects.some((e) => e.hostile)).toBe(false);
    const result = sim.applyAugment(AUGMENT_BY_ID['poop_signal'], { targetHorseId: 2 });
    expect(result.blocked).toEqual([2]);
  });

  it('순간이동은 코스의 3%를 즉시 전진하고 결승선 도달 시 완주 처리한다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    sim.horse(1).pos = 100;
    sim.applyAugment(AUGMENT_BY_ID['teleport'], { targetHorseId: 1 });
    expect(sim.horse(1).pos).toBe(100 + COURSE_LENGTH * 0.03);
    // 결승선 직전에서 순간이동 → 완주
    sim.horse(2).pos = COURSE_LENGTH - 5;
    sim.applyAugment(AUGMENT_BY_ID['teleport'], { targetHorseId: 2 });
    expect(sim.horse(2).finished).toBe(true);
    expect(sim.horse(2).pos).toBe(COURSE_LENGTH);
  });

  it('위치 교환은 현재 1등과 6등의 위치만 바꾼다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    setPositions(sim, { 1: 600, 2: 500, 3: 400, 4: 300, 5: 200, 6: 100 });
    sim.horse(1).speed = 18;
    sim.horse(6).speed = 10;
    const result = sim.applyAugment(AUGMENT_BY_ID['extreme_swap'], {});
    expect(result.ok).toBe(true);
    expect(sim.horse(1).pos).toBe(100);
    expect(sim.horse(6).pos).toBe(600);
    // 속도는 유지
    expect(sim.horse(1).speed).toBe(18);
    expect(sim.horse(6).speed).toBe(10);
  });

  it('지구력 회복/감소 즉시 효과가 적용된다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    const h = sim.horse(3);
    h.stamina = 40;
    sim.applyAugment(AUGMENT_BY_ID['stamina_steal'], { targetHorseId: 3 });
    expect(h.stamina).toBeCloseTo(28); // 40 × 0.7
    sim.applyAugment(AUGMENT_BY_ID['infinite_stamina'], { targetHorseId: 3 });
    // 최대 지구력의 정해진 비율만큼 회복한다
    expect(h.stamina).toBeCloseTo(28 + (h.staminaMax * AUGMENT_BY_ID['infinite_stamina'].value) / 100);
  });

  it('최종 속력 배율은 0.2~2.0배 범위를 지킨다 (여러 부스트 중첩에도)', () => {
    const sim = new RaceSim([makeHorse(1, 50), ...sixHorses().slice(1)], mulberry32(1));
    const h = sim.horse(1);
    // +60% 로켓 2중첩 + 꼴찌의 기적까지 → 원래대로면 ×4 이상
    sim.applyAugment(AUGMENT_BY_ID['rocket_booster'], { targetHorseId: 1 });
    sim.applyAugment(AUGMENT_BY_ID['rocket_booster'], { targetHorseId: 1 });
    setPositions(sim, { 1: 0, 2: 100, 3: 110, 4: 120, 5: 130, 6: 140 });
    sim.applyAugment(AUGMENT_BY_ID['last_miracle'], {});
    for (let i = 0; i < 100; i++) sim.tick(50);
    const baseMax = 17 + 50 * 0.09;
    // 배율 2.0 상한 + 몸무게 보정 1.3 상한 + 행운·컨디션 여유분
    expect(h.speed).toBeLessThanOrEqual(baseMax * 2.0 * 1.3 * 1.15);
  });
});

describe('코믹 변신 증강', () => {
  it('카드 ID는 모두 고유하고, 연출이 있는 카드는 13종 이상이다', () => {
    const ids = AUGMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(AUGMENTS.filter((a) => a.visual).length).toBeGreaterThanOrEqual(13);
  });

  it('이족보행은 대상의 속력을 35% 깎고 4초 뒤 풀린다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    const result = sim.applyAugment(AUGMENT_BY_ID['bipedal'], { targetHorseId: 3 });
    expect(result.targets).toEqual([3]);
    const effect = sim.horse(3).effects.find((e) => e.defId === 'bipedal')!;
    expect(effect.value).toBe(-0.35);
    for (let i = 0; i < 85; i++) sim.tick(50);
    expect(sim.horse(3).effects.some((e) => e.defId === 'bipedal')).toBe(false);
  });

  it('디스코 타임은 현재 1~3등만 1.8초 멈춘다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    setPositions(sim, { 1: 100, 2: 600, 3: 300, 4: 500, 5: 200, 6: 400 });
    const result = sim.applyAugment(AUGMENT_BY_ID['disco_time'], {});
    expect(result.targets.sort()).toEqual([2, 4, 6]);
    for (const id of [2, 4, 6]) {
      expect(sim.horse(id).effects.some((e) => e.effectType === 'stop')).toBe(true);
    }
    for (const id of [1, 3, 5]) {
      expect(sim.horse(id).effects.some((e) => e.effectType === 'stop')).toBe(false);
    }
    sim.tick(50);
    expect(sim.horse(2).pos).toBe(600); // 멈춘 동안 이동 없음
    for (let i = 0; i < 38; i++) sim.tick(50);
    expect(sim.horse(2).effects.some((e) => e.effectType === 'stop')).toBe(false);
  });

  it('단체 조랑말은 선두권 3마리에게 걸리고 방어막에 막힌다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    setPositions(sim, { 1: 600, 2: 500, 3: 400, 4: 300, 5: 200, 6: 100 });
    sim.applyAugment(AUGMENT_BY_ID['shield'], { targetHorseId: 2 });
    const result = sim.applyAugment(AUGMENT_BY_ID['pony_party'], {});
    expect(result.targets.sort()).toEqual([1, 3]);
    expect(result.blocked).toEqual([2]);
  });
});

describe('증강 카드 드로우 (등급제)', () => {
  const noBets = { win: new Map(), total: new Map() };
  const TIERS = ['silver', 'gold', 'platinum'] as const;

  it('구간마다 3장을 제시하고 한 손패에 중복이 없다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    setPositions(sim, { 1: 300, 2: 250, 3: 200, 4: 150, 5: 100, 6: 50 });
    for (const tier of TIERS) {
      for (let i = 0; i < 20; i++) {
        const hand = drawCards(sim, 1, tier, noBets, mulberry32(i));
        expect(hand).toHaveLength(3);
        expect(new Set(hand.map((c) => c.id)).size).toBe(3);
      }
    }
  });

  it('손패의 모든 카드는 그 구간의 등급에 속한다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    setPositions(sim, { 1: 300, 2: 250, 3: 200, 4: 150, 5: 100, 6: 50 });
    for (const tier of TIERS) {
      for (const phase of [1, 2, 3, 4, 5]) {
        for (let i = 0; i < 30; i++) {
          const hand = drawCards(sim, phase, tier, noBets, mulberry32(i * 7 + phase));
          for (const card of hand) expect(tierOf(card)).toBe(tier);
        }
      }
    }
  });

  it('같은 등급이라도 플레이어(난수)마다 손패가 달라진다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    setPositions(sim, { 1: 300, 2: 250, 3: 200, 4: 150, 5: 100, 6: 50 });
    const hands = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const hand = drawCards(sim, 2, 'gold', noBets, mulberry32(100 + i));
      hands.add(hand.map((c) => c.id).sort().join(','));
    }
    expect(hands.size).toBeGreaterThan(3);
  });

  it('등급은 희귀도로 정해진다 (일반=실버, 희귀=골드, 영웅·전설=플래티넘)', () => {
    const count = { silver: 0, gold: 0, platinum: 0 };
    for (const def of AUGMENTS) {
      const tier = tierOf(def);
      count[tier]++;
      if (def.rarity === 'common') expect(tier).toBe('silver');
      if (def.rarity === 'rare') expect(tier).toBe('gold');
      if (def.rarity === 'epic' || def.rarity === 'legendary') expect(tier).toBe('platinum');
    }
    // 어느 등급이든 3장을 채울 수 있어야 한다
    for (const tier of TIERS) expect(count[tier]).toBeGreaterThanOrEqual(3);
  });

  it('구간별 등급 확률표를 따르고, 뒤 구간일수록 플래티넘이 잘 나온다', () => {
    const rng = mulberry32(42);
    const runs = 6000;
    const platinumRate: number[] = [];
    for (const phase of [1, 2, 3, 4, 5]) {
      const count = { silver: 0, gold: 0, platinum: 0 };
      for (let i = 0; i < runs; i++) count[rollTier(phase, rng)]++;
      const weights = PHASE_TIER_WEIGHTS[phase];
      expect(weights.silver + weights.gold + weights.platinum).toBe(100);
      for (const tier of TIERS) {
        expect(count[tier] / runs).toBeCloseTo(weights[tier] / 100, 1);
      }
      platinumRate.push(count.platinum / runs);
    }
    expect(platinumRate[1]).toBeGreaterThan(platinumRate[0]);
    expect(platinumRate[2]).toBeGreaterThan(platinumRate[1]);
  });

  it('마지막 구간(5차, 90%)에서는 위치 교환 카드가 나오지 않는다', () => {
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    setPositions(sim, { 1: 800, 2: 700, 3: 600, 4: 500, 5: 400, 6: 300 });
    for (let i = 0; i < 100; i++) {
      const hand = drawCards(sim, 5, 'platinum', noBets, mulberry32(i));
      expect(hand.every((c) => c.effectType !== 'swapPositions')).toBe(true);
    }
  });

  it('등급 안에 유효한 카드가 모자라면 가까운 등급에서 채운다', () => {
    // 말 1마리만 남기면 플래티넘 중 순위 조건 카드 대부분이 대상을 잃는다
    const sim = new RaceSim(sixHorses(), mulberry32(1));
    for (const id of [1, 2, 3, 4, 5]) {
      const h = sim.horse(id);
      h.finished = true;
      h.finishTime = 1000 + id;
      h.pos = COURSE_LENGTH;
    }
    sim.horse(6).pos = 900;
    for (const tier of TIERS) {
      const hand = drawCards(sim, 3, tier, noBets, mulberry32(5));
      expect(hand).toHaveLength(3);
      expect(new Set(hand.map((c) => c.id)).size).toBe(3);
    }
  });

  it('6마리 전체가 대상인 카드는 판 자체를 바꾸는 전설 카드뿐이다 (능력치를 바꾸는 전체 카드는 없다)', () => {
    const groupSizes: Record<string, number> = {
      odd: 3, even: 3, front3: 3, back3: 3,
      rank1: 1, rank2: 1, rank6: 1, rank23: 2, rank34: 2,
      fastest2: 2, slowest2: 2, heaviest2: 2, mostStamina2: 2, leastStamina2: 2,
      mostBetWin: 1, leastBetWin: 1, mostBetTotal: 1, swap16: 2, single: 1
    };
    for (const def of AUGMENTS) {
      if (def.targetType === 'all') {
        expect(['finishLine', 'shuffleAll']).toContain(def.effectType);
        expect(def.rarity).toBe('legendary');
        expect(def.allowedPhases).not.toContain(5); // 마지막 구간에는 나오지 않는다
        continue;
      }
      expect(groupSizes[def.targetType]).toBeLessThan(6);
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { HorseInfo } from '../../shared/src/types';
import { AUGMENT_BY_ID, AUGMENTS } from '../../shared/src/augments';
import { RaceSim } from '../src/sim/race';
import { mulberry32 } from '../src/sim/rng';

function makeHorse(id: number, weight = 500): HorseInfo {
  return { id, name: `말${id}`, color: '#fff', breed: 'horse', stats: { speed: 50, accel: 50, stamina: 90, weight, luck: 50 } };
}

/** 같은 씨앗으로 두 번 달려, 카드를 쓴 쪽과 안 쓴 쪽의 효과 끝 무렵 2초간 이동 거리를 비교한다 */
function speedRatio(cardId: string, horseId: number): number {
  const def = AUGMENT_BY_ID[cardId];
  const run = (useCard: boolean): number => {
    const sim = new RaceSim([1, 2, 3, 4, 5, 6].map((id) => makeHorse(id)), mulberry32(7));
    for (let i = 0; i < 160; i++) sim.tick(50); // 8초: 최고 속력에 오른 뒤
    if (useCard) sim.applyAugment(def, { targetHorseId: horseId });
    const settle = def.durationMs - 2000;
    for (let t = 0; t < settle; t += 50) sim.tick(50);
    const from = sim.horse(horseId).pos;
    for (let t = 0; t < 1900; t += 50) sim.tick(50);
    return sim.horse(horseId).pos - from;
  };
  return run(true) / run(false);
}

describe('몸무게를 바꾸는 증강', () => {
  const weightCards = AUGMENTS.filter((a) => a.effectType === 'weightMult');

  it('몸무게 카드는 5장이고, 설명의 속력 수치는 계산식(배율^-0.25)과 같다', () => {
    expect(weightCards.map((a) => a.id).sort()).toEqual(['bulk_up', 'even_diet', 'feather_body', 'light_feather', 'odd_bulk']);
    for (const def of weightCards) {
      const pct = Math.round((Math.pow(def.value, -0.25) - 1) * 100);
      const shown = `속력 ${pct > 0 ? '+' : ''}${pct}%, ${def.durationMs / 1000}초`;
      expect(def.description.split('\n')[1]).toBe(shown);
    }
  });

  it('가벼워지면 빨라지고 무거워지면 느려진다 — 실제 달린 거리가 설명의 수치와 맞는다', () => {
    // 카드의 대상 말: 홀수 카드는 1번, 짝수 카드는 2번, 무거운 2마리 카드는 몸무게가 같으면 1·2번
    const target: Record<string, number> = { feather_body: 1, bulk_up: 1, odd_bulk: 1, even_diet: 2, light_feather: 1 };
    for (const def of weightCards) {
      const expected = Math.pow(def.value, -0.25);
      expect(speedRatio(def.id, target[def.id])).toBeCloseTo(expected, 1);
    }
  });

  it('지속 시간이 끝나면 몸무게 효과가 사라진다', () => {
    const sim = new RaceSim([1, 2, 3, 4, 5, 6].map((id) => makeHorse(id)), mulberry32(3));
    sim.applyAugment(AUGMENT_BY_ID['bulk_up'], { targetHorseId: 1 });
    expect(sim.horse(1).effects.filter((e) => e.effectType === 'weightMult')).toHaveLength(1);
    for (let t = 0; t <= 6000; t += 50) sim.tick(50);
    expect(sim.horse(1).effects.filter((e) => e.effectType === 'weightMult')).toHaveLength(0);
  });

  it('몸무게 상위 2마리 카드는 실제로 가장 무거운 두 마리를 고른다', () => {
    const horses = [makeHorse(1, 400), makeHorse(2, 640), makeHorse(3, 500), makeHorse(4, 610), makeHorse(5, 450), makeHorse(6, 380)];
    const sim = new RaceSim(horses, mulberry32(1));
    expect(sim.resolveTargets(AUGMENT_BY_ID['light_feather'], {}).sort()).toEqual([2, 4]);
    expect(sim.resolveTargets(AUGMENT_BY_ID['fat_strike'], {}).sort()).toEqual([2, 4]);
  });

  it('홀수·짝수 몸무게 카드는 해당 번호에만 걸린다', () => {
    const sim = new RaceSim([1, 2, 3, 4, 5, 6].map((id) => makeHorse(id)), mulberry32(1));
    sim.applyAugment(AUGMENT_BY_ID['odd_bulk'], {});
    sim.applyAugment(AUGMENT_BY_ID['even_diet'], {});
    for (const id of [1, 3, 5]) expect(sim.horse(id).effects.map((e) => e.defId)).toEqual(['odd_bulk']);
    for (const id of [2, 4, 6]) expect(sim.horse(id).effects.map((e) => e.defId)).toEqual(['even_diet']);
  });
});

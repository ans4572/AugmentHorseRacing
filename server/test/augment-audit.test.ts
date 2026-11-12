import { describe, expect, it } from 'vitest';
import type { HorseInfo } from '../../shared/src/types';
import { AUGMENT_BY_ID, AUGMENTS } from '../../shared/src/augments';
import { MAX_STACKS_PER_CARD, TIER_OF_RARITY } from '../../shared/src/constants';
import { RaceSim } from '../src/sim/race';
import { mulberry32 } from '../src/sim/rng';
import { auditAll } from '../scripts/audit-augments';

function sixHorses(): HorseInfo[] {
  return [1, 2, 3, 4, 5, 6].map((id) => ({
    id,
    name: `말${id}`,
    color: '#fff',
    breed: 'horse',
    stats: { speed: 60, accel: 55, stamina: 60, weight: 500, luck: 50 }
  }));
}

/** 15초 달려 속도가 붙은 상태의 경주 */
function cruising(): RaceSim {
  const sim = new RaceSim(sixHorses(), mulberry32(3));
  for (let i = 0; i < 300; i++) sim.tick(50);
  return sim;
}

describe('전체 증강 점검 — 모든 카드가 설명한 방향으로 실제 효과를 낸다', () => {
  const rows = auditAll();

  it('모든 카드를 빠짐없이 점검한다', () => {
    expect(rows).toHaveLength(AUGMENTS.length);
    for (const r of rows) expect(r.targets.length).toBeGreaterThan(0);
  });

  for (const r of rows) {
    it(`${r.name}: ${r.hostile ? '대상이 늦어진다' : '대상에게 도움이 된다'}`, () => {
      if (r.effectType === 'shield') {
        expect(r.shield).toBe(1);
        return;
      }
      if (r.effectType === 'staminaRestorePct') expect(r.staminaDelta).toBeGreaterThan(0);
      if (r.effectType === 'staminaDrainPct') expect(r.staminaDelta).toBeLessThan(0);
      // 완주 시각이 0.2초 이상 달라져야 "효과가 있다"고 본다
      if (r.hostile) expect(r.finishDelta).toBeGreaterThan(0.2);
      else expect(r.finishDelta).toBeLessThan(-0.2);
    });
  }

  it('실버 카드는 완주 시각을 1.5초 넘게 바꾸지 못한다 (등급 균형)', () => {
    for (const r of rows) {
      const tier = TIER_OF_RARITY[AUGMENT_BY_ID[r.id].rarity];
      if (tier === 'silver') expect(Math.abs(r.finishDelta), r.name).toBeLessThanOrEqual(1.5);
    }
  });

  it('어느 등급이든 마지막(5차) 구간에서 3장을 채울 수 있다', () => {
    for (const tier of ['silver', 'gold', 'platinum']) {
      const count = AUGMENTS.filter(
        (a) => TIER_OF_RARITY[a.rarity] === tier && a.allowedPhases.includes(5)
      ).length;
      expect(count, tier).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('증강 동작 세부', () => {
  it('역주행 본능: 걸리는 즉시 실제로 뒤로 가고, 끝나면 다시 앞으로 간다', () => {
    const sim = cruising();
    const h = sim.horse(3);
    const start = h.pos;
    sim.applyAugment(AUGMENT_BY_ID['reverse_instinct'], { targetHorseId: 3 });
    let prev = h.pos;
    for (let i = 0; i < 19; i++) {
      sim.tick(50);
      expect(h.pos).toBeLessThan(prev); // 매 틱 뒤로 이동
      prev = h.pos;
    }
    expect(start - h.pos).toBeGreaterThan(5);
    const lowest = h.pos;
    for (let i = 0; i < 40; i++) {
      sim.tick(50);
      expect(h.speed).toBeGreaterThanOrEqual(0); // 효과가 끝난 뒤에는 뒤로 밀리지 않는다
    }
    expect(h.pos).toBeGreaterThan(lowest);
  });

  it('정지 카드: 멈춘 동안 제자리이고, 풀리면 남은 속도로 다시 달린다', () => {
    const sim = cruising();
    const h = sim.horse(3);
    const before = h.speed;
    sim.applyAugment(AUGMENT_BY_ID['mukbang'], { targetHorseId: 3 });
    const pos = h.pos;
    for (let i = 0; i < 39; i++) sim.tick(50);
    expect(h.pos).toBe(pos);
    for (let i = 0; i < 3; i++) sim.tick(50);
    expect(h.pos).toBeGreaterThan(pos);
    expect(h.speed).toBeGreaterThan(before * 0.3); // 완전 정지 상태에서 재출발하지 않는다
  });

  it('인기 폭락: 대상이 즉시 급제동하고 한동안 느리게 회복한다', () => {
    const sim = cruising();
    const bets = { win: new Map(), total: new Map([[3, 100]]) };
    const h = sim.horse(3);
    const before = h.speed;
    const result = sim.applyAugment(AUGMENT_BY_ID['popularity_crash'], { bets });
    expect(result.targets).toEqual([3]);
    expect(h.speed).toBeLessThan(before * 0.35);
    for (let i = 0; i < 20; i++) sim.tick(50);
    expect(h.speed).toBeLessThan(before * 0.8); // 1초 뒤에도 아직 회복 중
  });

  it('같은 카드가 최대로 걸린 말에게 또 쓰면 카드를 잃지 않고 안내를 받는다', () => {
    const sim = cruising();
    for (let i = 0; i < MAX_STACKS_PER_CARD; i++) {
      expect(sim.applyAugment(AUGMENT_BY_ID['rocket_booster'], { targetHorseId: 2 }).ok).toBe(true);
    }
    const extra = sim.applyAugment(AUGMENT_BY_ID['rocket_booster'], { targetHorseId: 2 });
    expect(extra.ok).toBe(false);
    expect(extra.blocked).toEqual([]);
    expect(extra.message).toContain('최대');
  });

  it('속력·몸무게 효과를 모두 겹쳐도 최종 배율은 2.0배를 넘지 않는다', () => {
    const sim = cruising();
    const h = sim.horse(3);
    for (const id of ['rocket_booster', 'rocket_booster', 'giant_horse', 'feather_body', 'muscle_awakening']) {
      sim.applyAugment(AUGMENT_BY_ID[id], { targetHorseId: 3 });
    }
    for (let i = 0; i < 60; i++) sim.tick(50);
    const baseMax = 17 + 60 * 0.09;
    // 2.0배 상한 × 행운·컨디션 변동 여유(최대 약 +12%)
    expect(h.speed).toBeLessThanOrEqual(baseMax * 2.0 * 1.12);
  });

  it('지구력이 바닥난 말에게 회복 카드를 쓰면 안 쓴 경우보다 빨라진다', () => {
    // 같은 조건의 두 경주를 나란히 돌려 카드를 쓴 쪽과 안 쓴 쪽을 비교한다
    const run = (useCard: boolean): number => {
      const sim = cruising();
      const h = sim.horse(3);
      h.stamina = h.staminaMax * 0.1;
      for (let i = 0; i < 40; i++) sim.tick(50);
      if (useCard) sim.applyAugment(AUGMENT_BY_ID['infinite_stamina'], { targetHorseId: 3 });
      const from = h.pos;
      for (let i = 0; i < 80; i++) sim.tick(50);
      return h.pos - from;
    };
    expect(run(true)).toBeGreaterThan(run(false) * 1.02);
  });
});

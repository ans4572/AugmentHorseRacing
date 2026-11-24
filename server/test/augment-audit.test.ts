import { describe, expect, it } from 'vitest';
import type { HorseInfo } from '../../shared/src/types';
import { AUGMENT_BY_ID, AUGMENTS } from '../../shared/src/augments';
import { MAX_STACKS_PER_CARD, TIER_OF_RARITY } from '../../shared/src/constants';
import { RaceSim } from '../src/sim/race';
import { mulberry32 } from '../src/sim/rng';
import { auditAll } from '../scripts/audit-augments';
import { drawCards } from '../src/game/deck';

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
      // 누가 득을 볼지 상황에 따라 달라지는 카드는 방향을 따지지 않는다 (아래 '판을 흔드는 카드'에서 따로 본다)
      if (['pairUp', 'shuffleAll', 'piggyback', 'magnet', 'gamble'].includes(r.effectType)) return;
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

describe('판을 흔드는 카드', () => {
  /** 15초 달린 뒤 말들의 위치를 정해진 값으로 벌려 놓는다 (1번이 선두) */
  function spread(positions = [600, 560, 520, 480, 440, 400]): RaceSim {
    const sim = cruising();
    sim.horses.forEach((h, i) => {
      h.pos = positions[i];
      h.prevPos = positions[i];
    });
    return sim;
  }
  const run = (sim: RaceSim, seconds: number): void => {
    for (let i = 0; i < seconds * 20; i++) sim.tick(50);
  };

  it('자석: 4등 아래의 말만 고를 수 있고, 두 등수 앞 말 바로 뒤까지 끌려간다', () => {
    const sim = spread();
    expect(sim.applyAugment(AUGMENT_BY_ID['magnet'], { targetHorseId: 3 }).ok).toBe(false);
    expect(sim.applyAugment(AUGMENT_BY_ID['magnet'], { targetHorseId: 5 }).ok).toBe(true);
    run(sim, 3);
    // 5번(5등)은 3번(3등) 바로 뒤에 붙고, 4번을 앞지른다
    const gap = sim.horse(3).pos - sim.horse(5).pos;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(12);
    expect(sim.horse(5).pos).toBeGreaterThan(sim.horse(4).pos);
  });

  it('자석: 이미 두 등수 앞 말 바로 뒤에 있으면 카드를 잃지 않고 안내를 받는다', () => {
    const sim = spread();
    const def = AUGMENT_BY_ID['magnet'];
    // 5번(5등)을 3번(3등) 바로 뒤에 붙여 놓는다: 끌려갈 거리가 없다
    sim.horse(5).pos = sim.horse(3).pos - def.value;
    sim.horse(4).pos = sim.horse(5).pos + 1;
    const order = sim.currentRanking();
    expect(order.indexOf(5)).toBe(4);
    const res = sim.applyAugment(def, { targetHorseId: 5 });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('이미');
    expect(sim.horse(5).effects.some((e) => e.defId === 'magnet')).toBe(false);
  });

  it('나란히 달리기: 더 가까운 옆 레인 말과 가운데로 모인다', () => {
    const sim = spread([600, 560, 500, 480, 440, 400]);
    const before = sim.horse(3).pos - sim.horse(4).pos; // 20
    const r = sim.applyAugment(AUGMENT_BY_ID['side_by_side'], { targetHorseId: 3 });
    expect(r.targets.sort()).toEqual([3, 4]); // 2번(60 앞)보다 4번(20 뒤)이 가깝다
    const ctrl = spread([600, 560, 500, 480, 440, 400]);
    run(sim, 3);
    run(ctrl, 3);
    expect(Math.abs(sim.horse(3).pos - sim.horse(4).pos)).toBeLessThan(before * 0.3);
    // 앞서 있던 3번은 손해를, 뒤에 있던 4번은 이득을 본다
    expect(sim.horse(3).pos).toBeLessThan(ctrl.horse(3).pos);
    expect(sim.horse(4).pos).toBeGreaterThan(ctrl.horse(4).pos);
  });

  it('어부바: 바로 앞 말에 붙어 함께 가고, 업은 말은 느려진다. 맨 앞 말은 쓸 수 없다', () => {
    const sim = spread();
    expect(sim.applyAugment(AUGMENT_BY_ID['piggyback'], { targetHorseId: 1 }).ok).toBe(false);
    const r = sim.applyAugment(AUGMENT_BY_ID['piggyback'], { targetHorseId: 4 });
    expect(r.targets.sort()).toEqual([3, 4]);
    const ctrl = spread();
    run(sim, 2);
    run(ctrl, 2);
    expect(sim.horse(3).pos - sim.horse(4).pos).toBeLessThan(2); // 등에 붙어 있다
    expect(sim.horse(3).pos).toBeLessThan(ctrl.horse(3).pos); // 업은 말은 느려졌다
    expect(sim.horse(4).pos).toBeGreaterThan(ctrl.horse(4).pos); // 업힌 말은 앞당겨졌다
    run(sim, 4);
    expect(sim.horse(4).effects.some((e) => e.defId === 'piggyback')).toBe(false); // 4초 뒤에는 내린다
  });

  it('결승선 당기기: 80% 지점에서 경주가 끝나고, 한 번만 쓸 수 있다', () => {
    const sim = spread();
    const card = AUGMENT_BY_ID['short_course'];
    expect(sim.applyAugment(card).ok).toBe(true);
    expect(sim.applyAugment(card).ok).toBe(false);
    let guard = 0;
    while (!sim.allFinished() && guard++ < 4000) sim.tick(50);
    for (const h of sim.horses) expect(h.pos).toBe(sim.finishLine);
    expect(sim.finishLine).toBeLessThan(1400);
    // 선두가 이미 새 결승선 근처면 쓸 수 없다
    const late = spread([1150, 1100, 1000, 900, 800, 700]);
    expect(late.applyAugment(card).ok).toBe(false);
  });

  it('자리 뽑기: 위치 값은 그대로 두고 주인만 바뀐다. 방어막이 있는 말은 제자리를 지킨다', () => {
    const sim = spread();
    sim.horse(2).shield = 1;
    const r = sim.applyAugment(AUGMENT_BY_ID['musical_chairs']);
    expect(r.blocked).toEqual([2]);
    expect(sim.horse(2).pos).toBe(560);
    expect(sim.horses.map((h) => h.pos).sort((a, b) => a - b)).toEqual([400, 440, 480, 520, 560, 600]);
    expect(sim.horses.some((h, i) => h.pos !== [600, 560, 520, 480, 440, 400][i])).toBe(true);
  });

  it('치어리더 등장: 꼴찌는 빨라지고 선두는 조금 느려진다', () => {
    const sim = spread();
    const ctrl = spread();
    const r = sim.applyAugment(AUGMENT_BY_ID['cheer_squad']);
    expect(r.targets).toEqual([6, 1]);
    run(sim, 4);
    run(ctrl, 4);
    expect(sim.horse(6).pos).toBeGreaterThan(ctrl.horse(6).pos + 15);
    expect(sim.horse(1).pos).toBeLessThan(ctrl.horse(1).pos - 3);
  });

  it('당근 낚싯대: 5초 빨라진 뒤 잠깐 멈추지만 결국 이득이다', () => {
    const sim = spread();
    const ctrl = spread();
    sim.applyAugment(AUGMENT_BY_ID['carrot_rod'], { targetHorseId: 3 });
    run(sim, 5.2);
    expect(sim.horse(3).anim).toBe('stunned'); // 허탈해서 멈춰 있다
    run(sim, 3);
    run(ctrl, 8.2);
    expect(sim.horse(3).pos).toBeGreaterThan(ctrl.horse(3).pos);
  });

  it('재채기 릴레이: 2.5초 뒤 한 등수 뒤 말에게 한 번만 옮는다', () => {
    const sim = spread();
    sim.applyAugment(AUGMENT_BY_ID['sneeze_relay'], { targetHorseId: 2 });
    run(sim, 1.5);
    expect(sim.horse(3).effects.some((e) => e.defId === 'sneeze_relay')).toBe(false);
    run(sim, 1.5);
    expect(sim.horse(2).effects.some((e) => e.defId === 'sneeze_relay')).toBe(false);
    expect(sim.horse(3).effects.some((e) => e.defId === 'sneeze_relay')).toBe(true);
    // 옮은 말도 카드와 같은 2.5초 동안 느려진다 (2.5초에 옮았으니 4.6초에는 아직 걸려 있다)
    run(sim, 1.6);
    expect(sim.horse(3).effects.some((e) => e.defId === 'sneeze_relay')).toBe(true);
    run(sim, 1.4);
    // 3번에서 끝나고 4번으로는 번지지 않는다
    expect(sim.horses.some((h) => h.effects.some((e) => e.defId === 'sneeze_relay'))).toBe(false);
  });

  it('모 아니면 도: 반반 확률로 빨라지거나 느려지고, 느려진 쪽은 방해 효과로 남는다', () => {
    const card = AUGMENT_BY_ID['all_or_nothing'];
    // 카드 뽑기 난수를 정해 두 결과를 모두 본다 (0.5 미만이면 모)
    const play = (roll: number): { sim: RaceSim; ctrl: RaceSim } => {
      const sim = new RaceSim(sixHorses(), mulberry32(3), () => roll);
      const ctrl = new RaceSim(sixHorses(), mulberry32(3));
      for (let i = 0; i < 300; i++) {
        sim.tick(50);
        ctrl.tick(50);
      }
      expect(sim.applyAugment(card, { targetHorseId: 3 }).targets).toEqual([3]);
      return { sim, ctrl };
    };
    const win = play(0.2);
    expect(win.sim.horse(3).effects[0]).toMatchObject({ effectType: 'speedMult', value: 0.8, hostile: false });
    const lose = play(0.7);
    expect(lose.sim.horse(3).effects[0]).toMatchObject({ effectType: 'speedMult', value: -0.4, hostile: true });
    for (const g of [win, lose]) {
      run(g.sim, 4);
      run(g.ctrl, 4);
    }
    expect(win.sim.horse(3).pos).toBeGreaterThan(win.ctrl.horse(3).pos + 25);
    expect(lose.sim.horse(3).pos).toBeLessThan(lose.ctrl.horse(3).pos - 15);
    // 4초 뒤에는 어느 쪽이든 끝난다
    run(win.sim, 0.2);
    expect(win.sim.horse(3).effects).toHaveLength(0);
    // 방어막은 쓰이지 않는다 (말이 스스로 던진 윷이라 방해가 아니다)
    const shielded = new RaceSim(sixHorses(), mulberry32(3), () => 0.9);
    shielded.horse(3).shield = 1;
    expect(shielded.applyAugment(card, { targetHorseId: 3 }).blocked).toEqual([]);
    expect(shielded.horse(3).shield).toBe(1);
  });

  it('매운 당근 뽑기: 달리는 말 가운데 한 마리만 빨라지고, 나머지는 연출만 걸린다', () => {
    const card = AUGMENT_BY_ID['spicy_carrot'];
    const picked = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new RaceSim(sixHorses(), mulberry32(3), mulberry32(seed));
      for (let i = 0; i < 300; i++) sim.tick(50);
      // 완주한 말은 뽑히지 않는다
      sim.horse(1).finished = true;
      sim.horse(1).finishTime = 1000;
      const r = sim.applyAugment(card);
      expect(r.ok).toBe(true);
      expect(r.targets).toHaveLength(1);
      expect(r.targets[0]).not.toBe(1);
      picked.add(r.targets[0]);
      for (const h of sim.horses) {
        const fx = h.effects.filter((e) => e.defId === 'spicy_carrot');
        if (h.info.id === 1) expect(fx).toHaveLength(0);
        else if (h.info.id === r.targets[0]) expect(fx).toMatchObject([{ effectType: 'speedMult', value: 0.6 }]);
        else expect(fx).toMatchObject([{ effectType: 'cosmetic', quiet: true }]);
      }
    }
    expect(picked.size).toBe(5); // 달리는 다섯 마리가 고루 걸린다
  });

  it('장애물 설치: 선두권이 각자 반반으로 걸리고, 다 넘으면 맨 앞 말이 걸린다. 방어막은 허들을 피한다', () => {
    const card = AUGMENT_BY_ID['hurdle_set'];
    const at = (roll: () => number): RaceSim => {
      const sim = new RaceSim(sixHorses(), mulberry32(3), roll);
      for (let i = 0; i < 300; i++) sim.tick(50);
      sim.horses.forEach((h, i) => {
        h.pos = [600, 560, 520, 480, 440, 400][i];
        h.prevPos = h.pos;
      });
      return sim;
    };
    const fx = (sim: RaceSim, id: number) => sim.horse(id).effects.filter((e) => e.defId === 'hurdle_set');
    // 2등만 걸리는 경우: 1등과 3등은 연출만 걸린 채 넘어간다
    const rolls = [0.9, 0.1, 0.9];
    const some = at(() => rolls.shift()!);
    expect(some.applyAugment(card).targets).toEqual([2]);
    expect(fx(some, 2)).toMatchObject([{ effectType: 'speedMult', value: -0.5, hostile: true }]);
    expect(fx(some, 1)).toMatchObject([{ effectType: 'cosmetic', quiet: true }]);
    expect(fx(some, 3)).toMatchObject([{ effectType: 'cosmetic', quiet: true }]);
    expect(fx(some, 4)).toHaveLength(0);
    // 모두 넘는 주사위가 나오면 맨 앞 말이 걸린다
    const none = at(() => 0.9);
    expect(none.applyAugment(card).targets).toEqual([1]);
    // 모두 걸릴 수도 있다
    const all = at(() => 0.1);
    expect(all.applyAugment(card).targets).toEqual([1, 2, 3]);
    // 방어막이 있는 말은 허들을 피하고 방어막을 잃는다
    const guarded = at(() => 0.1);
    guarded.horse(1).shield = 1;
    const r = guarded.applyAugment(card);
    expect(r.blocked).toEqual([1]);
    expect(r.targets).toEqual([2, 3]);
    expect(guarded.horse(1).shield).toBe(0);
    expect(fx(guarded, 1)).toHaveLength(0);
    // 걸린 말은 2.5초 동안 뒤처진다
    const ctrl = at(() => 0.9);
    run(all, 2.5);
    run(ctrl, 2.5);
    expect(all.horse(4).pos).toBeCloseTo(ctrl.horse(4).pos, 5);
    expect(all.horse(2).pos).toBeLessThan(ctrl.horse(2).pos - 15);
  });

  it('매운 당근 뽑기: 구경꾼 연출은 중첩으로 세지 않아, 연달아 써도 막히지 않는다', () => {
    const def = AUGMENT_BY_ID['spicy_carrot'];
    const sim = cruising();
    // 구경꾼 연출(1.6초)이 남아 있는 동안 세 번 연달아 쓴다
    for (let n = 0; n < 3; n++) expect(sim.applyAugment(def).ok, `${n + 1}번째`).toBe(true);
    for (const h of sim.horses) {
      expect(h.effects.filter((e) => e.defId === def.id && e.effectType === 'speedMult').length).toBeLessThanOrEqual(2);
    }
    // 여섯 마리 모두 두 겹이 될 때까지 쓰면(12번) 그다음에는 카드를 잃지 않고 안내를 받는다
    for (let n = 0; n < 9; n++) sim.applyAugment(def);
    const full = sim.applyAugment(def);
    expect(full.ok).toBe(false);
    expect(full.message).toContain('최대');
  });

  it('장애물 설치: 같은 말에게 허들 감속이 두 겹 넘게 쌓이지 않는다', () => {
    const def = AUGMENT_BY_ID['hurdle_set'];
    const sim = cruising();
    for (let n = 0; n < 12; n++) sim.applyAugment(def);
    for (const h of sim.horses) {
      expect(h.effects.filter((e) => e.defId === def.id && e.effectType === 'speedMult').length).toBeLessThanOrEqual(2);
    }
    // 선두권 세 마리가 모두 두 겹이면 카드를 잃지 않고 안내를 받는다
    const front = sim.currentRanking().slice(0, 3).map((id) => sim.horse(id));
    if (front.every((h) => h.effects.filter((e) => e.defId === def.id && e.effectType === 'speedMult').length === 2)) {
      const res = sim.applyAugment(def);
      expect(res.ok).toBe(false);
      expect(res.message).toContain('최대');
    }
  });

  it('쓸 수 있는 말이 없는 카드는 뽑을 때 빠진다', () => {
    const ids = (sim: RaceSim, phase: number): Set<string> => {
      const seen = new Set<string>();
      const rng = mulberry32(5);
      const bets = { win: new Map<number, number>(), total: new Map<number, number>() };
      for (const tier of ['gold', 'platinum'] as const) {
        for (let i = 0; i < 300; i++) for (const d of drawCards(sim, phase, tier, bets, rng)) seen.add(d.id);
      }
      return seen;
    };
    // 평소: 전설 카드도 나온다
    const normal = ids(spread(), 2);
    expect(normal.has('short_course')).toBe(true);
    expect(normal.has('magnet')).toBe(true);
    // 결승선을 이미 옮겼으면 그 카드는 다시 나오지 않는다
    const moved = spread();
    moved.applyAugment(AUGMENT_BY_ID['short_course']);
    expect(ids(moved, 2).has('short_course')).toBe(false);
    // 세 마리만 남으면: 자석(4등 아래 필요)은 빠지고, 어부바는 남는다
    const three = spread();
    for (const id of [1, 2, 3]) {
      three.horse(id).finished = true;
      three.horse(id).finishTime = 1000 + id;
    }
    const late = ids(three, 4);
    expect(late.has('magnet')).toBe(true); // 4·5·6등이 남아 있어 6등은 4등 뒤로 붙을 수 있다
    const two = spread();
    for (const id of [1, 2, 3, 4]) {
      two.horse(id).finished = true;
      two.horse(id).finishTime = 1000 + id;
    }
    const last = ids(two, 4);
    expect(last.has('magnet')).toBe(false); // 달리는 말이 둘뿐이라 두 등수 앞이 없다
    expect(last.has('piggyback')).toBe(true);
    // 한 마리만 남으면 다른 말이 필요한 카드는 모두 빠진다
    const one = spread();
    for (const id of [1, 2, 3, 4, 5]) {
      one.horse(id).finished = true;
      one.horse(id).finishTime = 1000 + id;
    }
    const solo = ids(one, 4);
    for (const id of ['magnet', 'piggyback', 'side_by_side', 'musical_chairs', 'extreme_swap']) expect(solo.has(id), id).toBe(false);
  });
});

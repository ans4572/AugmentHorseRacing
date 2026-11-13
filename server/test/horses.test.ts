import { describe, expect, it } from 'vitest';
import { generateHorses, pickBreed, STAT_SUM_MAX, STAT_SUM_MIN } from '../src/sim/horses';
import { BREED_INFO } from '../../shared/src/names';
import { mulberry32 } from '../src/sim/rng';
import { DEFAULT_LOOK } from '../../shared/src/stable';

describe('말 생성', () => {
  it('항상 6마리를 생성하고 ID는 1~6이다', () => {
    const horses = generateHorses(mulberry32(1));
    expect(horses).toHaveLength(6);
    expect(horses.map((h) => h.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('능력치가 규정 범위 안에 있다', () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const h of generateHorses(mulberry32(seed))) {
        expect(h.stats.speed).toBeGreaterThanOrEqual(20);
        expect(h.stats.speed).toBeLessThanOrEqual(95);
        expect(h.stats.accel).toBeGreaterThanOrEqual(20);
        expect(h.stats.accel).toBeLessThanOrEqual(95);
        expect(h.stats.stamina).toBeGreaterThanOrEqual(20);
        expect(h.stats.stamina).toBeLessThanOrEqual(95);
        expect(h.stats.weight).toBeGreaterThanOrEqual(350);
        expect(h.stats.weight).toBeLessThanOrEqual(650);
        expect(h.stats.luck).toBeGreaterThanOrEqual(1);
        expect(h.stats.luck).toBeLessThanOrEqual(100);
      }
    }
  });

  it('능력치 총합 제한을 지킨다 (극단 조합 방지)', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const h of generateHorses(mulberry32(seed))) {
        const sum = h.stats.speed + h.stats.accel + h.stats.stamina;
        expect(sum).toBeGreaterThanOrEqual(STAT_SUM_MIN);
        expect(sum).toBeLessThanOrEqual(STAT_SUM_MAX);
      }
    }
  });

  it('말 종류는 정해진 5종 중 하나이고, 여러 번 뽑으면 모든 종류가 나온다', () => {
    const breeds = Object.keys(BREED_INFO);
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      for (const h of generateHorses(mulberry32(seed))) {
        expect(breeds).toContain(h.breed);
        seen.add(h.breed);
      }
    }
    expect(seen.size).toBe(breeds.length);
    // 가중치대로 일반 말이 가장 흔하다
    const rng = mulberry32(9);
    let plain = 0;
    for (let i = 0; i < 2000; i++) if (pickBreed(rng) === 'horse') plain++;
    expect(plain / 2000).toBeGreaterThan(0.35);
    expect(plain / 2000).toBeLessThan(0.6);
  });

  it('이름이 서로 겹치지 않는다', () => {
    const horses = generateHorses(mulberry32(7));
    const names = new Set(horses.map((h) => h.name));
    expect(names.size).toBe(6);
  });
});

describe('출전마 다양성', () => {
  it('쓴 이름을 넘겨주면 다섯 라운드 동안 같은 이름이 다시 나오지 않는다', () => {
    const rng = mulberry32(41);
    const used = new Set<string>();
    for (let round = 1; round <= 5; round++) {
      const horses = generateHorses(rng, used);
      for (const h of horses) {
        expect(used.has(h.name)).toBe(false);
        used.add(h.name);
      }
    }
    expect(used.size).toBe(30);
  });

  it('겉모습은 종류와 맞고, 꾸미기가 붙은 말과 맨몸인 말이 섞여 나온다', () => {
    const rng = mulberry32(42);
    let dressed = 0;
    let plain = 0;
    for (let i = 0; i < 40; i++) {
      for (const h of generateHorses(rng)) {
        expect(h.look?.breed).toBe(`breed_${h.breed}`);
        const extra = ['coat', 'hat', 'neck', 'face', 'trail'].filter(
          (slot) => h.look![slot as keyof typeof h.look] !== DEFAULT_LOOK[slot as keyof typeof DEFAULT_LOOK]
        ).length;
        if (extra > 0) dressed++;
        else plain++;
      }
    }
    expect(dressed).toBeGreaterThan(100);
    expect(plain).toBeGreaterThan(10);
  });
});

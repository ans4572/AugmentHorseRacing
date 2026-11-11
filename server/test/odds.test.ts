import { describe, expect, it } from 'vitest';
import type { HorseInfo } from '../../shared/src/types';
import { ODDS_MAX, ODDS_MIN } from '../../shared/src/constants';
import { computeOdds } from '../src/game/odds';
import { generateHorses } from '../src/sim/horses';
import { mulberry32 } from '../src/sim/rng';

function makeHorse(id: number, speed: number, accel: number, stamina: number): HorseInfo {
  return { id, name: `말${id}`, color: '#fff', breed: 'horse', stats: { speed, accel, stamina, weight: 500, luck: 50 } };
}

describe('배당 계산', () => {
  it('모든 배당이 허용 범위 안에 있고 소수점 둘째 자리까지다', () => {
    const odds = computeOdds(generateHorses(mulberry32(1)), 100, mulberry32(2));
    for (const horseId of [1, 2, 3, 4, 5, 6]) {
      for (const type of ['winner', 'last', 'top3', 'bottom3'] as const) {
        const v = odds[horseId][type];
        expect(v).toBeGreaterThanOrEqual(ODDS_MIN);
        expect(v).toBeLessThanOrEqual(ODDS_MAX);
        expect(Math.round(v * 100) / 100).toBe(v);
      }
    }
  });

  it('강한 말의 우승 배당이 약한 말보다 낮다', () => {
    const horses = [
      makeHorse(1, 90, 85, 90),
      makeHorse(2, 30, 30, 35),
      ...([3, 4, 5, 6].map((id) => makeHorse(id, 55, 55, 55)))
    ];
    const odds = computeOdds(horses, 150, mulberry32(7));
    expect(odds[1].winner).toBeLessThan(odds[2].winner);
    expect(odds[1].top3).toBeLessThan(odds[2].top3);
  });
});

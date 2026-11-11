import { describe, expect, it } from 'vitest';
import type { HorseInfo } from '../../shared/src/types';
import { COURSE_LENGTH } from '../../shared/src/constants';
import { RaceSim } from '../src/sim/race';
import { generateHorses } from '../src/sim/horses';
import { mulberry32 } from '../src/sim/rng';

function makeHorse(id: number, speed: number, accel: number, stamina: number, weight = 500, luck = 50): HorseInfo {
  return { id, name: `테스트${id}`, color: '#fff', breed: 'horse', stats: { speed, accel, stamina, weight, luck } };
}

function runToFinish(sim: RaceSim, maxMs = 300000): void {
  let guard = 0;
  while (!sim.allFinished() && guard * 50 < maxMs) {
    sim.tick(50);
    guard++;
  }
}

describe('경주 시뮬레이션', () => {
  it('6마리 모두 결승선을 통과한다', () => {
    const sim = new RaceSim(generateHorses(mulberry32(3)), mulberry32(4));
    runToFinish(sim);
    expect(sim.allFinished()).toBe(true);
    for (const h of sim.horses) {
      expect(h.pos).toBe(COURSE_LENGTH);
      expect(h.finishTime).not.toBeNull();
    }
  });

  it('최종 순위는 1~6위가 중복 없이 부여되고 통과 시각 순이다', () => {
    const sim = new RaceSim(generateHorses(mulberry32(5)), mulberry32(6));
    runToFinish(sim);
    const rankings = sim.finalRankings();
    expect(rankings.map((r) => r.rank).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < rankings.length; i++) {
      expect(rankings[i].timeMs).toBeGreaterThanOrEqual(rankings[i - 1].timeMs);
    }
  });

  it('능력치가 좋은 말이 대체로 이긴다 (증강 없는 상태)', () => {
    const strong = makeHorse(1, 90, 85, 90, 400, 50);
    const weak = makeHorse(2, 30, 30, 30, 600, 50);
    const mid = [3, 4, 5, 6].map((id) => makeHorse(id, 55, 55, 55, 500, 50));
    let strongWins = 0;
    const runs = 30;
    for (let i = 0; i < runs; i++) {
      const sim = new RaceSim([strong, weak, ...mid], mulberry32(100 + i));
      runToFinish(sim);
      if (sim.finalRankings()[0].horseId === 1) strongWins++;
      // 약한 말이 1등인 경우는 없어야 정상
      expect(sim.finalRankings()[0].horseId).not.toBe(2);
    }
    expect(strongWins).toBeGreaterThan(runs * 0.6);
  });

  it('동일 위치 동률이면 말 ID 오름차순으로 순위를 정한다', () => {
    const horses = [1, 2, 3, 4, 5, 6].map((id) => makeHorse(id, 50, 50, 50));
    const sim = new RaceSim(horses, mulberry32(1));
    sim.horse(3).pos = 500;
    sim.horse(5).pos = 500;
    sim.horse(1).pos = 700;
    const ranking = sim.currentRanking();
    expect(ranking[0]).toBe(1);
    expect(ranking.indexOf(3)).toBeLessThan(ranking.indexOf(5));
  });

  it('결승선 통과 시각을 틱 사이에서 보간한다', () => {
    const horses = [makeHorse(1, 95, 95, 95), makeHorse(2, 95, 95, 95)];
    const sim = new RaceSim(horses, mulberry32(9));
    // 한 틱에 결승선을 넘도록 세팅
    sim.horse(1).pos = COURSE_LENGTH - 0.3;
    sim.horse(1).speed = 20;
    sim.tick(50);
    const h = sim.horse(1);
    expect(h.finished).toBe(true);
    // 보간된 시각은 틱 시작과 끝 사이
    expect(h.finishTime!).toBeGreaterThan(0);
    expect(h.finishTime!).toBeLessThanOrEqual(sim.now);
  });

  it('지구력이 다 떨어지면 피로 상태가 되어 느려진다', () => {
    const horses = [makeHorse(1, 80, 80, 20), makeHorse(2, 80, 80, 20)];
    const sim = new RaceSim(horses, mulberry32(11));
    const h = sim.horse(1);
    h.stamina = 0.5;
    // 충분히 달리게 하여 피로 유발
    for (let i = 0; i < 100; i++) sim.tick(50);
    expect(h.fatigued).toBe(true);
  });
});

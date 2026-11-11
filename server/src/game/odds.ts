import type { BetType, HorseInfo, OddsTable } from '../../../shared/src/types';
import { ODDS_HOUSE_FACTOR, ODDS_MAX, ODDS_MIN } from '../../../shared/src/constants';
import { RaceSim } from '../sim/race';

/**
 * 증강 없는 상태의 몬테카를로 시뮬레이션으로 예상 확률을 구해 배당을 계산한다.
 * 배당은 경기 시작 전에 고정되며 이후 변경되지 않는다.
 */
export function computeOdds(
  horses: HorseInfo[],
  runs = 220,
  rng: () => number = Math.random
): OddsTable {
  const counts: Record<number, Record<BetType, number>> = {};
  for (const h of horses) counts[h.id] = { winner: 0, last: 0, top3: 0, bottom3: 0 };

  for (let i = 0; i < runs; i++) {
    const sim = new RaceSim(horses, rng);
    let guard = 0;
    while (!sim.allFinished() && guard++ < 2400) sim.tick(100);
    const rankings = sim.finalRankings();
    for (const r of rankings) {
      if (r.rank === 1) counts[r.horseId].winner++;
      if (r.rank === 6) counts[r.horseId].last++;
      if (r.rank <= 3) counts[r.horseId].top3++;
      if (r.rank >= 4) counts[r.horseId].bottom3++;
    }
  }

  const table: OddsTable = {};
  for (const h of horses) {
    table[h.id] = { winner: 0, last: 0, top3: 0, bottom3: 0 };
    for (const type of ['winner', 'last', 'top3', 'bottom3'] as BetType[]) {
      // 라플라스 평활화로 0 확률 방지
      const p = (counts[h.id][type] + 1) / (runs + 2);
      const raw = ODDS_HOUSE_FACTOR / p;
      // 소수점 둘째 자리까지
      const odds = Math.round(Math.min(ODDS_MAX, Math.max(ODDS_MIN, raw)) * 100) / 100;
      table[h.id][type] = odds;
    }
  }
  return table;
}

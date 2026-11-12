import type { BetType, HorseInfo, OddsTable } from '../../../shared/src/types';
import {
  ODDS_HOUSE_FACTOR,
  ODDS_MAX,
  ODDS_MIN,
  ODDS_TEMPER_GROUP,
  ODDS_TEMPER_SINGLE
} from '../../../shared/src/constants';
import { RaceSim } from '../sim/race';

/**
 * 증강 없는 상태의 몬테카를로 시뮬레이션으로 예상 확률을 구한 뒤,
 * 증강으로 판이 흔들리는 만큼 완만하게 눌러 배당을 계산한다.
 * 배당은 경기 시작 전에 고정되며 이후 변경되지 않는다.
 */
export function computeOdds(
  horses: HorseInfo[],
  runs = 220,
  rng: () => number = Math.random
): OddsTable {
  const counts: Record<number, Record<BetType, number>> = {};
  const rankSum: Record<number, number> = {};
  for (const h of horses) {
    counts[h.id] = { winner: 0, last: 0, top3: 0, bottom3: 0 };
    rankSum[h.id] = 0;
  }

  for (let i = 0; i < runs; i++) {
    const sim = new RaceSim(horses, rng);
    let guard = 0;
    while (!sim.allFinished() && guard++ < 2400) sim.tick(100);
    const rankings = sim.finalRankings();
    for (const r of rankings) {
      rankSum[r.horseId] += r.rank;
      if (r.rank === 1) counts[r.horseId].winner++;
      if (r.rank === 6) counts[r.horseId].last++;
      if (r.rank <= 3) counts[r.horseId].top3++;
      if (r.rank >= 4) counts[r.horseId].bottom3++;
    }
  }

  // 1) 시뮬레이션 빈도에 평균 순위로 만든 확률을 조금 섞는다.
  //    한 번도 우승하지 못한 말들끼리도 평균 순위가 다르면 배당이 달라진다.
  // 2) 실제 경기는 증강 카드로 순위가 크게 흔들리므로 확률을 완만하게 누른다.
  //    그러지 않으면 배당이 상한(30배)과 하한(1.05배)에 몰린다.
  const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
  const logit = (q: number): number => Math.log(q / (1 - q));
  const meanRank = (id: number): number => rankSum[id] / runs;
  const softmax = (sign: number): Record<number, number> => {
    const w = horses.map((h) => Math.exp(sign * 1.1 * meanRank(h.id)));
    const total = w.reduce((x, y) => x + y, 0);
    return Object.fromEntries(horses.map((h, i) => [h.id, w[i] / total]));
  };
  const prior: Record<BetType, Record<number, number>> = {
    winner: softmax(-1),
    last: softmax(1),
    top3: Object.fromEntries(horses.map((h) => [h.id, sigmoid(1.3 * (3.5 - meanRank(h.id)))])),
    bottom3: Object.fromEntries(horses.map((h) => [h.id, sigmoid(1.3 * (meanRank(h.id) - 3.5))]))
  };

  const table: OddsTable = {};
  for (const h of horses) table[h.id] = { winner: 0, last: 0, top3: 0, bottom3: 0 };
  for (const type of ['winner', 'last', 'top3', 'bottom3'] as BetType[]) {
    const single = type === 'winner' || type === 'last';
    const tempered = horses.map((h) => {
      const freq = (counts[h.id][type] + 0.5) / (runs + 1);
      const mixed = Math.min(0.995, Math.max(0.002, 0.8 * freq + 0.2 * prior[type][h.id]));
      return single ? Math.pow(mixed, ODDS_TEMPER_SINGLE) : sigmoid(ODDS_TEMPER_GROUP * logit(mixed));
    });
    // 확률의 합을 원래 값(1마리 맞히기는 1, 3마리 안은 3)으로 되돌린다
    const scale = (single ? 1 : 3) / tempered.reduce((x, y) => x + y, 0);
    horses.forEach((h, i) => {
      const q = Math.min(0.97, tempered[i] * scale);
      const raw = ODDS_HOUSE_FACTOR / q;
      // 소수점 둘째 자리까지
      table[h.id][type] = Math.round(Math.min(ODDS_MAX, Math.max(ODDS_MIN, raw)) * 100) / 100;
    });
  }
  return table;
}

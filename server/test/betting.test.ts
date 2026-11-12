import { describe, expect, it } from 'vitest';
import type { Bet, RankingEntry } from '../../shared/src/types';
import { betLimit, isBetHit, settleBets, validateBet } from '../src/game/betting';

const rankings: RankingEntry[] = [
  { horseId: 3, rank: 1, timeMs: 50000 },
  { horseId: 1, rank: 2, timeMs: 52000 },
  { horseId: 5, rank: 3, timeMs: 54000 },
  { horseId: 2, rank: 4, timeMs: 56000 },
  { horseId: 6, rank: 5, timeMs: 58000 },
  { horseId: 4, rank: 6, timeMs: 60000 }
];

function bet(partial: Partial<Bet>): Bet {
  return {
    betId: 'b1',
    playerId: 'p1',
    type: 'winner',
    horseId: 3,
    amount: 100,
    odds: 3.5,
    ...partial
  };
}

describe('배팅 검증', () => {
  it('최소 배팅은 10코인이다', () => {
    expect(validateBet(5, 0, 1000, 1000)).not.toBeNull();
    expect(validateBet(9, 0, 1000, 1000)).not.toBeNull();
    expect(validateBet(10, 0, 1000, 1000)).toBeNull();
  });

  it('가진 코인 전부를 걸 수 있고(올인), 그 이상은 걸 수 없다', () => {
    expect(betLimit(1000)).toBe(1000);
    expect(validateBet(1000, 0, 1000, 1000)).toBeNull();
    expect(validateBet(1001, 0, 1000, 1000)).not.toBeNull();
    // 여러 번 나눠 걸어도 합계가 가진 코인을 넘지 못한다
    expect(validateBet(200, 850, 1000, 150)).not.toBeNull();
    expect(validateBet(150, 850, 1000, 150)).toBeNull();
  });

  it('보유 코인을 초과할 수 없다', () => {
    expect(validateBet(100, 0, 1000, 50)).not.toBeNull();
  });
});

describe('적중 판정', () => {
  it('우승마/꼴찌마/TOP3/BOTTOM3 판정이 정확하다', () => {
    expect(isBetHit('winner', 1)).toBe(true);
    expect(isBetHit('winner', 2)).toBe(false);
    expect(isBetHit('last', 6)).toBe(true);
    expect(isBetHit('last', 5)).toBe(false);
    expect(isBetHit('top3', 3)).toBe(true);
    expect(isBetHit('top3', 4)).toBe(false);
    expect(isBetHit('bottom3', 4)).toBe(true);
    expect(isBetHit('bottom3', 3)).toBe(false);
  });
});

describe('정산', () => {
  it('적중 시 지급액 = floor(배팅금 × 배당), 원금 포함', () => {
    const outcomes = settleBets([bet({ amount: 100, odds: 3.33, horseId: 3, type: 'winner' })], rankings);
    expect(outcomes[0].hit).toBe(true);
    expect(outcomes[0].payout).toBe(333); // floor(100 × 3.33)
  });

  it('소수점은 내림 처리한다', () => {
    const outcomes = settleBets([bet({ amount: 70, odds: 1.57, horseId: 3 })], rankings);
    expect(outcomes[0].payout).toBe(Math.floor(70 * 1.57)); // 109
  });

  it('실패 시 지급액은 0이다 (배팅금 전액 손실)', () => {
    const outcomes = settleBets([bet({ horseId: 4, type: 'winner' })], rankings);
    expect(outcomes[0].hit).toBe(false);
    expect(outcomes[0].payout).toBe(0);
  });

  it('TOP3 / BOTTOM3 배팅도 올바르게 정산된다', () => {
    const outcomes = settleBets(
      [
        bet({ betId: 'a', horseId: 5, type: 'top3', amount: 50, odds: 2.0 }),
        bet({ betId: 'b', horseId: 1, type: 'bottom3', amount: 50, odds: 2.0 })
      ],
      rankings
    );
    expect(outcomes[0].hit).toBe(true); // 5번은 3등
    expect(outcomes[0].payout).toBe(100);
    expect(outcomes[1].hit).toBe(false); // 1번은 2등
  });
});

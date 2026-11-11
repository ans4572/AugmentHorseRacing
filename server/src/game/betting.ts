import type { Bet, BetOutcome, BetType, RankingEntry } from '../../../shared/src/types';
import { BET_LIMIT_RATIO, BET_MIN } from '../../../shared/src/constants';

/** 배팅 단계 시작 시 보유 코인 기준 라운드 총 배팅 한도 */
export function betLimit(coinsAtBettingStart: number): number {
  return Math.floor(coinsAtBettingStart * BET_LIMIT_RATIO);
}

/**
 * 배팅 가능 여부 검사.
 * @returns 에러 메시지 또는 null(허용)
 */
export function validateBet(
  amount: number,
  existingTotal: number,
  coinsAtBettingStart: number,
  currentCoins: number
): string | null {
  if (!Number.isInteger(amount) || amount < BET_MIN) {
    return `최소 배팅 금액은 ${BET_MIN}코인입니다.`;
  }
  const limit = betLimit(coinsAtBettingStart);
  if (existingTotal + amount > limit) {
    return `라운드 총 배팅 한도(${limit}코인)를 초과합니다.`;
  }
  if (amount > currentCoins) {
    return '보유 코인이 부족합니다.';
  }
  return null;
}

/** 배팅 적중 여부 판정 */
export function isBetHit(type: BetType, horseRank: number): boolean {
  switch (type) {
    case 'winner':
      return horseRank === 1;
    case 'last':
      return horseRank === 6;
    case 'top3':
      return horseRank <= 3;
    case 'bottom3':
      return horseRank >= 4;
  }
}

/**
 * 배팅 정산. 지급액 = floor(배팅금 × 확정 배당), 원금 포함.
 * 실패 시 배팅금 전액 손실(배팅 시점에 이미 차감됨).
 */
export function settleBets(bets: Bet[], rankings: RankingEntry[]): BetOutcome[] {
  const rankOf = new Map(rankings.map((r) => [r.horseId, r.rank]));
  return bets.map((bet) => {
    const rank = rankOf.get(bet.horseId) ?? 6;
    const hit = isBetHit(bet.type, rank);
    const payout = hit ? Math.floor(bet.amount * bet.odds) : 0;
    return { ...bet, hit, payout };
  });
}

import type { AugmentTier, BetType, Rarity } from './types';

// ---------------- 경주 ----------------

/** 코스 거리 (정규화 단위) */
export const COURSE_LENGTH = 1400;

/** 서버 시뮬레이션 틱 간격 (ms) — 20Hz */
export const TICK_MS = 50;

/** 클라이언트로 상태를 보내는 간격 (틱 수 기준: 2틱마다 = 10Hz) */
export const BROADCAST_EVERY_TICKS = 2;

/** 말 최종 속력 배율 허용 범위 */
export const SPEED_MULT_MIN = 0.2;
export const SPEED_MULT_MAX = 2.0;

/** 동일 카드 효과의 말 1마리당 최대 중첩 수 */
export const MAX_STACKS_PER_CARD = 2;

// ---------------- 라운드 / 코인 ----------------

/** 총 라운드 수 → 게임 시작 시 초기 코인 */
export const ROUND_COINS: Record<number, number> = {
  1: 500,
  2: 800,
  3: 1100,
  4: 1400,
  5: 1700
};

/** 코인 부족 구제: 이 값 미만이면 다음 라운드 시작 시 보충 */
export const LOW_COIN_THRESHOLD = 10;
export const TOP_UP_AMOUNT = 100;

// ---------------- 배팅 ----------------

export const BET_MIN = 10;
/** 라운드당 총 배팅금 한도: 배팅 시작 시 보유 코인의 30% */
export const BET_LIMIT_RATIO = 1;

/** 참가자 색. 방 안에서 한 사람이 한 색을 쓴다 (흰 글자가 읽히는 진한 색만) */
export const PLAYER_COLORS = ['#d92b22', '#2447d6', '#b85c00', '#7a3fc4', '#0b7f72', '#c22a7e', '#5f6d00', '#5a4632'];
/** NPC가 한 라운드에 거는 금액의 상한 (가진 코인 대비). 사람은 올인도 할 수 있다 */
export const NPC_BET_RATIO = 0.3;

export const BET_TYPE_INFO: Record<BetType, { label: string; desc: string }> = {
  winner: { label: '우승마', desc: '고른 말이 1등' },
  last: { label: '꼴찌마', desc: '고른 말이 6등' },
  top3: { label: '1~3위', desc: '고른 말이 1, 2, 3등 중 하나' },
  bottom3: { label: '4~6위', desc: '고른 말이 4, 5, 6등 중 하나' }
};

/** 배당 범위 */
export const ODDS_MIN = 1.05;
export const ODDS_MAX = 50;
/** 배당 계산 시 적용하는 환급률 */
export const ODDS_HOUSE_FACTOR = 0.9;
/** 배당 완만화: 우승·꼴찌 확률에 거는 지수 (1이면 시뮬레이션 그대로, 작을수록 고르게) */
export const ODDS_TEMPER_SINGLE = 0.5;
/** 배당 완만화: 1~3위·4~6위 확률의 로짓에 곱하는 값 */
export const ODDS_TEMPER_GROUP = 0.45;

// ---------------- 단계별 시간 (ms) ----------------

export const TIMINGS = {
  preview: 20000,   // 말 능력치 확인
  betting: 120000,  // 배팅 (모두 준비 완료를 누르면 바로 마감)
  reveal: 5000,     // 배팅 공개
  countdown: 3000,  // 경주 시작 카운트다운
  finishHold: 2500  // 전원 완주 후 결과 표시까지 대기
};

// ---------------- 증강 구간 ----------------

export interface AugmentPhaseDef {
  phase: number;
  /** 선두 말 진행도 기준 발동 지점 (0~1) */
  at: number;
  /** 선택 제한 시간 (ms) */
  durationMs: number;
}

/** 증강 지점보다 이만큼(코스 비율) 앞에서 카드를 미리 보여 주고 예약을 받는다 */
export const AUGMENT_PREVIEW_LEAD = 0.05;

export const AUGMENT_PHASES: AugmentPhaseDef[] = [
  { phase: 1, at: 0.1, durationMs: 7000 },
  { phase: 2, at: 0.3, durationMs: 6000 },
  { phase: 3, at: 0.5, durationMs: 6000 },
  { phase: 4, at: 0.7, durationMs: 5000 },
  { phase: 5, at: 0.9, durationMs: 5000 }
];

/** 같은 등급 안에서 희귀도별 가중치 (플래티넘 안에서 전설이 영웅보다 드물다) */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 55,
  rare: 30,
  epic: 12,
  legendary: 3
};

export const RARITY_INFO: Record<Rarity, { label: string; color: string }> = {
  common: { label: '일반', color: '#5c6672' },
  rare: { label: '희귀', color: '#1d4ed8' },
  epic: { label: '영웅', color: '#7e22ce' },
  legendary: { label: '전설', color: '#b45309' }
};

// ---------------- 증강 등급 (실버 / 골드 / 플래티넘) ----------------

/** 카드 희귀도 → 등급. 영웅과 전설은 플래티넘으로 묶는다 */
export const TIER_OF_RARITY: Record<Rarity, AugmentTier> = {
  common: 'silver',
  rare: 'gold',
  epic: 'platinum',
  legendary: 'platinum'
};

export const TIER_INFO: Record<AugmentTier, { label: string; emoji: string; color: string }> = {
  silver: { label: '실버', emoji: '🥈', color: '#5c6672' },
  gold: { label: '골드', emoji: '🥇', color: '#a16207' },
  platinum: { label: '플래티넘', emoji: '💎', color: '#0e7490' }
};

/** 구간별 등급 등장 가중치 — 뒤 구간일수록 높은 등급이 잘 나온다 */
export const PHASE_TIER_WEIGHTS: Record<number, Record<AugmentTier, number>> = {
  1: { silver: 65, gold: 28, platinum: 7 },
  2: { silver: 50, gold: 37, platinum: 13 },
  3: { silver: 38, gold: 42, platinum: 20 },
  4: { silver: 28, gold: 42, platinum: 30 },
  5: { silver: 20, gold: 40, platinum: 40 }
};

/** 등급 안에 뽑을 카드가 모자랄 때 채워 넣는 순서 */
export const TIER_FALLBACK: Record<AugmentTier, AugmentTier[]> = {
  silver: ['gold', 'platinum'],
  gold: ['silver', 'platinum'],
  platinum: ['gold', 'silver']
};

/** 플레이어당 증강 구간마다 제시되는 카드 수 */
export const CARDS_PER_PHASE = 3;

// ---------------- 방 ----------------

export const MIN_PLAYERS_TO_START = 2; // NPC 포함
export const MAX_PLAYERS_LIMIT = 8;
export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 5;

/** 서버 포트 */
export const SERVER_PORT = 3001;

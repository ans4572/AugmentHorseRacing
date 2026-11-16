// ============================================================
// 마구간 — 내 말 꾸미기 카탈로그와 당근(누적 화폐) 보상 규칙
// 꾸미기는 겉모습만 바꾸며 능력치에는 영향을 주지 않는다.
// ============================================================
import type { CosmeticSlot, HorseBreed, HorseLook } from './types';

export interface CosmeticItem {
  id: string;
  slot: CosmeticSlot;
  name: string;
  emoji: string;
  /** 당근 가격 (0 = 처음부터 보유) */
  price: number;
  /** 색이 있는 항목의 색상 */
  color?: string;
  /** 종류 항목이 가리키는 말 종류 */
  breed?: HorseBreed;
}

export const SLOT_LABELS: Record<CosmeticSlot, string> = {
  breed: '종류',
  coat: '털 색',
  hat: '모자',
  neck: '목',
  face: '얼굴',
  trail: '발자국'
};

export const SLOT_ORDER: CosmeticSlot[] = ['breed', 'coat', 'hat', 'neck', 'face', 'trail'];

export const COSMETICS: CosmeticItem[] = [
  // 종류
  { id: 'breed_horse', slot: 'breed', name: '말', emoji: '🐎', price: 0, breed: 'horse' },
  { id: 'breed_donkey', slot: 'breed', name: '당나귀', emoji: '🐴', price: 150, breed: 'donkey' },
  { id: 'breed_cow', slot: 'breed', name: '젖소 무늬 말', emoji: '🐮', price: 200, breed: 'cow' },
  { id: 'breed_zebra', slot: 'breed', name: '얼룩말', emoji: '🦓', price: 250, breed: 'zebra' },
  { id: 'breed_unicorn', slot: 'breed', name: '유니콘', emoji: '🦄', price: 400, breed: 'unicorn' },
  { id: 'breed_alpaca', slot: 'breed', name: '알파카', emoji: '🦙', price: 300, breed: 'alpaca' },
  { id: 'breed_camel', slot: 'breed', name: '낙타', emoji: '🐫', price: 300, breed: 'camel' },
  { id: 'breed_pegasus', slot: 'breed', name: '흑마 페가수스', emoji: '🪽', price: 450, breed: 'pegasus' },
  // 털 색
  { id: 'coat_lane', slot: 'coat', name: '레인 색 그대로', emoji: '🎽', price: 0 },
  { id: 'coat_choco', slot: 'coat', name: '초코', emoji: '🍫', price: 0, color: '#7a4a2a' },
  { id: 'coat_cream', slot: 'coat', name: '크림', emoji: '🍦', price: 0, color: '#f3e2bb' },
  { id: 'coat_black', slot: 'coat', name: '까망', emoji: '🖤', price: 0, color: '#34343d' },
  { id: 'coat_pink', slot: 'coat', name: '딸기우유', emoji: '🍓', price: 0, color: '#ff8fb8' },
  { id: 'coat_mint', slot: 'coat', name: '민트초코', emoji: '🌿', price: 0, color: '#63e6be' },
  { id: 'coat_gold', slot: 'coat', name: '황금', emoji: '✨', price: 0, color: '#ffd43b' },
  { id: 'coat_snow', slot: 'coat', name: '눈꽃', emoji: '❄️', price: 0, color: '#f8f9fa' },
  { id: 'coat_ash', slot: 'coat', name: '잿빛', emoji: '🩶', price: 0, color: '#9aa1ab' },
  { id: 'coat_sky', slot: 'coat', name: '하늘', emoji: '🩵', price: 0, color: '#74c0fc' },
  { id: 'coat_navy', slot: 'coat', name: '밤하늘', emoji: '🌌', price: 0, color: '#364fc7' },
  { id: 'coat_lavender', slot: 'coat', name: '라벤더', emoji: '💜', price: 0, color: '#b197fc' },
  { id: 'coat_coral', slot: 'coat', name: '코랄', emoji: '🪸', price: 0, color: '#ff8787' },
  { id: 'coat_carrot', slot: 'coat', name: '당근', emoji: '🥕', price: 0, color: '#ff922b' },
  { id: 'coat_lemon', slot: 'coat', name: '레몬', emoji: '🍋', price: 0, color: '#ffec99' },
  { id: 'coat_matcha', slot: 'coat', name: '말차', emoji: '🍵', price: 0, color: '#94d82d' },
  { id: 'coat_wine', slot: 'coat', name: '와인', emoji: '🍷', price: 0, color: '#a61e4d' },
  // 모자
  { id: 'hat_none', slot: 'hat', name: '없음', emoji: '🚫', price: 0 },
  { id: 'hat_party', slot: 'hat', name: '고깔모자', emoji: '🥳', price: 100 },
  { id: 'hat_straw', slot: 'hat', name: '밀짚모자', emoji: '👒', price: 120 },
  { id: 'hat_tophat', slot: 'hat', name: '신사 모자', emoji: '🎩', price: 200 },
  { id: 'hat_propeller', slot: 'hat', name: '프로펠러 모자', emoji: '🚁', price: 250 },
  { id: 'hat_crown', slot: 'hat', name: '왕관', emoji: '👑', price: 500 },
  { id: 'hat_bunny', slot: 'hat', name: '토끼귀 머리띠', emoji: '🐰', price: 130 },
  { id: 'hat_santa', slot: 'hat', name: '산타 모자', emoji: '🎅', price: 150 },
  { id: 'hat_helmet', slot: 'hat', name: '기수 헬멧', emoji: '⛑️', price: 160 },
  { id: 'hat_cowboy', slot: 'hat', name: '카우보이 모자', emoji: '🤠', price: 180 },
  { id: 'hat_wizard', slot: 'hat', name: '마법사 모자', emoji: '🧙', price: 220 },
  // 목
  { id: 'neck_none', slot: 'neck', name: '없음', emoji: '🚫', price: 0 },
  { id: 'neck_scarf', slot: 'neck', name: '빨간 목도리', emoji: '🧣', price: 80, color: '#e03131' },
  { id: 'neck_scarf_blue', slot: 'neck', name: '파란 목도리', emoji: '🧣', price: 80, color: '#228be6' },
  { id: 'neck_scarf_yellow', slot: 'neck', name: '노란 목도리', emoji: '🧣', price: 80, color: '#fcc419' },
  { id: 'neck_bell', slot: 'neck', name: '방울', emoji: '🔔', price: 100 },
  { id: 'neck_tie', slot: 'neck', name: '넥타이', emoji: '👔', price: 120, color: '#1c7ed6' },
  { id: 'neck_lei', slot: 'neck', name: '꽃목걸이', emoji: '🌺', price: 140 },
  { id: 'neck_bowtie', slot: 'neck', name: '나비넥타이', emoji: '🎀', price: 120, color: '#7048e8' },
  { id: 'neck_medal', slot: 'neck', name: '금메달', emoji: '🥇', price: 300 },
  { id: 'neck_rosette', slot: 'neck', name: '우승 리본', emoji: '🎗️', price: 250 },
  // 얼굴
  { id: 'face_none', slot: 'face', name: '없음', emoji: '🚫', price: 0 },
  { id: 'face_shades', slot: 'face', name: '선글라스', emoji: '🕶️', price: 150, color: '#111114' },
  { id: 'face_heart', slot: 'face', name: '분홍 안경', emoji: '💗', price: 180, color: '#ff4d8d' },
  { id: 'face_blush', slot: 'face', name: '볼터치', emoji: '☺️', price: 80 },
  { id: 'face_mustache', slot: 'face', name: '콧수염', emoji: '🥸', price: 120 },
  { id: 'face_monocle', slot: 'face', name: '외알 안경', emoji: '🧐', price: 140 },
  { id: 'face_eyepatch', slot: 'face', name: '해적 안대', emoji: '🏴‍☠️', price: 150 },
  { id: 'face_mask', slot: 'face', name: '쾌걸 가면', emoji: '🎭', price: 180 },
  // 발자국
  { id: 'trail_dust', slot: 'trail', name: '흙먼지', emoji: '💨', price: 0 },
  { id: 'trail_pink', slot: 'trail', name: '분홍 구름', emoji: '🌸', price: 100, color: '#ffa8d0' },
  { id: 'trail_gold', slot: 'trail', name: '금가루', emoji: '🌟', price: 200, color: '#ffd43b' },
  { id: 'trail_rainbow', slot: 'trail', name: '무지개', emoji: '🌈', price: 300 },
  { id: 'trail_carrot', slot: 'trail', name: '당근', emoji: '🥕', price: 120, color: '#ff922b' },
  { id: 'trail_heart', slot: 'trail', name: '하트', emoji: '💗', price: 150, color: '#ff8fb8' },
  { id: 'trail_note', slot: 'trail', name: '음표', emoji: '🎵', price: 150, color: '#b197fc' },
  { id: 'trail_snow', slot: 'trail', name: '눈송이', emoji: '❄️', price: 180, color: '#d0ebff' },
  { id: 'trail_fire', slot: 'trail', name: '불꽃', emoji: '🔥', price: 220, color: '#ff922b' }
];

export const COSMETIC_BY_ID: Record<string, CosmeticItem> = Object.fromEntries(
  COSMETICS.map((c) => [c.id, c])
);

export const DEFAULT_LOOK: HorseLook = {
  breed: 'breed_horse',
  coat: 'coat_lane',
  hat: 'hat_none',
  neck: 'neck_none',
  face: 'face_none',
  trail: 'trail_dust'
};

export const DEFAULT_HORSE_NAME = '당근이';
export const HORSE_NAME_MAX = 8;

/** 처음 마구간을 열면 주는 당근 (처음 온 사람은 이것만 받고 아래 선물은 받지 않는다) */
export const WELCOME_CARROTS = 1000;

/**
 * 이미 마구간이 있는 브라우저에 한 번씩 주는 당근 선물.
 * 처음 온 사람은 이 선물들을 이미 받은 것으로 치고 시작하므로 WELCOME_CARROTS만 받는다.
 * 받은 선물 id는 브라우저에 남으므로, 같은 id로는 두 번 받지 않는다. 새로 주려면 id가 다른 항목을 더한다.
 */
export const CARROT_PROMOS: readonly { id: string; carrots: number }[] = [
  { id: 'promo-2026-11-carrot-1000', carrots: 1000 }
];
/** 내 말의 라운드 순위(1~6위)별 당근 상금 */
export const ROUND_PRIZE_CARROTS = [60, 40, 25, 10, 10, 10];
/** 게임 최종 순위(1위, 2위, 3위)별 당근 보너스. 그 아래 순위는 PLACEMENT_CARROTS_OTHER */
export const PLACEMENT_CARROTS = [120, 70, 40];
export const PLACEMENT_CARROTS_OTHER = 15;
/** 배팅 순이익의 이 비율만큼 당근으로 받는다 (상한 있음) */
export const PROFIT_CARROT_RATE = 0.1;
export const PROFIT_CARROT_CAP = 200;

export function roundPrizeCarrots(rank: number): number {
  return ROUND_PRIZE_CARROTS[rank - 1] ?? 0;
}

export function placementCarrots(rank: number): number {
  return PLACEMENT_CARROTS[rank - 1] ?? PLACEMENT_CARROTS_OTHER;
}

export function profitCarrots(netProfit: number): number {
  if (netProfit <= 0) return 0;
  return Math.min(PROFIT_CARROT_CAP, Math.floor(netProfit * PROFIT_CARROT_RATE));
}

/** 받은 꾸미기 값을 검증한다 — 모르는 항목이나 칸이 맞지 않는 항목은 기본값으로 바꾼다 */
export function sanitizeLook(raw: unknown): HorseLook {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const look: HorseLook = { ...DEFAULT_LOOK };
  for (const slot of SLOT_ORDER) {
    const item = COSMETIC_BY_ID[String(src[slot] ?? '')];
    if (item && item.slot === slot) look[slot] = item.id;
  }
  return look;
}

export function sanitizeHorseName(raw: unknown): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, HORSE_NAME_MAX);
  return s.length > 0 ? s : DEFAULT_HORSE_NAME;
}

export function lookBreed(look: HorseLook): HorseBreed {
  return COSMETIC_BY_ID[look.breed]?.breed ?? 'horse';
}

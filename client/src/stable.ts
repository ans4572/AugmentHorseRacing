import type { CosmeticSlot, HorseLook, MyHorseEntry, OwnerBonus, OwnerPrize } from '../../shared/src/types';
import {
  COSMETIC_BY_ID,
  DEFAULT_HORSE_NAME,
  DEFAULT_LOOK,
  WELCOME_CARROTS,
  sanitizeHorseName,
  sanitizeLook
} from '../../shared/src/stable';

// ============================================================
// 마구간 저장소 — 당근, 보유 꾸미기, 내 말의 모습을 이 브라우저에 저장한다.
// 계정이 없으므로 브라우저를 바꾸거나 저장 기록을 지우면 초기화된다.
// ============================================================

const KEY = 'augment-derby-stable-v1';
/** 중복 지급 방지 키를 이만큼만 기억한다 */
const CLAIM_MEMORY = 60;

export interface StableData {
  carrots: number;
  /** 구매한 꾸미기 항목 ID (가격 0인 기본 항목은 넣지 않아도 보유로 본다) */
  owned: string[];
  name: string;
  look: HorseLook;
  claimed: string[];
  stats: { races: number; wins: number; podiums: number; games: number; earned: number };
}

function fresh(): StableData {
  return {
    carrots: WELCOME_CARROTS,
    owned: [],
    name: DEFAULT_HORSE_NAME,
    look: { ...DEFAULT_LOOK },
    claimed: [],
    stats: { races: 0, wins: 0, podiums: 0, games: 0, earned: 0 }
  };
}

let data: StableData = read() ?? fresh();

/** 저장된 값을 읽는다. 저장된 것이 없거나 읽을 수 없으면 null */
function read(): StableData | null {
  const base = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StableData>;
    const num = (v: unknown, d = 0): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d;
    const out: StableData = {
      carrots: num(p.carrots, base.carrots),
      owned: Array.isArray(p.owned) ? p.owned.filter((id) => !!COSMETIC_BY_ID[String(id)]).map(String) : [],
      name: sanitizeHorseName(p.name),
      look: sanitizeLook(p.look),
      claimed: Array.isArray(p.claimed) ? p.claimed.map(String).slice(-CLAIM_MEMORY) : [],
      stats: {
        races: num(p.stats?.races),
        wins: num(p.stats?.wins),
        podiums: num(p.stats?.podiums),
        games: num(p.stats?.games),
        earned: num(p.stats?.earned)
      }
    };
    // 보유하지 않은 항목을 입고 있으면 기본값으로 되돌린다
    for (const slot of Object.keys(out.look) as CosmeticSlot[]) {
      if (!ownedIn(out, out.look[slot])) out.look[slot] = DEFAULT_LOOK[slot];
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * 고치기 전에 저장된 최신 값을 다시 읽는다. 탭을 여러 개 띄워 두면 다른 탭이 그사이에
 * 사거나 입힌 것이 있는데, 이 탭이 예전에 읽어 둔 값으로 덮어쓰면 그 꾸미기가 사라진다.
 */
function sync(): void {
  const latest = read();
  if (latest) data = latest;
}

let externalChange: () => void = () => {};

/** 다른 탭에서 마구간이 바뀌었을 때 화면을 고칠 함수를 등록한다 */
export function onStableChange(listener: () => void): void {
  externalChange = listener;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key !== KEY) return;
    sync();
    externalChange();
  });
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* 저장 공간을 쓸 수 없는 환경 — 이번 접속 동안만 유지된다 */
  }
}

function ownedIn(d: StableData, id: string): boolean {
  const item = COSMETIC_BY_ID[id];
  return !!item && (item.price === 0 || d.owned.includes(id));
}

export function stable(): StableData {
  return data;
}

export function isOwned(id: string): boolean {
  return ownedIn(data, id);
}

/** 서버에 보낼 내 말 정보 */
export function myHorseEntry(): MyHorseEntry {
  return { name: data.name, look: { ...data.look } };
}

export function setHorseName(raw: string): void {
  sync();
  data.name = sanitizeHorseName(raw);
  save();
}

/** 보유한 항목을 착용한다 */
export function equip(id: string): boolean {
  sync();
  const item = COSMETIC_BY_ID[id];
  if (!item || !isOwned(id)) return false;
  data.look[item.slot] = id;
  save();
  return true;
}

/** 당근으로 항목을 사고 바로 착용한다 */
export function buy(id: string): 'ok' | 'owned' | 'poor' | 'unknown' {
  sync();
  const item = COSMETIC_BY_ID[id];
  if (!item) return 'unknown';
  if (isOwned(id)) return 'owned';
  if (data.carrots < item.price) return 'poor';
  data.carrots -= item.price;
  data.owned.push(id);
  data.look[item.slot] = id;
  save();
  return 'ok';
}

function claim(key: string, carrots: number): boolean {
  sync();
  if (data.claimed.includes(key)) return false;
  data.claimed.push(key);
  data.claimed = data.claimed.slice(-CLAIM_MEMORY);
  data.carrots += carrots;
  data.stats.earned += carrots;
  return true;
}

/** 내 말의 라운드 상금을 받는다. 이미 받은 상금이면 false */
export function claimRoundPrize(prize: OwnerPrize): boolean {
  if (!claim(prize.key, prize.carrots)) return false;
  data.stats.races++;
  if (prize.rank === 1) data.stats.wins++;
  if (prize.rank <= 3) data.stats.podiums++;
  save();
  return true;
}

/** 게임 종료 보너스를 받는다. 이미 받았으면 false */
export function claimGameBonus(bonus: OwnerBonus): boolean {
  if (!claim(bonus.key, bonus.placementCarrots + bonus.profitCarrots)) return false;
  data.stats.games++;
  save();
  return true;
}

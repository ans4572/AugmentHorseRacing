import type { CosmeticSlot, HorseLook, MyHorseEntry, OwnerBonus, OwnerPrize } from '../../shared/src/types';
import {
  COSMETIC_BY_ID,
  DEFAULT_HORSE_NAME,
  DEFAULT_LOOK,
  MAX_HORSES,
  NEW_HORSE_NAMES,
  WELCOME_CARROTS,
  CARROT_PROMOS,
  sanitizeHorseName,
  sanitizeLook
} from '../../shared/src/stable';

// ============================================================
// 마구간 저장소 — 당근, 보유 꾸미기, 내 말(최대 3마리)의 모습을 이 브라우저에 저장한다.
// 꾸미기는 한 번 사면 모든 말이 함께 쓴다. 게임에는 출전마(active) 한 마리만 나간다.
// 계정이 없으므로 브라우저를 바꾸거나 저장 기록을 지우면 초기화된다.
// ============================================================

const KEY = 'augment-derby-stable-v1';
/** 중복 지급 방지 키를 이만큼만 기억한다 */
const CLAIM_MEMORY = 60;

export interface StableHorse {
  name: string;
  look: HorseLook;
}

export interface StableData {
  carrots: number;
  /** 구매한 꾸미기 항목 ID (가격 0인 기본 항목은 넣지 않아도 보유로 본다) */
  owned: string[];
  /** 내 말들 (1~MAX_HORSES마리) */
  horses: StableHorse[];
  /** 게임에 출전하는 말의 번호 (horses 안의 순서) */
  active: number;
  claimed: string[];
  /** 이미 받은 당근 선물(CARROT_PROMOS) id. claimed와 달리 오래돼도 지우지 않는다 (지우면 같은 선물을 또 받는다) */
  promos: string[];
  stats: { races: number; wins: number; podiums: number; games: number; earned: number };
}

function fresh(): StableData {
  return {
    carrots: WELCOME_CARROTS,
    owned: [],
    horses: [{ name: DEFAULT_HORSE_NAME, look: { ...DEFAULT_LOOK } }],
    active: 0,
    claimed: [],
    // 처음 온 사람은 시작 당근만 받는다: 지금 있는 선물은 받은 것으로 친다
    promos: CARROT_PROMOS.map((p) => p.id),
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
    const p = JSON.parse(raw) as Partial<StableData> & { name?: unknown; look?: unknown };
    const num = (v: unknown, d = 0): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d;
    const out: StableData = {
      carrots: num(p.carrots, base.carrots),
      owned: Array.isArray(p.owned) ? p.owned.filter((id) => !!COSMETIC_BY_ID[String(id)]).map(String) : [],
      // 말이 한 마리뿐이던 때의 기록은 name, look만 있다 → 첫 번째 말로 옮긴다
      horses: (Array.isArray(p.horses) && p.horses.length > 0 ? p.horses : [{ name: p.name, look: p.look }])
        .slice(0, MAX_HORSES)
        .map((h) => ({ name: sanitizeHorseName(h?.name), look: sanitizeLook(h?.look) })),
      active: 0,
      claimed: Array.isArray(p.claimed) ? p.claimed.map(String).slice(-CLAIM_MEMORY) : [],
      // 저장된 기록에 선물 목록이 없으면 선물이 생기기 전부터 있던 마구간이다 → 선물을 받는다
      promos: Array.isArray(p.promos) ? p.promos.map(String).slice(-100) : [],
      stats: {
        races: num(p.stats?.races),
        wins: num(p.stats?.wins),
        podiums: num(p.stats?.podiums),
        games: num(p.stats?.games),
        earned: num(p.stats?.earned)
      }
    };
    const active = num(p.active);
    out.active = active < out.horses.length ? active : 0;
    // 보유하지 않은 항목을 입고 있으면 기본값으로 되돌린다
    for (const h of out.horses) {
      for (const slot of Object.keys(h.look) as CosmeticSlot[]) {
        if (!ownedIn(out, h.look[slot])) h.look[slot] = DEFAULT_LOOK[slot];
      }
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
    // name, look에는 출전마를 함께 적어 둔다: 새로 고치기 전의 탭이 열려 있어도 출전마는 그대로 읽힌다
    const active = activeHorse();
    localStorage.setItem(KEY, JSON.stringify({ ...data, name: active.name, look: active.look }));
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

/** 출전하는 말 */
export function activeHorse(): StableHorse {
  return data.horses[data.active] ?? data.horses[0];
}

/** index번 말 (없으면 출전마) */
export function horseAt(index: number): StableHorse {
  return data.horses[index] ?? activeHorse();
}

/** 서버에 보낼 내 말 정보 (출전마) */
export function myHorseEntry(): MyHorseEntry {
  const h = activeHorse();
  return { name: h.name, look: { ...h.look } };
}

/** index번 말을 출전마로 정한다 */
export function setActiveHorse(index: number): boolean {
  sync();
  if (!data.horses[index]) return false;
  data.active = index;
  save();
  return true;
}

/** 빈 칸에 새 말을 들인다. 새 말의 번호를 돌려준다 (칸이 다 찼으면 null) */
export function addHorse(): number | null {
  sync();
  if (data.horses.length >= MAX_HORSES) return null;
  const used = new Set(data.horses.map((h) => h.name));
  const name = NEW_HORSE_NAMES.find((n) => !used.has(n)) ?? `${DEFAULT_HORSE_NAME}${data.horses.length + 1}`;
  data.horses.push({ name: sanitizeHorseName(name), look: { ...DEFAULT_LOOK } });
  save();
  return data.horses.length - 1;
}

/** index번 말을 내보낸다. 마지막 한 마리는 내보낼 수 없다 */
export function removeHorse(index: number): boolean {
  sync();
  if (data.horses.length <= 1 || !data.horses[index]) return false;
  data.horses.splice(index, 1);
  if (data.active === index) data.active = 0;
  else if (data.active > index) data.active--;
  save();
  return true;
}

export function setHorseName(index: number, raw: string): void {
  sync();
  const h = data.horses[index];
  if (!h) return;
  h.name = sanitizeHorseName(raw);
  save();
}

/** 보유한 항목을 index번 말에 입힌다 */
export function equip(index: number, id: string): boolean {
  sync();
  const item = COSMETIC_BY_ID[id];
  const h = data.horses[index];
  if (!item || !h || !isOwned(id)) return false;
  h.look[item.slot] = id;
  save();
  return true;
}

/** 당근으로 항목을 사고 index번 말에 바로 입힌다 */
export function buy(index: number, id: string): 'ok' | 'owned' | 'poor' | 'unknown' {
  sync();
  const item = COSMETIC_BY_ID[id];
  const h = data.horses[index];
  if (!item || !h) return 'unknown';
  if (isOwned(id)) return 'owned';
  if (data.carrots < item.price) return 'poor';
  data.carrots -= item.price;
  data.owned.push(id);
  h.look[item.slot] = id;
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

/** 아직 안 받은 당근 선물(CARROT_PROMOS)을 받는다. 이번에 받은 당근 합계를 돌려준다 (없으면 0) */
export function claimPromos(): number {
  sync();
  let total = 0;
  for (const promo of CARROT_PROMOS) {
    if (data.promos.includes(promo.id)) continue;
    data.promos.push(promo.id);
    data.carrots += promo.carrots;
    data.stats.earned += promo.carrots;
    total += promo.carrots;
  }
  if (total > 0) save();
  return total;
}

/** 관리자가 보낸 당근 선물을 받는다. 같은 선물은 한 번만 */
export function claimGift(giftId: string, carrots: number): boolean {
  if (!Number.isInteger(carrots) || carrots < 1) return false;
  if (!claim(`gift:${giftId}`, carrots)) return false;
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

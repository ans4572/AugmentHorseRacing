import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HORSE_NAME, DEFAULT_LOOK, MAX_HORSES } from '../../shared/src/stable';

// 브라우저 마구간 저장소(client/src/stable.ts)를 가짜 localStorage 위에서 돌린다
const KEY = 'augment-derby-stable-v1';
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear()
};

async function load(saved?: unknown) {
  store.clear();
  if (saved !== undefined) store.set(KEY, JSON.stringify(saved));
  vi.resetModules();
  return import('../../client/src/stable');
}

describe('마구간 말 여러 마리', () => {
  beforeEach(() => store.clear());

  it('처음 온 사람은 말 한 마리로 시작한다', async () => {
    const st = await load();
    expect(st.stable().horses).toHaveLength(1);
    expect(st.myHorseEntry()).toEqual({ name: DEFAULT_HORSE_NAME, look: DEFAULT_LOOK });
  });

  it('한 마리뿐이던 옛 기록은 첫 번째 말로 옮긴다', async () => {
    const st = await load({ carrots: 300, owned: ['hat_crown'], name: '번개', look: { ...DEFAULT_LOOK, hat: 'hat_crown' } });
    expect(st.stable().horses).toEqual([{ name: '번개', look: { ...DEFAULT_LOOK, hat: 'hat_crown' } }]);
    expect(st.stable().active).toBe(0);
    expect(st.myHorseEntry().name).toBe('번개');
  });

  it(`최대 ${MAX_HORSES}마리까지 들이고, 고른 말이 출전한다`, async () => {
    const st = await load();
    expect(st.addHorse()).toBe(1);
    expect(st.addHorse()).toBe(2);
    expect(st.addHorse()).toBeNull();
    const names = st.stable().horses.map((h) => h.name);
    expect(new Set(names).size).toBe(MAX_HORSES);

    st.setHorseName(2, '셋째');
    expect(st.setActiveHorse(2)).toBe(true);
    expect(st.myHorseEntry().name).toBe('셋째');
    expect(st.setActiveHorse(5)).toBe(false);

    // 다시 읽어도 그대로
    const saved = JSON.parse(store.get(KEY)!);
    const again = await load(saved);
    expect(again.stable().active).toBe(2);
    expect(again.myHorseEntry().name).toBe('셋째');
    // 옛 코드가 읽는 name, look에는 출전마가 적혀 있다
    expect(saved.name).toBe('셋째');
  });

  it('산 꾸미기는 모든 말이 함께 쓰고, 입히는 것은 말마다 따로다', async () => {
    const st = await load({ carrots: 1000, owned: [], name: '하나', look: DEFAULT_LOOK });
    st.addHorse();
    expect(st.buy(1, 'hat_crown')).toBe('ok');
    expect(st.stable().horses[1].look.hat).toBe('hat_crown');
    expect(st.stable().horses[0].look.hat).toBe(DEFAULT_LOOK.hat);
    expect(st.buy(0, 'hat_crown')).toBe('owned');
    expect(st.equip(0, 'hat_crown')).toBe(true);
    expect(st.stable().horses[0].look.hat).toBe('hat_crown');
  });

  it('말을 내보내도 출전마가 어긋나지 않고, 마지막 한 마리는 남는다', async () => {
    const st = await load();
    st.addHorse();
    st.addHorse();
    st.setHorseName(2, '막내');
    st.setActiveHorse(2);
    expect(st.removeHorse(0)).toBe(true);
    expect(st.myHorseEntry().name).toBe('막내');
    expect(st.removeHorse(1)).toBe(true);
    expect(st.stable().active).toBe(0);
    expect(st.removeHorse(0)).toBe(false);
    expect(st.stable().horses).toHaveLength(1);
  });

  it('망가진 기록은 고쳐 읽는다 (칸 수 초과, 없는 출전 번호)', async () => {
    const h = { name: 'x', look: DEFAULT_LOOK };
    const st = await load({ horses: [h, h, h, h, h], active: 9 });
    expect(st.stable().horses).toHaveLength(MAX_HORSES);
    expect(st.stable().active).toBe(0);
  });
});

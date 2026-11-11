import { afterEach, describe, expect, it } from 'vitest';
import type { OwnerBonus, OwnerPrize, RankingEntry, S2C } from '../../shared/src/types';
import {
  COSMETICS,
  COSMETIC_BY_ID,
  DEFAULT_HORSE_NAME,
  DEFAULT_LOOK,
  HORSE_NAME_MAX,
  PROFIT_CARROT_CAP,
  SLOT_ORDER,
  placementCarrots,
  profitCarrots,
  roundPrizeCarrots,
  sanitizeHorseName,
  sanitizeLook
} from '../../shared/src/stable';
import { BREED_INFO } from '../../shared/src/names';
import { AUGMENT_BY_ID } from '../../shared/src/augments';
import { Room, type Player } from '../src/game/room';
import { npcChooseAugment } from '../src/game/npc';
import { generateHorses } from '../src/sim/horses';
import { RaceSim } from '../src/sim/race';
import { mulberry32 } from '../src/sim/rng';

function makeHuman(id: string, name: string, inbox?: S2C[]): Player {
  return {
    id,
    secret: 's-' + id,
    name,
    isNpc: false,
    socket: inbox ? { send: (data: string) => inbox.push(JSON.parse(data)) } : null,
    connected: true,
    coins: 0,
    coinsAtBettingStart: 0,
    readyPreview: false,
    readyBetting: false,
    hits: 0,
    netProfit: 0,
    hostileUses: 0,
    bestRoundNet: 0
  };
}

const cleanups: Room[] = [];
afterEach(() => {
  for (const r of cleanups.splice(0)) {
    r.onEmpty = null;
    r.destroy('테스트 종료');
  }
});

const LOOK = sanitizeLook({ breed: 'breed_zebra', hat: 'hat_crown', trail: 'trail_rainbow' });

function soloRoom(totalRounds: number, withHorse = true): { room: Room; inbox: S2C[] } {
  const room = new Room(
    'SOLO01',
    { roomName: '혼자 하기', isPrivate: true, maxPlayers: 6, totalRounds },
    'p1'
  );
  cleanups.push(room);
  const inbox: S2C[] = [];
  room.addPlayer(makeHuman('p1', '나', inbox));
  for (let i = 0; i < 5; i++) room.addNpc();
  if (withHorse) room.ownerHorse = { playerId: 'p1', name: '당근이', look: LOOK };
  return { room, inbox };
}

type Internals = {
  lastRankings: RankingEntry[] | null;
  settleRound(): void;
};

/** 내 말이 원하는 순위로 들어온 것으로 하고 라운드를 정산한다 */
function finishRound(room: Room, ownerRank: number): void {
  const mine = room.horses.find((h) => h.ownerId)!;
  const others = room.horses.filter((h) => h !== mine).map((h) => h.id);
  const order = [...others];
  order.splice(ownerRank - 1, 0, mine.id);
  const internals = room as unknown as Internals;
  internals.lastRankings = order.map((horseId, i) => ({ horseId, rank: i + 1, timeMs: 40000 + i * 500 }));
  internals.settleRound();
}

describe('꾸미기 카탈로그', () => {
  it('항목 ID는 겹치지 않고, 칸마다 무료 기본 항목이 있다', () => {
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
    for (const slot of SLOT_ORDER) {
      const def = COSMETIC_BY_ID[DEFAULT_LOOK[slot]];
      expect(def.slot).toBe(slot);
      expect(def.price).toBe(0);
      // 기본 항목 말고는 전부 당근으로 사야 한다
      for (const c of COSMETICS.filter((x) => x.slot === slot && x.id !== def.id)) {
        expect(c.price).toBeGreaterThan(0);
      }
    }
  });

  it('종류 항목은 게임에 있는 말 종류를 모두 다룬다', () => {
    const breeds = COSMETICS.filter((c) => c.slot === 'breed').map((c) => c.breed);
    expect(new Set(breeds)).toEqual(new Set(Object.keys(BREED_INFO)));
  });

  it('모르는 항목과 칸이 맞지 않는 항목은 기본값으로 바꾼다', () => {
    expect(sanitizeLook(null)).toEqual(DEFAULT_LOOK);
    expect(sanitizeLook('엉뚱한 값')).toEqual(DEFAULT_LOOK);
    const look = sanitizeLook({ breed: 'hat_crown', coat: 'coat_gold', hat: '없는모자', neck: 42 });
    expect(look.breed).toBe('breed_horse'); // 모자를 종류 칸에 넣을 수 없다
    expect(look.coat).toBe('coat_gold');
    expect(look.hat).toBe('hat_none');
    expect(look.neck).toBe('neck_none');
  });

  it('말 이름은 길이를 제한하고 비어 있으면 기본 이름을 쓴다', () => {
    expect(sanitizeHorseName('  번개  ')).toBe('번개');
    expect(sanitizeHorseName('')).toBe(DEFAULT_HORSE_NAME);
    expect(sanitizeHorseName(undefined)).toBe(DEFAULT_HORSE_NAME);
    expect(sanitizeHorseName('가나다라마바사아자차카타').length).toBe(HORSE_NAME_MAX);
  });
});

describe('당근 보상 규칙', () => {
  it('내 말 순위가 높을수록 상금이 크고, 꼴찌도 참가 상금을 받는다', () => {
    const prizes = [1, 2, 3, 4, 5, 6].map(roundPrizeCarrots);
    for (let i = 1; i < prizes.length; i++) expect(prizes[i]).toBeLessThanOrEqual(prizes[i - 1]);
    expect(prizes[0]).toBeGreaterThan(prizes[2]);
    expect(prizes[5]).toBeGreaterThan(0);
    expect(roundPrizeCarrots(7)).toBe(0);
  });

  it('최종 순위 보너스는 1위가 가장 크다', () => {
    expect(placementCarrots(1)).toBeGreaterThan(placementCarrots(2));
    expect(placementCarrots(3)).toBeGreaterThan(placementCarrots(4));
    expect(placementCarrots(6)).toBe(placementCarrots(4));
  });

  it('배팅 순이익 보너스는 이익일 때만 있고 상한이 있다', () => {
    expect(profitCarrots(-500)).toBe(0);
    expect(profitCarrots(0)).toBe(0);
    expect(profitCarrots(1000)).toBe(100);
    expect(profitCarrots(999999)).toBe(PROFIT_CARROT_CAP);
  });
});

describe('싱글 모드의 내 말', () => {
  it('매 라운드 정확히 한 마리가 내 말로 출전하고, 이름·종류·꾸미기가 적용된다', () => {
    const { room } = soloRoom(3);
    room.startGame('p1');
    const lanes = new Set<number>();
    for (let round = 1; round <= 12; round++) {
      (room as unknown as { startRound(r: number): void }).startRound(1);
      const mine = room.horses.filter((h) => h.ownerId);
      expect(mine).toHaveLength(1);
      expect(mine[0].ownerId).toBe('p1');
      expect(mine[0].name).toBe('당근이');
      expect(mine[0].breed).toBe('zebra');
      expect(mine[0].look).toEqual(LOOK);
      // 능력치는 다른 말과 같은 규칙으로 뽑은 값이다
      expect(mine[0].stats.speed).toBeGreaterThanOrEqual(20);
      expect(mine[0].stats.speed).toBeLessThanOrEqual(95);
      expect(new Set(room.horses.map((h) => h.name)).size).toBe(6);
      expect(room.odds[mine[0].id]).toBeDefined();
      lanes.add(mine[0].id);
    }
    // 레인은 고정이 아니다
    expect(lanes.size).toBeGreaterThan(1);
  });

  it('내 말을 등록하지 않은 방에는 주인 있는 말이 없다', () => {
    const { room, inbox } = soloRoom(1, false);
    room.startGame('p1');
    expect(room.horses.some((h) => h.ownerId)).toBe(false);
    room.setReady('p1', 'preview');
    room.setReady('p1', 'betting');
    const internals = room as unknown as Internals;
    internals.lastRankings = room.horses.map((h, i) => ({ horseId: h.id, rank: i + 1, timeMs: 40000 + i }));
    internals.settleRound();
    const result = inbox.find((m) => m.type === 'ROUND_RESULT') as Extract<S2C, { type: 'ROUND_RESULT' }>;
    expect(result.ownerPrize).toBeUndefined();
    room.nextRound('p1');
    const final = inbox.find((m) => m.type === 'GAME_RESULT') as Extract<S2C, { type: 'GAME_RESULT' }>;
    expect(final.ownerBonus).toBeUndefined();
  });

  it('내 말 순위에 따라 라운드 상금을 주고, 게임이 끝나면 보너스를 준다', () => {
    const { room, inbox } = soloRoom(2);
    room.startGame('p1');

    finishRound(room, 1);
    const r1 = inbox.filter((m) => m.type === 'ROUND_RESULT').pop() as Extract<S2C, { type: 'ROUND_RESULT' }>;
    const prize1 = r1.ownerPrize as OwnerPrize;
    expect(prize1.playerId).toBe('p1');
    expect(prize1.rank).toBe(1);
    expect(prize1.carrots).toBe(roundPrizeCarrots(1));
    expect(prize1.horseName).toBe('당근이');
    // 재접속해도 같은 상금 정보를 다시 받는다 (키가 같아 중복 지급되지 않는다)
    expect(room.buildSnapshot('p1').roundResult?.ownerPrize).toEqual(prize1);

    room.nextRound('p1');
    finishRound(room, 5);
    const r2 = inbox.filter((m) => m.type === 'ROUND_RESULT').pop() as Extract<S2C, { type: 'ROUND_RESULT' }>;
    const prize2 = r2.ownerPrize as OwnerPrize;
    expect(prize2.rank).toBe(5);
    expect(prize2.carrots).toBe(roundPrizeCarrots(5));
    expect(prize2.key).not.toBe(prize1.key);

    // 최종 결과: 1위로 끝나고 순이익 300을 낸 것으로 한다
    const me = room.players.get('p1')!;
    me.coins = 99999;
    me.netProfit = 300;
    room.nextRound('p1');
    const final = inbox.find((m) => m.type === 'GAME_RESULT') as Extract<S2C, { type: 'GAME_RESULT' }>;
    const bonus = final.ownerBonus as OwnerBonus;
    expect(bonus.playerId).toBe('p1');
    expect(bonus.placement).toBe(1);
    expect(bonus.placementCarrots).toBe(placementCarrots(1));
    expect(bonus.profitCarrots).toBe(30);
    expect(bonus.roundCarrots).toBe(roundPrizeCarrots(1) + roundPrizeCarrots(5));
    expect([prize1.key, prize2.key]).not.toContain(bonus.key);
    expect(room.buildSnapshot('p1').gameResult?.ownerBonus).toEqual(bonus);
  });

  it('같은 방에서 다시 하면 상금 키가 새로 만들어진다', () => {
    const { room, inbox } = soloRoom(1);
    room.startGame('p1');
    finishRound(room, 2);
    room.nextRound('p1');
    expect(room.restart('p1')).toBeNull();
    room.startGame('p1');
    finishRound(room, 2);
    const keys = inbox
      .filter((m) => m.type === 'ROUND_RESULT')
      .map((m) => (m as Extract<S2C, { type: 'ROUND_RESULT' }>).ownerPrize!.key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe('NPC의 내 말 견제', () => {
  const banana = AUGMENT_BY_ID['banana_peel'];

  function targetRate(ownerRank: number | null, npcBetsOnOwner = false): number {
    const sim = new RaceSim(generateHorses(mulberry32(5)), mulberry32(6));
    for (let i = 0; i < 100; i++) sim.tick(50);
    const ranking = sim.currentRanking();
    const owner = ownerRank == null ? null : ranking[ownerRank - 1];
    const watched = ranking[(ownerRank ?? 2) - 1];
    const rng = mulberry32(77);
    let hits = 0;
    const trials = 600;
    for (let i = 0; i < trials; i++) {
      const choice = npcChooseAugment(
        'winner',
        [banana],
        {
          sim,
          myBoostTargets: npcBetsOnOwner && owner != null ? [owner] : [],
          myHinderTargets: [],
          mostBetHorse: null,
          ownerHorse: owner
        },
        rng
      );
      if (choice?.targetHorseId === watched) hits++;
    }
    return hits / trials;
  }

  it('내 말이 2위 안에서 달리면 방해 카드로 종종 노린다', () => {
    expect(targetRate(null)).toBe(0); // 내 말이 없으면 2위 말은 노리지 않는다
    const rate = targetRate(2);
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.5);
  });

  it('내 말이 뒤처져 있거나 NPC가 내 말에 걸었으면 노리지 않는다', () => {
    expect(targetRate(4)).toBe(0);
    expect(targetRate(2, true)).toBe(0);
  });
});

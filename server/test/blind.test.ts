import { describe, expect, it, vi } from 'vitest';
import type { C2S, S2C } from '../../shared/src/types';
import { GameHub } from '../src/hub';
import { RaceSim } from '../src/sim/race';
import { mulberry32 } from '../src/sim/rng';
import { BET_TARGETS, drawCards } from '../src/game/deck';
import { generateHorses } from '../src/sim/horses';

function connect(hub: GameHub) {
  const got: S2C[] = [];
  const conn = hub.open((data) => got.push(JSON.parse(data)));
  return {
    got,
    send: (msg: C2S) => conn.message(JSON.stringify(msg)),
    last: <T extends S2C['type']>(type: T) => [...got].reverse().find((m) => m.type === type) as Extract<S2C, { type: T }> | undefined
  };
}

/** 두 사람 방을 만들고 배팅 단계까지 넘긴다 */
function toBetting(blindBets: boolean) {
  const hub = new GameHub();
  const a = connect(hub);
  a.send({ type: 'CREATE_ROOM', playerName: '가나', roomName: '시험', isPrivate: true, maxPlayers: 4, totalRounds: 1, npcCount: 0, blindBets });
  const room = [...hub.rooms.values()][0];
  const b = connect(hub);
  b.send({ type: 'JOIN_ROOM', playerName: '다라', code: room.id });
  a.send({ type: 'START_GAME' });
  a.send({ type: 'READY', phase: 'preview' });
  b.send({ type: 'READY', phase: 'preview' });
  vi.advanceTimersByTime(100);
  return { room, a, b };
}

describe('블라인드 배팅', () => {
  it('배팅 중에는 남의 코인을 배팅 전 금액으로 보여 준다 (얼마 걸었는지 새지 않는다)', () => {
    vi.useFakeTimers();
    try {
      const { room, a, b } = toBetting(true);
      expect(room.phase).toBe('betting');
      const bId = [...room.players.values()].find((p) => p.name === '다라')!.id;
      const start = room.players.get(bId)!.coins;
      b.send({ type: 'PLACE_BET', betType: 'winner', horseId: 1, amount: 300 });
      // 준비 완료를 누르면 참가자 목록이 모두에게 다시 간다
      b.send({ type: 'READY', phase: 'betting' });
      const seenByA = a.last('ROOM_UPDATE')!.players.find((p) => p.id === bId)!;
      const seenByB = b.last('ROOM_UPDATE')!.players.find((p) => p.id === bId)!;
      expect(seenByA.coins).toBe(start);
      expect(seenByB.coins).toBe(start - 300);
    } finally {
      vi.useRealTimers();
    }
  });

  it('블라인드가 아니면 남은 코인이 그대로 보인다', () => {
    vi.useFakeTimers();
    try {
      const { room, a, b } = toBetting(false);
      const bId = [...room.players.values()].find((p) => p.name === '다라')!.id;
      const start = room.players.get(bId)!.coins;
      b.send({ type: 'PLACE_BET', betType: 'winner', horseId: 1, amount: 300 });
      b.send({ type: 'READY', phase: 'betting' });
      expect(a.last('ROOM_UPDATE')!.players.find((p) => p.id === bId)!.coins).toBe(start - 300);
    } finally {
      vi.useRealTimers();
    }
  });

  it('블라인드 방에서는 배팅금으로 대상을 고르는 카드를 뽑지 않는다', () => {
    const sim = new RaceSim(generateHorses(mulberry32(3)), mulberry32(3));
    const bets = { win: new Map([[1, 500], [2, 10]]), total: new Map([[1, 500], [2, 10]]) };
    let seenOpen = false;
    for (const tier of ['silver', 'gold', 'platinum'] as const) {
      for (let i = 0; i < 80; i++) {
        const open = drawCards(sim, 1, tier, bets, mulberry32(i), false);
        if (open.some((c) => BET_TARGETS.has(c.targetType))) seenOpen = true;
        const blind = drawCards(sim, 1, tier, bets, mulberry32(i), true);
        expect(blind.some((c) => BET_TARGETS.has(c.targetType))).toBe(false);
      }
    }
    // 블라인드가 아니면 이런 카드도 나온다 (걸러 낸 것이 의미가 있는지 확인)
    expect(seenOpen).toBe(true);
  });
});

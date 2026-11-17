import { describe, expect, it, vi } from 'vitest';
import type { C2S, S2C } from '../../shared/src/types';
import { GameHub } from '../src/hub';

function connect(hub: GameHub) {
  const got: S2C[] = [];
  const conn = hub.open((data) => got.push(JSON.parse(data)));
  return {
    got,
    send: (msg: C2S) => conn.message(JSON.stringify(msg)),
    all: <T extends S2C['type']>(type: T) => got.filter((m) => m.type === type) as Extract<S2C, { type: T }>[]
  };
}

/** 방을 하나 만들고 다른 사람을 들여보낸 뒤, 방 단계를 바로 바꿔 둔다 */
function roomWithTwo(phase: 'lobby' | 'racing' | 'countdown' | 'betting') {
  const hub = new GameHub();
  const a = connect(hub);
  a.send({ type: 'CREATE_ROOM', playerName: '가나', roomName: '시험', isPrivate: true, maxPlayers: 4, totalRounds: 1, npcCount: 0 });
  const room = [...hub.rooms.values()][0];
  const b = connect(hub);
  b.send({ type: 'JOIN_ROOM', playerName: '다라', code: room.id });
  room.phase = phase;
  return { hub, room, a, b };
}

describe('경주 중 외침', () => {
  it('경주 중에 보낸 외침은 방 안의 모두에게 간다', () => {
    const { a, b } = roomWithTwo('racing');
    a.send({ type: 'SHOUT', kind: 'go', horseId: 3 });
    expect(b.all('SHOUT')).toHaveLength(1);
    expect(b.all('SHOUT')[0]).toMatchObject({ kind: 'go', horseId: 3, playerName: '가나' });
    expect(a.all('SHOUT')).toHaveLength(1);
  });

  it('네 가지 외침(가즈아!·제발!·견제해!·멈춰!)을 모두 받는다', () => {
    vi.useFakeTimers();
    try {
      const { a, b } = roomWithTwo('racing');
      for (const kind of ['go', 'beg', 'check', 'halt'] as const) {
        a.send({ type: 'SHOUT', kind, horseId: 2 });
        vi.advanceTimersByTime(1300);
      }
      expect(b.all('SHOUT').map((m) => m.kind)).toEqual(['go', 'beg', 'check', 'halt']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('경주가 보이지 않는 단계에서는 버린다', () => {
    const { a, b } = roomWithTwo('betting');
    a.send({ type: 'SHOUT', kind: 'go', horseId: 3 });
    expect(b.all('SHOUT')).toHaveLength(0);
  });

  it('정해 둔 외침과 1~6번 말만 받는다', () => {
    const { a, b } = roomWithTwo('racing');
    a.send({ type: 'SHOUT', kind: '욕설' as never, horseId: 3 });
    a.send({ type: 'SHOUT', kind: 'go', horseId: 9 });
    a.send({ type: 'SHOUT', kind: 'go', horseId: 1.5 });
    a.send({ type: 'SHOUT', kind: 'toString' as never, horseId: 2 });
    expect(b.all('SHOUT')).toHaveLength(0);
  });

  it('한 사람은 1.2초에 한 번만 외칠 수 있다', () => {
    vi.useFakeTimers();
    try {
      const { a, b } = roomWithTwo('racing');
      a.send({ type: 'SHOUT', kind: 'go', horseId: 1 });
      a.send({ type: 'SHOUT', kind: 'check', horseId: 2 });
      expect(b.all('SHOUT')).toHaveLength(1);
      // 다른 사람은 따로 센다
      b.send({ type: 'SHOUT', kind: 'check', horseId: 2 });
      expect(a.all('SHOUT')).toHaveLength(2);
      vi.advanceTimersByTime(1300);
      a.send({ type: 'SHOUT', kind: 'check', horseId: 2 });
      expect(b.all('SHOUT')).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('반응 이모티콘은 목록에 있는 것만 보낸다', () => {
    const { a, b } = roomWithTwo('racing');
    a.send({ type: 'EMOTE', emoji: '💩' });
    expect(b.all('EMOTE')).toHaveLength(0);
    a.send({ type: 'EMOTE', emoji: '😂' });
    expect(b.all('EMOTE')).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { payoutOf } from '../../shared/src/constants';
import type { Bet, C2S, RankingEntry, S2C } from '../../shared/src/types';
import { settleBets } from '../src/game/betting';
import { GameHub } from '../src/hub';

function connect(hub: GameHub) {
  const got: S2C[] = [];
  const conn = hub.open((data) => got.push(JSON.parse(data)));
  return {
    got,
    conn,
    send: (msg: C2S) => conn.message(JSON.stringify(msg)),
    raw: (data: string) => conn.message(data),
    all: <T extends S2C['type']>(type: T) => got.filter((m) => m.type === type) as Extract<S2C, { type: T }>[],
    welcome: () => got.find((m) => m.type === 'WELCOME') as Extract<S2C, { type: 'WELCOME' }>
  };
}

function roomWithTwo() {
  const hub = new GameHub();
  const a = connect(hub);
  a.send({ type: 'CREATE_ROOM', playerName: '가나', roomName: '시험', isPrivate: true, maxPlayers: 4, totalRounds: 1, npcCount: 0 });
  const room = [...hub.rooms.values()][0];
  const b = connect(hub);
  b.send({ type: 'JOIN_ROOM', playerName: '다라', code: room.id });
  return { hub, room, a, b };
}

describe('지급액 계산', () => {
  it('배팅금 × 배당이 딱 떨어지는 값이면 1코인도 모자라지 않는다', () => {
    // 그대로 곱하면 100 × 1.15 = 114.99999…, 100 × 1.13 = 112.99999… 가 된다
    expect(payoutOf(100, 1.15)).toBe(115);
    expect(payoutOf(100, 1.13)).toBe(113);
    expect(payoutOf(70, 1.57)).toBe(109);
    expect(payoutOf(100, 3.33)).toBe(333);
    expect(payoutOf(10, 1.05)).toBe(10);
  });

  it('정산도 같은 식을 쓴다', () => {
    const bet: Bet = { betId: 'b1', playerId: 'p1', type: 'winner', horseId: 1, amount: 100, odds: 1.15 };
    const rankings = [1, 2, 3, 4, 5, 6].map((id) => ({ horseId: id, rank: id })) as RankingEntry[];
    expect(settleBets([bet], rankings)[0].payout).toBe(115);
  });
});

describe('재접속', () => {
  it('방장이 없는 방에 돌아온 사람이 방장을 이어받는다', () => {
    const { hub, room, a, b } = roomWithTwo();
    room.phase = 'roundResult';
    const bId = b.welcome().playerId;
    const bSecret = b.welcome().secret;
    // 먼저 다라가 끊기고, 이어서 방장 가나도 끊긴다: 이어받을 사람이 없어 방장은 가나로 남는다
    b.conn.close();
    a.conn.close();
    expect(room.hostId).not.toBe(bId);
    const b2 = connect(hub);
    b2.send({ type: 'RECONNECT', roomId: room.id, playerId: bId, secret: bSecret });
    expect(b2.all('ROOM_JOINED')).toHaveLength(1);
    expect(room.hostId).toBe(bId);
    room.destroy('시험 끝');
  });

  it('방장이 그대로 있으면 돌아온 사람이 방장을 빼앗지 않는다', () => {
    const { hub, room, a, b } = roomWithTwo();
    room.phase = 'racing';
    const aId = a.welcome().playerId;
    const bId = b.welcome().playerId;
    b.conn.close();
    const b2 = connect(hub);
    b2.send({ type: 'RECONNECT', roomId: room.id, playerId: bId, secret: b.welcome().secret });
    expect(room.hostId).toBe(aId);
    room.destroy('시험 끝');
  });

  it('다른 연결로 다시 들어오면 옛 연결은 그 사람 노릇을 못 한다', () => {
    const { hub, room, a, b } = roomWithTwo();
    room.phase = 'racing';
    const bId = b.welcome().playerId;
    const b2 = connect(hub);
    b2.send({ type: 'RECONNECT', roomId: room.id, playerId: bId, secret: b.welcome().secret });
    // 옛 탭이 보낸 외침과 나가기는 무시된다
    b.send({ type: 'SHOUT', kind: 'go', horseId: 1 });
    expect(a.all('SHOUT')).toHaveLength(0);
    b.send({ type: 'LEAVE_ROOM' });
    expect(room.players.get(bId)?.left).toBeFalsy();
    expect(room.players.get(bId)?.connected).toBe(true);
    // 지금 연결의 외침은 그대로 간다
    b2.send({ type: 'SHOUT', kind: 'go', horseId: 1 });
    expect(a.all('SHOUT')).toHaveLength(1);
    room.destroy('시험 끝');
  });

  it('다시 접속할 때 쓰는 비밀값은 공개되는 playerId 와 모양이 다르다', () => {
    const hub = new GameHub();
    const a = connect(hub).welcome();
    expect(a.secret).toMatch(/^s_[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(a.secret).not.toContain(a.playerId.split('_')[1]);
  });
});

describe('잘못된 입력', () => {
  it('준비 신호는 출마표·배팅 단계에서만 받고, 같은 값은 다시 알리지 않는다', () => {
    const { room, a, b } = roomWithTwo();
    const aId = a.welcome().playerId;
    room.phase = 'racing';
    const before = b.all('ROOM_UPDATE').length;
    a.send({ type: 'READY', phase: 'racing' as never });
    expect(b.all('ROOM_UPDATE')).toHaveLength(before);
    expect(room.players.get(aId)?.readyBetting).toBe(false);
    room.phase = 'preview';
    a.send({ type: 'READY', phase: 'preview', ready: false });
    expect(b.all('ROOM_UPDATE')).toHaveLength(before);
    room.destroy('시험 끝');
  });

  it('외침 종류가 글자가 아니면 버린다', () => {
    const { room, a, b } = roomWithTwo();
    room.phase = 'racing';
    a.send({ type: 'SHOUT', kind: [['go']] as never, horseId: 1 });
    expect(b.all('SHOUT')).toHaveLength(0);
    room.destroy('시험 끝');
  });

  it('너무 큰 메시지는 읽지 않고 버린다', () => {
    const hub = new GameHub();
    const a = connect(hub);
    const before = a.got.length;
    a.raw(JSON.stringify({ type: 'HELLO', playerName: 'x'.repeat(20000) }));
    a.raw('{'.repeat(20000));
    expect(a.got).toHaveLength(before);
    expect(hub.rooms.size).toBe(0);
  });
});

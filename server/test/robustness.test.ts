import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIMINGS } from '../../shared/src/constants';
import type { BetType } from '../../shared/src/types';
import { GameHub } from '../src/hub';
import { Room, type Player } from '../src/game/room';

// 잘못된 입력, 끊긴 연결, 방 정리처럼 정상 흐름 밖에서 생기는 일을 확인한다

function makeHuman(id: string): Player {
  return {
    id,
    secret: 's-' + id,
    name: id,
    isNpc: false,
    socket: null,
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

function makeRoom(): Room {
  const room = new Room('ROBUST', { roomName: '점검', isPrivate: false, maxPlayers: 6, totalRounds: 2 }, 'p1');
  room.addPlayer(makeHuman('p1'));
  room.addPlayer(makeHuman('p2'));
  return room;
}

/** 허브에 연결 하나를 열고, 받은 메시지를 모은다 */
function connect(hub: GameHub): { send: (msg: object) => void; close: () => void; inbox: { type: string; [k: string]: unknown }[] } {
  const inbox: { type: string; [k: string]: unknown }[] = [];
  const conn = hub.open((data) => inbox.push(JSON.parse(data)));
  return { send: (msg) => conn.message(JSON.stringify(msg)), close: () => conn.close(), inbox };
}

const rooms: Room[] = [];
const hubs: GameHub[] = [];
afterEach(() => {
  for (const r of rooms.splice(0)) {
    r.onEmpty = null;
    r.destroy('테스트 종료');
  }
  for (const h of hubs.splice(0)) for (const r of h.rooms.values()) r.destroy('테스트 종료');
  vi.useRealTimers();
});

describe('방 정리', () => {
  it('모두 끊긴 뒤 단계가 바뀌어도 2분 뒤에는 방을 닫는다', () => {
    vi.useFakeTimers();
    const room = makeRoom();
    rooms.push(room);
    let closed = false;
    room.onEmpty = () => {
      closed = true;
    };
    room.startGame('p1');
    room.markDisconnected('p1');
    room.markDisconnected('p2');
    // 출마표가 끝나 배팅으로 넘어가면 단계 타이머가 모두 지워진다
    vi.advanceTimersByTime(TIMINGS.preview + 100);
    expect(room.phase).toBe('betting');
    vi.advanceTimersByTime(120000);
    expect(closed).toBe(true);
  });

  it('다시 접속하면 방 정리를 취소한다', () => {
    vi.useFakeTimers();
    const room = makeRoom();
    rooms.push(room);
    let closed = false;
    room.onEmpty = () => {
      closed = true;
    };
    room.startGame('p1');
    room.markDisconnected('p1');
    room.markDisconnected('p2');
    vi.advanceTimersByTime(60000);
    room.reconnect(room.players.get('p1')!, { send: () => undefined });
    vi.advanceTimersByTime(90000);
    expect(closed).toBe(false);
  });

  it('다시 시작하면 게임 중에 나가거나 끊긴 사람은 대기실에서 뺀다', () => {
    const room = makeRoom();
    rooms.push(room);
    room.addPlayer(makeHuman('p3'));
    room.startGame('p1');
    room.removePlayer('p2'); // 스스로 나감
    room.markDisconnected('p3'); // 연결만 끊김
    room.phase = 'gameResult';
    expect(room.restart('p1')).toBeNull();
    expect([...room.players.keys()]).toEqual(['p1']);
  });
});

describe('잘못된 입력', () => {
  it('없는 배팅 종류는 받지 않는다', () => {
    vi.useFakeTimers();
    const room = makeRoom();
    rooms.push(room);
    room.startGame('p1');
    vi.advanceTimersByTime(TIMINGS.preview + 100);
    const coins = room.players.get('p1')!.coins;
    for (const bad of ['constructor', 'toString', '__proto__', 'top3']) {
      expect(room.placeBet('p1', bad as BetType, 1, 10)).not.toBeNull();
    }
    expect(room.players.get('p1')!.coins).toBe(coins);
    expect(room.placeBet('p1', 'top2', 1, 10)).toBeNull();
  });

  it('방 만들기에 숫자가 빠져 있으면 기본값을 쓴다', () => {
    const hub = new GameHub();
    hubs.push(hub);
    const a = connect(hub);
    a.send({ type: 'CREATE_ROOM', playerName: '가', roomName: '방' });
    const room = [...hub.rooms.values()][0];
    expect(room.settings.totalRounds).toBeGreaterThan(0);
    expect(Number.isFinite(room.settings.maxPlayers)).toBe(true);
    expect(room.settings.maxPlayers).toBe(2);
  });

  it('객체가 아닌 메시지는 서버 오류 없이 거절한다', () => {
    const hub = new GameHub();
    hubs.push(hub);
    const a = connect(hub);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const raw of ['null', '1', '"x"', '[]']) a.send(JSON.parse(raw));
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
    expect(a.inbox.filter((m) => m.type === 'ERROR').length).toBe(4);
  });

  it('NPC 자리는 재접속으로 이어받을 수 없다', () => {
    const hub = new GameHub();
    hubs.push(hub);
    const host = connect(hub);
    host.send({ type: 'CREATE_ROOM', playerName: '방장', roomName: '방', maxPlayers: 4, totalRounds: 2, npcCount: 1 });
    const room = [...hub.rooms.values()][0];
    const npc = [...room.players.values()].find((p) => p.isNpc)!;
    const intruder = connect(hub);
    intruder.send({ type: 'RECONNECT', roomId: room.id, playerId: npc.id, secret: '' });
    expect(intruder.inbox.some((m) => m.type === 'ERROR')).toBe(true);
    expect(intruder.inbox.some((m) => m.type === 'ROOM_JOINED')).toBe(false);
    expect(npc.socket).toBeNull();
  });
});

describe('게임 중에 스스로 나간 사람', () => {
  it('순위는 남은 사람 뒤에 두고 나감으로 표시한다', () => {
    const room = makeRoom();
    rooms.push(room);
    room.addPlayer(makeHuman('p3'));
    room.startGame('p1');
    room.players.get('p2')!.coins = 99999; // 가장 많이 들고 나간다
    room.removePlayer('p2');
    const standings = room.computeStandings();
    const last = standings[standings.length - 1];
    expect(last.playerId).toBe('p2');
    expect(last.left).toBe(true);
    expect(standings.find((s) => s.rank === 1)!.playerId).not.toBe('p2');
    expect(last.rank).toBe(standings.length);
  });

  it('코인 구제를 받지 않는다', () => {
    vi.useFakeTimers();
    const room = makeRoom();
    rooms.push(room);
    room.addPlayer(makeHuman('p3'));
    room.startGame('p1');
    room.removePlayer('p2');
    // 1라운드를 끝까지 돌리고 2라운드 시작 (코인 구제는 2라운드부터)
    room.players.get('p2')!.coins = 0;
    room.players.get('p3')!.coins = 0;
    for (let i = 0; i < 400 && room.phase !== 'roundResult'; i++) vi.advanceTimersByTime(1000);
    expect(room.phase).toBe('roundResult');
    room.players.get('p2')!.coins = 0;
    room.players.get('p3')!.coins = 0;
    expect(room.nextRound('p1')).toBeNull();
    expect(room.players.get('p2')!.coins).toBe(0);
    expect(room.players.get('p3')!.coins).toBeGreaterThan(0);
  });
});

describe('방이 닫힐 때 서버 정리', () => {
  /** 방장 하나와 NPC로 방을 만들어 게임을 시작한다 */
  function startedRoom(hub: GameHub): { host: ReturnType<typeof connect>; room: Room } {
    const host = connect(hub);
    host.send({ type: 'CREATE_ROOM', playerName: '방장', roomName: '방', maxPlayers: 4, totalRounds: 2, npcCount: 2 });
    host.send({ type: 'START_GAME' });
    return { host, room: [...hub.rooms.values()][0] };
  }

  it('대기실에서 마지막 사람이 끊기면 방 목록에서 지우고 타이머를 남기지 않는다', () => {
    vi.useFakeTimers();
    const hub = new GameHub();
    hubs.push(hub);
    const host = connect(hub);
    host.send({ type: 'CREATE_ROOM', playerName: '방장', roomName: '방', maxPlayers: 4, totalRounds: 2, npcCount: 2 });
    expect(hub.rooms.size).toBe(1);
    host.close();
    expect(hub.rooms.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  for (const [label, advanceMs, phase] of [
    ['출마표', 0, 'preview'],
    ['배팅', TIMINGS.preview + 100, 'betting'],
    ['경주', TIMINGS.preview + TIMINGS.betting + TIMINGS.reveal + TIMINGS.countdown + 3000, 'racing']
  ] as const) {
    it(`게임 중(${label}) 모두 끊기면 2분 뒤 방을 지우고 타이머를 남기지 않는다`, () => {
      vi.useFakeTimers();
      const hub = new GameHub();
      hubs.push(hub);
      const { host, room } = startedRoom(hub);
      vi.advanceTimersByTime(advanceMs);
      expect(room.phase).toBe(phase);
      host.close();
      expect(hub.rooms.size).toBe(1); // 재접속을 기다린다
      vi.advanceTimersByTime(120000);
      expect(hub.rooms.size).toBe(0);
      expect(room.phase).not.toBe('lobby');
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it('게임 중에 모두 스스로 나가면 바로 지운다', () => {
    vi.useFakeTimers();
    const hub = new GameHub();
    hubs.push(hub);
    const { host } = startedRoom(hub);
    host.send({ type: 'LEAVE_ROOM' });
    expect(hub.rooms.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('한 말에 증강이 여러 개 걸릴 때', () => {
  it('미리 고른 카드를 다시 고르면 발동 순서의 맨 뒤로 간다', () => {
    vi.useFakeTimers();
    const room = makeRoom();
    rooms.push(room);
    room.startGame('p1');
    // 증강 미리 고르기 단계가 열릴 때까지 진행한다
    type Aug = { live: boolean; hands: Map<string, { cardKey: string }[]>; queued: Map<string, unknown> };
    const aug = (): Aug | null => (room as unknown as { augment: Aug | null }).augment;
    for (let i = 0; i < 4000 && !(aug() && !aug()!.live); i++) vi.advanceTimersByTime(50);
    const a = aug()!;
    expect(a.live).toBe(false);
    const pick = (id: string, n: number): void => room.selectAugment(id, a.hands.get(id)![n].cardKey, 1);
    pick('p1', 0);
    pick('p2', 0);
    pick('p1', 1); // p1이 마음을 바꿔 다시 고른다
    expect([...a.queued.keys()]).toEqual(['p2', 'p1']);
  });
});

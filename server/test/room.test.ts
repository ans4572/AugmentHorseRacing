import { afterEach, describe, expect, it } from 'vitest';
import { ROUND_COINS, TIER_OF_RARITY, TOP_UP_AMOUNT } from '../../shared/src/constants';
import { Room, type Player } from '../src/game/room';

function makeHuman(id: string, name: string): Player {
  return {
    id,
    secret: 's-' + id,
    name,
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

function makeRoom(totalRounds: number): Room {
  const room = new Room(
    'TEST01',
    { roomName: '테스트방', isPrivate: false, maxPlayers: 8, totalRounds },
    'p1'
  );
  room.addPlayer(makeHuman('p1', '철수'));
  room.addPlayer(makeHuman('p2', '영희'));
  return room;
}

const cleanups: Room[] = [];
afterEach(() => {
  for (const r of cleanups.splice(0)) {
    r.onEmpty = null;
    r.destroy('테스트 종료');
  }
});

describe('방 / 라운드 / 코인', () => {
  it('라운드 수에 따라 초기 코인을 정확히 지급한다', () => {
    for (const rounds of [1, 2, 3, 4, 5]) {
      const room = makeRoom(rounds);
      cleanups.push(room);
      const err = room.startGame('p1');
      expect(err).toBeNull();
      for (const p of room.players.values()) {
        expect(p.coins).toBe(ROUND_COINS[rounds]);
      }
      expect(room.round).toBe(1);
      expect(room.phase).toBe('preview');
    }
  });

  it('방장이 아니면 게임을 시작할 수 없다', () => {
    const room = makeRoom(3);
    cleanups.push(room);
    expect(room.startGame('p2')).not.toBeNull();
    expect(room.phase).toBe('lobby');
  });

  it('2명 미만이면 시작할 수 없고, NPC도 인원으로 인정된다', () => {
    const solo = new Room(
      'TEST02',
      { roomName: '혼자방', isPrivate: false, maxPlayers: 4, totalRounds: 1 },
      'p1'
    );
    cleanups.push(solo);
    solo.addPlayer(makeHuman('p1', '솔로'));
    expect(solo.startGame('p1')).not.toBeNull();
    expect(solo.addNpc()).toBeNull();
    expect(solo.startGame('p1')).toBeNull(); // 사람 1 + NPC 1 = 시작 가능
  });

  it('배팅 단계가 아니면 배팅할 수 없고, 배팅 종료 후 수정이 불가능하다', () => {
    const room = makeRoom(1);
    cleanups.push(room);
    room.startGame('p1');
    // preview 단계에서는 배팅 불가
    expect(room.placeBet('p1', 'winner', 1, 50)).not.toBeNull();
    // 모든 사람이 준비하면 배팅 단계로 조기 전환
    room.setReady('p1', 'preview');
    room.setReady('p2', 'preview');
    expect(room.phase).toBe('betting');
    expect(room.placeBet('p1', 'winner', 1, 50)).toBeNull();
    const betId = room.bets[0].betId;
    // 배팅 마감(전원 준비) 후에는 취소·추가 불가
    room.setReady('p1', 'betting');
    room.setReady('p2', 'betting');
    expect(room.phase).toBe('reveal');
    expect(room.cancelBet('p1', betId)).not.toBeNull();
    expect(room.placeBet('p1', 'winner', 2, 50)).not.toBeNull();
  });

  it('배팅 시 코인이 차감되고 취소 시 환불된다', () => {
    const room = makeRoom(1); // 시작 코인 500
    cleanups.push(room);
    room.startGame('p1');
    room.setReady('p1', 'preview');
    room.setReady('p2', 'preview');
    const p1 = room.players.get('p1')!;
    expect(room.placeBet('p1', 'winner', 3, 100)).toBeNull();
    expect(p1.coins).toBe(400);
    // 한도 초과 (500 × 30% = 150)
    expect(room.placeBet('p1', 'top3', 2, 100)).not.toBeNull();
    expect(room.placeBet('p1', 'top3', 2, 50)).toBeNull();
    expect(p1.coins).toBe(350);
    const betId = room.bets.find((b) => b.playerId === 'p1' && b.amount === 100)!.betId;
    expect(room.cancelBet('p1', betId)).toBeNull();
    expect(p1.coins).toBe(450);
  });

  it('코인이 10 미만이면 다음 라운드 시작 시 100으로 보충한다', () => {
    const room = makeRoom(3);
    cleanups.push(room);
    room.startGame('p1');
    const p2 = room.players.get('p2')!;
    p2.coins = 4;
    // 내부 라운드 전환을 직접 호출
    (room as unknown as { startRound(r: number): void }).startRound(2);
    expect(p2.coins).toBe(TOP_UP_AMOUNT);
    const p1 = room.players.get('p1')!;
    expect(p1.coins).toBe(ROUND_COINS[3]); // 충분한 플레이어는 보충 없음
  });

  it('싱글 모드: 사람 1명 + NPC 5명으로 시작하고, NPC 5명이 모두 배팅한다', () => {
    const room = new Room(
      'SOLO01',
      { roomName: '혼자 하기', isPrivate: true, maxPlayers: 6, totalRounds: 2 },
      'p1'
    );
    cleanups.push(room);
    room.addPlayer(makeHuman('p1', '나'));
    for (let i = 0; i < 5; i++) expect(room.addNpc()).toBeNull();
    expect(room.addNpc()).not.toBeNull(); // 6명이 차면 더 못 넣는다
    expect(room.players.size).toBe(6);

    expect(room.startGame('p1')).toBeNull();
    for (const p of room.players.values()) expect(p.coins).toBe(ROUND_COINS[2]);

    // 사람은 혼자이므로 준비만 누르면 대기 단계가 바로 넘어간다
    room.setReady('p1', 'preview');
    expect(room.phase).toBe('betting');
    room.setReady('p1', 'betting');
    expect(room.phase).toBe('reveal');

    const npcIds = [...room.players.values()].filter((p) => p.isNpc).map((p) => p.id);
    expect(npcIds).toHaveLength(5);
    for (const id of npcIds) {
      expect(room.bets.some((b) => b.playerId === id)).toBe(true);
    }
    // NPC 성격이 서로 달라야 한다 (같은 봇 5명이 아니다)
    const personas = new Set([...room.players.values()].filter((p) => p.isNpc).map((p) => p.persona));
    expect(personas.size).toBe(5);
  });

  it('게임 도중 나가도 남은 사람의 게임은 계속되고, 나간 사람의 배팅은 남는다', () => {
    const room = makeRoom(1);
    cleanups.push(room);
    let closed = false;
    room.onEmpty = () => {
      closed = true;
    };
    room.startGame('p1');
    room.setReady('p1', 'preview');
    room.setReady('p2', 'preview');
    expect(room.placeBet('p1', 'winner', 1, 50)).toBeNull();

    room.removePlayer('p1'); // 방장이 배팅 도중 나간다
    expect(closed).toBe(false);
    expect(room.players.has('p1')).toBe(true); // 정산을 위해 기록은 남는다
    expect(room.players.get('p1')!.connected).toBe(false);
    expect(room.hostId).toBe('p2'); // 방장 승계
    expect(room.bets.some((b) => b.playerId === 'p1')).toBe(true);

    // 남은 사람만 준비하면 다음 단계로 넘어간다
    room.setReady('p2', 'betting');
    expect(room.phase).toBe('reveal');
  });

  it('사람이 모두 스스로 나가면 방을 바로 정리한다 (싱글 모드 도중 퇴장)', () => {
    const room = new Room(
      'SOLO02',
      { roomName: '혼자 하기', isPrivate: true, maxPlayers: 6, totalRounds: 3 },
      'p1'
    );
    cleanups.push(room);
    let closed = false;
    room.onEmpty = () => {
      closed = true;
    };
    room.addPlayer(makeHuman('p1', '나'));
    for (let i = 0; i < 5; i++) room.addNpc();
    room.startGame('p1');
    expect(closed).toBe(false);
    room.removePlayer('p1');
    expect(closed).toBe(true);
  });

  it('연결만 끊긴 경우에는 재접속을 위해 방을 바로 닫지 않는다', () => {
    const room = makeRoom(2);
    cleanups.push(room);
    let closed = false;
    room.onEmpty = () => {
      closed = true;
    };
    room.startGame('p1');
    room.removePlayer('p1'); // 스스로 나감
    room.markDisconnected('p2'); // 연결만 끊김
    expect(closed).toBe(false);
  });

  describe('블라인드 배팅', () => {
    type Msg = { type: string; bets?: { playerId: string }[]; betCounts?: { playerId: string; count: number }[]; blind?: boolean };

    /** 받은 메시지를 모아 두는 사람 2명짜리 방을 만든다 */
    function roomWithInbox(blindBets: boolean) {
      const inbox: Record<string, Msg[]> = { p1: [], p2: [] };
      const room = new Room(
        'BLIND1',
        { roomName: '블라인드', isPrivate: false, maxPlayers: 4, totalRounds: 1, blindBets },
        'p1'
      );
      cleanups.push(room);
      for (const id of ['p1', 'p2']) {
        const player = makeHuman(id, id === 'p1' ? '철수' : '영희');
        player.socket = { send: (data: string) => inbox[id].push(JSON.parse(data)) };
        room.addPlayer(player);
      }
      room.startGame('p1');
      room.setReady('p1', 'preview');
      room.setReady('p2', 'preview');
      expect(room.placeBet('p1', 'winner', 1, 50)).toBeNull();
      expect(room.placeBet('p2', 'last', 4, 60)).toBeNull();
      expect(room.placeBet('p2', 'top3', 2, 40)).toBeNull();
      room.setReady('p1', 'betting');
      room.setReady('p2', 'betting');
      const reveal = (id: string) => inbox[id].find((m) => m.type === 'BET_REVEAL')!;
      return { room, reveal };
    }

    it('블라인드 방에서는 각자 자기 배팅만 받고, 남의 것은 건수만 안다', () => {
      const { room, reveal } = roomWithInbox(true);
      const r1 = reveal('p1');
      expect(r1.blind).toBe(true);
      expect(r1.bets!.every((b) => b.playerId === 'p1')).toBe(true);
      expect(r1.bets).toHaveLength(1);
      expect(r1.betCounts!.find((c) => c.playerId === 'p2')!.count).toBe(2);

      const r2 = reveal('p2');
      expect(r2.bets!.every((b) => b.playerId === 'p2')).toBe(true);
      expect(r2.bets).toHaveLength(2);

      // 재접속 스냅샷으로도 남의 배팅이 새지 않는다
      const snap = room.buildSnapshot('p1');
      expect(snap.revealedBets!.every((b) => b.playerId === 'p1')).toBe(true);
      expect(snap.betCounts!.find((c) => c.playerId === 'p2')!.count).toBe(2);
    });

    it('일반 방에서는 모두의 배팅이 공개된다', () => {
      const { room, reveal } = roomWithInbox(false);
      const r1 = reveal('p1');
      expect(r1.blind).toBe(false);
      expect(r1.bets).toHaveLength(3);
      expect(room.buildSnapshot('p1').revealedBets).toHaveLength(3);
    });
  });

  it('증강 구간의 등급은 전원에게 같고, 카드는 그 등급 안에서 각자 뽑는다', () => {
    const room = makeRoom(1);
    cleanups.push(room);
    room.addNpc();
    room.startGame('p1');
    type Internals = {
      startRace(): void;
      triggerAugmentPhase(phase: number, durationMs: number): void;
      augment: {
        tier: string;
        hands: Map<string, { cardKey: string; def: { id: string; rarity: string } }[]>;
      };
    };
    const internals = room as unknown as Internals;
    internals.startRace();
    for (const phase of [1, 2, 3, 4]) {
      internals.triggerAugmentPhase(phase, 5000);
      const { tier, hands } = internals.augment;
      expect(['silver', 'gold', 'platinum']).toContain(tier);
      // 사람 2명 + NPC 1명 모두 손패를 받는다
      expect(hands.size).toBe(3);
      for (const hand of hands.values()) {
        expect(hand).toHaveLength(3);
        for (const card of hand) {
          expect(TIER_OF_RARITY[card.def.rarity as keyof typeof TIER_OF_RARITY]).toBe(tier);
        }
      }
    }
  });

  it('동일 코인이면 누적 순이익 → 적중 횟수 → 공동 순위로 판정한다', () => {
    const room = makeRoom(2);
    cleanups.push(room);
    room.startGame('p1');
    const p1 = room.players.get('p1')!;
    const p2 = room.players.get('p2')!;
    p1.coins = 800;
    p2.coins = 800;
    p1.netProfit = 100;
    p2.netProfit = 50;
    let standings = room.computeStandings();
    expect(standings[0].playerId).toBe('p1');
    expect(standings[0].rank).toBe(1);
    expect(standings[1].rank).toBe(2);
    // 완전 동률이면 공동 순위
    p2.netProfit = 100;
    p1.hits = p2.hits = 2;
    standings = room.computeStandings();
    expect(standings[0].rank).toBe(1);
    expect(standings[1].rank).toBe(1);
  });
});

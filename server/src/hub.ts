import type { AdminState, C2S, HorseLook, RoomSummary, S2C } from '../../shared/src/types';
import {
  EMOTE_SERVER_GAP_MS,
  HORSES_PER_RACE,
  MAX_PLAYERS_LIMIT,
  MAX_ROUNDS,
  MIN_ROUNDS,
  SHOUT_SERVER_GAP_MS,
  SHOUT_TEXT
} from '../../shared/src/constants';
import { EMOTES } from '../../shared/src/names';
import { sanitizeHorseName, sanitizeLook } from '../../shared/src/stable';
import { Room, makeRoomCode, uid, type Player } from './game/room';

// ============================================================
// 게임 허브 — 방 목록과 메시지 처리. 전송 수단을 모른다.
// Node(ws)와 Cloudflare Durable Object가 같은 허브를 그대로 쓴다.
// ============================================================

/** 연결 하나가 허브에 넘겨받는 손잡이 */
export interface HubConnection {
  /** 클라이언트가 보낸 원문 메시지 */
  message(raw: string): void;
  /** 연결이 끊겼을 때 */
  close(): void;
}

interface Session {
  /** 접속 하나의 번호 (재접속으로 playerId가 바뀌어도 그대로다). 관리자 화면에서 선물 대상을 가리킨다 */
  sid: string;
  /** 브라우저가 HELLO로 알려 준 이름과 당근 수 */
  name: string | null;
  carrots: number | null;
  connectedAt: number;
  /** 관리자 비밀번호를 맞힌 접속 */
  admin: boolean;
  /** 이 접속에서 관리자 비밀번호를 틀린 횟수 */
  adminFails: number;
  /** 마지막으로 외침·이모티콘을 받아 준 시각 (도배 방지) */
  lastShoutAt: number;
  lastEmoteAt: number;
  send: (msg: S2C) => void;
  playerId: string;
  secret: string;
  roomId: string | null;
  /** 이 연결이 플레이어에 바인딩한 소켓 래퍼 — 늦게 도착한 close와 새 연결을 구분한다 */
  wrapper: { send(data: string): void } | null;
}

/** 숫자로 와야 하는 값: 숫자가 아니면 기본값을 쓴다 (Math.floor(undefined)는 NaN이 되어 최소·최대 제한을 그대로 통과한다) */
function int(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/** 클라이언트가 보낸 내 말 정보를 검증한다 */
function sanitizeMyHorse(raw: { name?: unknown; look?: unknown }): { name: string; look: HorseLook } {
  return { name: sanitizeHorseName(raw.name), look: sanitizeLook(raw.look) };
}

function sanitizeName(name: unknown): string {
  const s = String(name ?? '').trim().slice(0, 12);
  return s.length > 0 ? s : '이름없는기수';
}

/** 관리자 비밀번호 비교: 틀린 글자를 찾는 시간 차로 비밀번호를 알아내지 못하게, 늘 끝까지 비교한다 */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 관리자 비밀번호 대입 막기: 접속 하나는 3번까지 틀릴 수 있고(다시 접속해야 또 시도),
 * 서버 전체로는 10분에 30번 틀리면 잠시 막는다. 전체 한도를 넉넉히 둬서 남이 일부러 틀려 관리자를 잠그기 어렵다.
 */
const ADMIN_FAIL_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_FAIL_LIMIT = 30;
const ADMIN_FAIL_PER_CONN = 3;
/** 한 번에 보낼 수 있는 당근 */
const GIFT_MAX = 10000;

export interface GameHubOptions {
  /** 관리자 화면 비밀번호. 비어 있으면 관리자 기능을 끈다 */
  adminPassword?: string;
}

export class GameHub {
  readonly rooms = new Map<string, Room>();
  /** 지금 열려 있는 접속 */
  private readonly sessions = new Set<Session>();
  private readonly adminPassword: string;
  private readonly startedAt = Date.now();
  private connectionsTotal = 0;
  private roomsCreated = 0;
  private giftsSent = 0;
  /** 관리자 비밀번호를 틀린 시각들 */
  private adminFails: number[] = [];

  constructor(opts: GameHubOptions = {}) {
    this.adminPassword = (opts.adminPassword ?? '').trim();
  }

  /** 새 연결을 받는다. sendRaw는 닫힌 연결에 보내도 예외를 던지지 않아야 한다 */
  open(sendRaw: (data: string) => void): HubConnection {
    const send = (msg: S2C): void => sendRaw(JSON.stringify(msg));
    const session: Session = {
      sid: uid('c'),
      name: null,
      carrots: null,
      connectedAt: Date.now(),
      admin: false,
      adminFails: 0,
      lastShoutAt: 0,
      lastEmoteAt: 0,
      send,
      playerId: uid('p'),
      secret: uid('s'),
      roomId: null,
      wrapper: null
    };
    this.sessions.add(session);
    this.connectionsTotal++;
    send({ type: 'WELCOME', playerId: session.playerId, secret: session.secret });

    return {
      message: (raw) => {
        let msg: C2S;
        try {
          msg = JSON.parse(raw);
        } catch {
          return send({ type: 'ERROR', message: '잘못된 메시지 형식입니다.' });
        }
        if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') {
          return send({ type: 'ERROR', message: '잘못된 메시지 형식입니다.' });
        }
        try {
          this.handle(session, msg, send, sendRaw);
        } catch (err) {
          console.error('메시지 처리 오류:', err);
          send({ type: 'ERROR', message: '서버에서 문제가 생겼습니다. 잠시 뒤 다시 해 보세요.' });
        }
      },
      close: () => {
        this.sessions.delete(session);
        const room = session.roomId ? this.rooms.get(session.roomId) : undefined;
        if (!room) return;
        const player = room.players.get(session.playerId);
        // 이미 다른 연결(재접속)이 플레이어를 차지했다면 건드리지 않는다
        if (player && player.socket !== null && player.socket !== session.wrapper) return;
        room.markDisconnected(session.playerId);
      }
    };
  }

  private roomList(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => !r.settings.isPrivate && r.phase === 'lobby')
      .map((r) => ({
        id: r.id,
        name: r.settings.roomName,
        players: r.players.size,
        maxPlayers: r.settings.maxPlayers,
        totalRounds: r.settings.totalRounds,
        state: r.phase
      }));
  }

  private makePlayer(session: Session, name: string, sendRaw: (data: string) => void): Player {
    const wrapper = { send: sendRaw };
    session.wrapper = wrapper;
    return {
      id: session.playerId,
      secret: session.secret,
      name,
      isNpc: false,
      socket: wrapper,
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

  private handle(
    session: Session,
    msg: C2S,
    send: (msg: S2C) => void,
    sendRaw: (data: string) => void
  ): void {
    const rooms = this.rooms;
    const currentRoom = (): Room | null => (session.roomId ? (rooms.get(session.roomId) ?? null) : null);
    const sendError = (message: string): void => send({ type: 'ERROR', message });

    if (msg.type.startsWith('ADMIN_')) return this.handleAdmin(session, msg);

    switch (msg.type) {
      case 'HELLO': {
        session.name = sanitizeName(msg.playerName);
        const c = int(msg.carrots, -1);
        session.carrots = c >= 0 ? Math.min(c, 10_000_000) : null;
        break;
      }

      case 'LIST_ROOMS': {
        send({ type: 'ROOM_LIST', rooms: this.roomList() });
        break;
      }

      case 'CREATE_ROOM': {
        if (currentRoom()) return sendError('이미 방에 참가 중입니다.');
        const totalRounds = Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, int(msg.totalRounds, MIN_ROUNDS)));
        const maxPlayers = Math.min(MAX_PLAYERS_LIMIT, Math.max(2, int(msg.maxPlayers, 2)));
        // 같은 코드의 방이 이미 있으면 덮어쓰지 않도록 다시 뽑는다
        let id = makeRoomCode();
        while (rooms.has(id)) id = makeRoomCode();
        const room = new Room(
          id,
          {
            roomName: String(msg.roomName ?? '').trim().slice(0, 20) || '이름 없는 방',
            isPrivate: Boolean(msg.isPrivate),
            blindBets: Boolean(msg.blindBets),
            maxPlayers,
            totalRounds
          },
          session.playerId
        );
        room.onEmpty = () => rooms.delete(id);
        room.solo = !!msg.autoStart;
        rooms.set(id, room);
        this.roomsCreated++;

        const player = this.makePlayer(session, sanitizeName(msg.playerName), sendRaw);
        session.name = player.name;
        // 멀티: 데려온 말은 게임 중 몇 라운드에 출전한다 (싱글 모드는 아래에서 따로 등록한다)
        if (msg.myHorse && !msg.autoStart) player.horse = sanitizeMyHorse(msg.myHorse);
        room.addPlayer(player);
        session.roomId = id;

        const npcCount = Math.min(Math.max(0, int(msg.npcCount, 0)), maxPlayers - 1);
        for (let i = 0; i < npcCount; i++) room.addNpc();

        send({ type: 'ROOM_JOINED', snapshot: room.buildSnapshot(session.playerId), you: session.playerId });

        // 싱글 모드: 내 말을 6마리 중 하나로 출전시킨다 (꾸미기는 겉모습 전용이라 검증만 한다)
        if (msg.autoStart && msg.myHorse) {
          room.ownerHorse = { playerId: session.playerId, ...sanitizeMyHorse(msg.myHorse) };
        }

        // 싱글 모드: 로비에서 기다리지 않고 바로 시작한다
        if (msg.autoStart) {
          const err = room.startGame(session.playerId);
          if (err) sendError(err);
        }
        break;
      }

      case 'JOIN_ROOM': {
        if (currentRoom()) return sendError('이미 방에 참가 중입니다.');
        const key = (msg.roomId ?? msg.code ?? '').toString().trim().toUpperCase();
        const room = rooms.get(key);
        if (!room) return sendError('방을 찾을 수 없습니다. 코드를 확인해 주세요.');
        if (room.phase !== 'lobby') return sendError('이미 게임이 시작된 방입니다.');
        if (room.players.size >= room.settings.maxPlayers) return sendError('방이 가득 찼습니다.');

        const player = this.makePlayer(session, sanitizeName(msg.playerName), sendRaw);
        session.name = player.name;
        if (msg.myHorse) player.horse = sanitizeMyHorse(msg.myHorse);
        room.addPlayer(player);
        session.roomId = room.id;
        send({ type: 'ROOM_JOINED', snapshot: room.buildSnapshot(session.playerId), you: session.playerId });
        break;
      }

      case 'RECONNECT': {
        if (currentRoom()) return sendError('이미 방에 참가 중입니다.');
        const room = rooms.get(String(msg.roomId ?? '').toUpperCase());
        if (!room) return sendError('방이 없어졌습니다.');
        const player = room.players.get(String(msg.playerId));
        // NPC는 비밀값이 비어 있으므로 아예 이어받을 수 없게 한다
        if (!player || player.isNpc || !player.secret || player.secret !== msg.secret) {
          return sendError('다시 접속하는 데 필요한 정보가 맞지 않습니다.');
        }
        session.playerId = player.id;
        session.secret = player.secret;
        session.roomId = room.id;
        const wrapper = { send: sendRaw };
        session.wrapper = wrapper;
        room.reconnect(player, wrapper);
        send({ type: 'ROOM_JOINED', snapshot: room.buildSnapshot(player.id), you: player.id });
        break;
      }

      case 'LEAVE_ROOM': {
        const room = currentRoom();
        if (room) {
          room.removePlayer(session.playerId);
          session.roomId = null;
        }
        break;
      }

      case 'ADD_NPC': {
        const room = currentRoom();
        if (!room) return;
        if (session.playerId !== room.hostId) return sendError('방장만 NPC를 추가할 수 있습니다.');
        if (room.phase !== 'lobby') return sendError('로비에서만 NPC를 추가할 수 있습니다.');
        const err = room.addNpc();
        if (err) sendError(err);
        break;
      }

      case 'REMOVE_NPC': {
        const room = currentRoom();
        if (!room) return;
        if (session.playerId !== room.hostId) return sendError('방장만 NPC를 뺄 수 있습니다.');
        if (room.phase !== 'lobby') return sendError('로비에서만 NPC를 뺄 수 있습니다.');
        room.removeNpc();
        break;
      }

      case 'START_GAME': {
        const room = currentRoom();
        if (!room) return;
        const err = room.startGame(session.playerId);
        if (err) sendError(err);
        break;
      }

      case 'SET_COLOR': {
        const room = currentRoom();
        if (!room) return;
        const err = room.setColor(session.playerId, int(msg.color, -1));
        if (err) sendError(err);
        break;
      }

      case 'SET_HORSE': {
        const room = currentRoom();
        if (!room) return;
        const err = room.setHorse(
          session.playerId,
          msg.myHorse ? sanitizeMyHorse(msg.myHorse) : null
        );
        if (err) sendError(err);
        break;
      }

      case 'READY': {
        const room = currentRoom();
        if (room) room.setReady(session.playerId, msg.phase, msg.ready !== false);
        break;
      }

      case 'PLACE_BET': {
        const room = currentRoom();
        if (!room) return;
        const err = room.placeBet(session.playerId, msg.betType, int(msg.horseId, 0), int(msg.amount, 0));
        if (err) sendError(err);
        break;
      }

      case 'CANCEL_BET': {
        const room = currentRoom();
        if (!room) return;
        const err = room.cancelBet(session.playerId, msg.betId);
        if (err) sendError(err);
        break;
      }

      case 'SELECT_AUGMENT': {
        const room = currentRoom();
        if (!room) return;
        room.selectAugment(session.playerId, msg.cardKey, msg.targetHorseId);
        break;
      }

      case 'REROLL_AUGMENT': {
        const room = currentRoom();
        if (room) room.rerollAugment(session.playerId, msg.cardKey);
        break;
      }

      case 'NEXT_ROUND': {
        const room = currentRoom();
        if (!room) return;
        const err = room.nextRound(session.playerId);
        if (err) sendError(err);
        break;
      }

      case 'RESTART': {
        const room = currentRoom();
        if (!room) return;
        const err = room.restart(session.playerId);
        if (err) sendError(err);
        break;
      }

      case 'EMOTE': {
        const room = currentRoom();
        if (!room) return;
        const player = room.players.get(session.playerId);
        // 목록에 있는 이모티콘만, 너무 잦으면 버린다
        const emoji = String(msg.emoji);
        const now = Date.now();
        if (!player || !EMOTES.includes(emoji) || now - session.lastEmoteAt < EMOTE_SERVER_GAP_MS) return;
        session.lastEmoteAt = now;
        room.broadcast({ type: 'EMOTE', playerName: player.name, emoji });
        break;
      }

      case 'SHOUT': {
        const room = currentRoom();
        if (!room) return;
        const player = room.players.get(session.playerId);
        const horseId = Number(msg.horseId);
        const now = Date.now();
        // 경주가 보이는 동안만, 정해 둔 두 가지 외침과 말 번호만 받는다
        if (!player || player.isNpc) return;
        if (room.phase !== 'countdown' && room.phase !== 'racing') return;
        if (!Object.prototype.hasOwnProperty.call(SHOUT_TEXT, msg.kind)) return;
        if (!Number.isInteger(horseId) || horseId < 1 || horseId > HORSES_PER_RACE) return;
        if (now - session.lastShoutAt < SHOUT_SERVER_GAP_MS) return;
        session.lastShoutAt = now;
        room.broadcast({ type: 'SHOUT', playerId: player.id, playerName: player.name, kind: msg.kind, horseId });
        break;
      }
    }
  }

  // ---------------- 관리자 ----------------

  private handleAdmin(session: Session, msg: C2S): void {
    const deny = (message: string): void => session.send({ type: 'ADMIN_DENIED', message });
    if (msg.type === 'ADMIN_LOGIN') {
      if (!this.adminPassword) return deny('관리자 기능이 꺼져 있습니다. 서버에 ADMIN_PASSWORD를 설정해 주세요.');
      const now = Date.now();
      this.adminFails = this.adminFails.filter((t) => now - t < ADMIN_FAIL_WINDOW_MS);
      if (session.adminFails >= ADMIN_FAIL_PER_CONN) return deny('비밀번호를 3번 틀렸습니다. 페이지를 새로 고친 뒤 다시 해 보세요.');
      if (this.adminFails.length >= ADMIN_FAIL_LIMIT) {
        const waitMin = Math.ceil((this.adminFails[0] + ADMIN_FAIL_WINDOW_MS - now) / 60000);
        return deny(`비밀번호를 여러 번 틀려 잠겼습니다. ${waitMin}분 뒤에 다시 해 보세요.`);
      }
      if (!sameSecret(String(msg.password ?? ''), this.adminPassword)) {
        this.adminFails.push(now);
        session.adminFails++;
        return deny('비밀번호가 맞지 않습니다.');
      }
      session.admin = true;
      session.send({ type: 'ADMIN_OK' });
      session.send({ type: 'ADMIN_STATE', state: this.adminState() });
      return;
    }
    if (!session.admin) return deny('먼저 비밀번호를 입력해 주세요.');

    switch (msg.type) {
      case 'ADMIN_REFRESH':
        session.send({ type: 'ADMIN_STATE', state: this.adminState() });
        break;
      case 'ADMIN_GIFT': {
        const result = (ok: boolean, message: string): void => session.send({ type: 'ADMIN_RESULT', ok, message });
        const carrots = int(msg.carrots, 0);
        if (carrots < 1 || carrots > GIFT_MAX) {
          return result(false, `당근은 1~${GIFT_MAX.toLocaleString('ko-KR')}개까지 보낼 수 있습니다.`);
        }
        const target = [...this.sessions].find((x) => x.sid === msg.sid && !x.admin);
        if (!target) return result(false, '그 접속자는 이미 나갔습니다.');
        const note = String(msg.note ?? '').trim().slice(0, 40);
        target.send({ type: 'GIFT', giftId: uid('g'), carrots, note });
        // 브라우저가 다시 알려 주기 전까지 목록에 바로 반영해 둔다
        if (target.carrots !== null) target.carrots += carrots;
        this.giftsSent++;
        result(true, `${target.name ?? '이름 없는 접속자'}에게 당근 ${carrots}개를 보냈습니다.`);
        session.send({ type: 'ADMIN_STATE', state: this.adminState() });
        break;
      }
    }
  }

  private adminState(): AdminState {
    // 메모리는 Node 서버에서만 잴 수 있다 (Cloudflare에는 process가 없다)
    const proc = (globalThis as { process?: { memoryUsage?: () => { rss: number } } }).process;
    const memoryMB = proc?.memoryUsage ? Math.round(proc.memoryUsage().rss / 1048576) : null;
    const users = [...this.sessions]
      .filter((x) => !x.admin)
      .map((x) => {
        const room = x.roomId ? this.rooms.get(x.roomId) : undefined;
        return {
          sid: x.sid,
          name: room?.players.get(x.playerId)?.name ?? x.name,
          carrots: x.carrots,
          roomId: room ? room.id : null,
          roomName: room ? room.settings.roomName : null,
          connectedAt: x.connectedAt
        };
      })
      .sort((a, b) => a.connectedAt - b.connectedAt);
    const rooms = [...this.rooms.values()]
      .map((r) => ({
        id: r.id,
        name: r.settings.roomName,
        solo: r.solo,
        isPrivate: r.settings.isPrivate,
        blindBets: !!r.settings.blindBets,
        phase: r.phase,
        round: r.round,
        totalRounds: r.settings.totalRounds,
        createdAt: r.createdAt,
        players: [...r.players.values()].map((p) => ({
          name: p.name,
          isNpc: p.isNpc,
          connected: p.isNpc || p.connected,
          coins: p.coins,
          isHost: p.id === r.hostId
        }))
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return {
      now: Date.now(),
      startedAt: this.startedAt,
      connections: users.length,
      connectionsTotal: this.connectionsTotal,
      roomsCreated: this.roomsCreated,
      giftsSent: this.giftsSent,
      memoryMB,
      rooms,
      users
    };
  }
}

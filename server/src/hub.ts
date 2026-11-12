import type { C2S, RoomSummary, S2C } from '../../shared/src/types';
import { MAX_PLAYERS_LIMIT, MAX_ROUNDS, MIN_ROUNDS } from '../../shared/src/constants';
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
  playerId: string;
  secret: string;
  roomId: string | null;
  /** 이 연결이 플레이어에 바인딩한 소켓 래퍼 — 늦게 도착한 close와 새 연결을 구분한다 */
  wrapper: { send(data: string): void } | null;
}

function sanitizeName(name: unknown): string {
  const s = String(name ?? '').trim().slice(0, 12);
  return s.length > 0 ? s : '이름없는기수';
}

export class GameHub {
  readonly rooms = new Map<string, Room>();

  /** 새 연결을 받는다. sendRaw는 닫힌 연결에 보내도 예외를 던지지 않아야 한다 */
  open(sendRaw: (data: string) => void): HubConnection {
    const session: Session = { playerId: uid('p'), secret: uid('s'), roomId: null, wrapper: null };
    const send = (msg: S2C): void => sendRaw(JSON.stringify(msg));
    send({ type: 'WELCOME', playerId: session.playerId, secret: session.secret });

    return {
      message: (raw) => {
        let msg: C2S;
        try {
          msg = JSON.parse(raw);
        } catch {
          return send({ type: 'ERROR', message: '잘못된 메시지 형식입니다.' });
        }
        try {
          this.handle(session, msg, send, sendRaw);
        } catch (err) {
          console.error('메시지 처리 오류:', err);
          send({ type: 'ERROR', message: '서버 처리 중 오류가 발생했습니다.' });
        }
      },
      close: () => {
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

    switch (msg.type) {
      case 'LIST_ROOMS': {
        send({ type: 'ROOM_LIST', rooms: this.roomList() });
        break;
      }

      case 'CREATE_ROOM': {
        if (currentRoom()) return sendError('이미 방에 참가 중입니다.');
        const totalRounds = Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.floor(msg.totalRounds)));
        const maxPlayers = Math.min(MAX_PLAYERS_LIMIT, Math.max(2, Math.floor(msg.maxPlayers)));
        const id = makeRoomCode();
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
        rooms.set(id, room);

        const player = this.makePlayer(session, sanitizeName(msg.playerName), sendRaw);
        room.addPlayer(player);
        session.roomId = id;

        const npcCount = Math.min(Math.max(0, Math.floor(msg.npcCount ?? 0)), maxPlayers - 1);
        for (let i = 0; i < npcCount; i++) room.addNpc();

        send({ type: 'ROOM_JOINED', snapshot: room.buildSnapshot(session.playerId), you: session.playerId });

        // 싱글 모드: 내 말을 6마리 중 하나로 출전시킨다 (꾸미기는 겉모습 전용이라 검증만 한다)
        if (msg.autoStart && msg.myHorse) {
          room.ownerHorse = {
            playerId: session.playerId,
            name: sanitizeHorseName(msg.myHorse.name),
            look: sanitizeLook(msg.myHorse.look)
          };
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
        room.addPlayer(player);
        session.roomId = room.id;
        send({ type: 'ROOM_JOINED', snapshot: room.buildSnapshot(session.playerId), you: session.playerId });
        break;
      }

      case 'RECONNECT': {
        const room = rooms.get((msg.roomId ?? '').toUpperCase());
        if (!room) return sendError('방이 더 이상 존재하지 않습니다.');
        const player = room.players.get(msg.playerId);
        if (!player || player.secret !== msg.secret) {
          return sendError('재접속 정보가 올바르지 않습니다.');
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
        if (session.playerId !== room.hostId) return sendError('방장만 NPC를 제거할 수 있습니다.');
        if (room.phase !== 'lobby') return sendError('로비에서만 NPC를 제거할 수 있습니다.');
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

      case 'READY': {
        const room = currentRoom();
        if (room) room.setReady(session.playerId, msg.phase);
        break;
      }

      case 'PLACE_BET': {
        const room = currentRoom();
        if (!room) return;
        const err = room.placeBet(session.playerId, msg.betType, Math.floor(msg.horseId), Math.floor(msg.amount));
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
        const emoji = String(msg.emoji).slice(0, 4);
        if (player) room.broadcast({ type: 'EMOTE', playerName: player.name, emoji });
        break;
      }
    }
  }
}

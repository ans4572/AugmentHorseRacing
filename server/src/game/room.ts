import type {
  AugmentCardView,
  BetCount,
  AugmentTier,
  AugmentDefinition,
  Award,
  Bet,
  BetOutcome,
  BetType,
  HorseInfo,
  HorseLook,
  NpcPersona,
  OddsTable,
  OwnerBonus,
  OwnerPrize,
  PlayerPublic,
  PlayerRoundResult,
  RankingEntry,
  RevealedBet,
  RoomPhase,
  RoomSettings,
  RoomSnapshot,
  S2C,
  Standing
} from '../../../shared/src/types';
import {
  AUGMENT_PHASES,
  BROADCAST_EVERY_TICKS,
  COURSE_LENGTH,
  LOW_COIN_THRESHOLD,
  MIN_PLAYERS_TO_START,
  ROUND_COINS,
  TICK_MS,
  TIMINGS,
  TOP_UP_AMOUNT
} from '../../../shared/src/constants';
import { NPC_PROFILES } from '../../../shared/src/names';
import {
  lookBreed,
  placementCarrots,
  profitCarrots,
  roundPrizeCarrots
} from '../../../shared/src/stable';
import { generateHorses } from '../sim/horses';
import { RaceSim, type BetTotals } from '../sim/race';
import { computeOdds } from './odds';
import { settleBets, validateBet } from './betting';
import { drawCards, rollTier } from './deck';
import { npcChooseAugment, npcChooseBets } from './npc';

export interface SocketLike {
  send(data: string): void;
}

export interface Player {
  id: string;
  secret: string;
  name: string;
  isNpc: boolean;
  persona?: NpcPersona;
  socket: SocketLike | null;
  connected: boolean;
  coins: number;
  coinsAtBettingStart: number;
  readyPreview: boolean;
  readyBetting: boolean;
  // 통계
  hits: number;
  netProfit: number;
  hostileUses: number;
  bestRoundNet: number;
  /** 게임 도중 스스로 나간 플레이어 (연결이 잠깐 끊긴 것과 구분) */
  left?: boolean;
}

interface AugmentPhaseState {
  phase: number;
  /** 이 구간의 등급 — 모든 플레이어 공통 */
  tier: AugmentTier;
  endsAt: number;
  /** playerId → 손패 (cardKey와 정의) */
  hands: Map<string, { cardKey: string; def: AugmentDefinition }[]>;
  used: Set<string>;
  closed: boolean;
}

let idCounter = 0;
function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export class Room {
  id: string;
  settings: RoomSettings;
  hostId: string;
  players = new Map<string, Player>();
  phase: RoomPhase = 'lobby';
  round = 0;
  phaseEndsAt = 0;

  horses: HorseInfo[] = [];
  odds: OddsTable = {};
  sim: RaceSim | null = null;
  bets: Bet[] = [];
  raceStartedAt = 0;

  private augment: AugmentPhaseState | null = null;
  private triggeredPhases = new Set<number>();
  private raceInterval: ReturnType<typeof setInterval> | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tickCount = 0;
  private lastRoundResult: { round: number; results: PlayerRoundResult[]; standings: Standing[]; isFinal: boolean; ownerPrize?: OwnerPrize } | null = null;
  private lastGameResult: { standings: Standing[]; awards: Award[]; ownerBonus?: OwnerBonus } | null = null;
  /** 싱글 모드에서 6마리 중 하나로 출전하는 플레이어의 말 */
  ownerHorse: { playerId: string; name: string; look: HorseLook } | null = null;
  /** 게임(시작~최종 결과)마다 새로 만드는 ID — 당근 중복 지급 방지 키에 쓴다 */
  private gameId = '';
  private ownerRoundCarrots = 0;
  private lastRankings: RankingEntry[] | null = null;
  private roundTopUps: { playerId: string; playerName: string; amount: number }[] = [];

  onEmpty: (() => void) | null = null;

  constructor(id: string, settings: RoomSettings, hostId: string) {
    this.id = id;
    this.settings = settings;
    this.hostId = hostId;
  }

  // ---------------- 유틸 ----------------

  private setTimer(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  send(player: Player, msg: S2C): void {
    if (player.socket && player.connected) {
      try {
        player.socket.send(JSON.stringify(msg));
      } catch {
        /* 전송 실패 무시 */
      }
    }
  }

  broadcast(msg: S2C): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.socket && p.connected) {
        try {
          p.socket.send(data);
        } catch {
          /* 무시 */
        }
      }
    }
  }

  publicPlayers(): PlayerPublic[] {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      isNpc: p.isNpc,
      connected: p.connected,
      coins: p.coins,
      isHost: p.id === this.hostId,
      ready: p.isNpc || (this.phase === 'preview' ? p.readyPreview : this.phase === 'betting' ? p.readyBetting : false)
    }));
  }

  broadcastRoomUpdate(): void {
    this.broadcast({ type: 'ROOM_UPDATE', players: this.publicPlayers(), settings: this.settings });
  }

  humanPlayers(): Player[] {
    return [...this.players.values()].filter((p) => !p.isNpc);
  }

  connectedHumans(): Player[] {
    return this.humanPlayers().filter((p) => p.connected);
  }

  // ---------------- 참가 / 퇴장 ----------------

  addPlayer(player: Player): void {
    this.players.set(player.id, player);
    this.broadcastRoomUpdate();
  }

  addNpc(): string | null {
    if (this.players.size >= this.settings.maxPlayers) return '방이 가득 찼습니다.';
    const used = new Set([...this.players.values()].map((p) => p.name));
    const profile = NPC_PROFILES.find((p) => !used.has(p.name));
    if (!profile) return '추가할 수 있는 NPC가 없습니다.';
    const npc: Player = {
      id: uid('npc'),
      secret: '',
      name: profile.name,
      isNpc: true,
      persona: profile.persona,
      socket: null,
      connected: false,
      coins: 0,
      coinsAtBettingStart: 0,
      readyPreview: false,
      readyBetting: false,
      hits: 0,
      netProfit: 0,
      hostileUses: 0,
      bestRoundNet: 0
    };
    this.players.set(npc.id, npc);
    this.broadcastRoomUpdate();
    return null;
  }

  removeNpc(): void {
    const npcs = [...this.players.values()].filter((p) => p.isNpc);
    const last = npcs[npcs.length - 1];
    if (last) {
      this.players.delete(last.id);
      this.broadcastRoomUpdate();
    }
  }

  removePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    if (this.phase === 'lobby' || this.phase === 'gameResult') {
      this.players.delete(playerId);
    } else {
      // 게임 중에는 기록을 남겨 둔다 (걸어 둔 배팅은 그대로 정산, 경주는 계속 진행)
      player.connected = false;
      player.socket = null;
      player.left = true;
    }
    this.afterPresenceChange(playerId);
  }

  markDisconnected(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.socket = null;
    if (this.phase === 'lobby') {
      // 로비에서 끊기면 바로 제거
      this.players.delete(playerId);
    }
    this.afterPresenceChange(playerId);
  }

  private afterPresenceChange(leftId: string): void {
    // 방장 승계
    if (leftId === this.hostId) {
      const next = this.connectedHumans()[0];
      if (next) this.hostId = next.id;
    }
    this.broadcastRoomUpdate();

    // 남아 있는 사람이 전부 스스로 나갔다면 돌아올 사람이 없으므로 바로 정리한다
    if (this.humanPlayers().every((p) => p.left)) {
      this.destroy('모든 플레이어가 나갔습니다.');
      return;
    }

    // 연결만 끊긴 사람이 있으면 재접속을 기다리며 2분 후 방 정리
    if (this.connectedHumans().length === 0) {
      this.setTimer(() => {
        if (this.connectedHumans().length === 0) this.destroy('모든 플레이어가 나갔습니다.');
      }, 120000);
    } else {
      this.checkEarlySkip();
    }
  }

  reconnect(player: Player, socket: SocketLike): void {
    player.socket = socket;
    player.connected = true;
    this.broadcastRoomUpdate();
  }

  destroy(reason: string): void {
    this.clearTimers();
    if (this.raceInterval) clearInterval(this.raceInterval);
    this.raceInterval = null;
    this.broadcast({ type: 'ROOM_CLOSED', reason });
    this.onEmpty?.();
  }

  // ---------------- 게임 시작 / 라운드 ----------------

  startGame(byPlayerId: string): string | null {
    if (byPlayerId !== this.hostId) return '방장만 게임을 시작할 수 있습니다.';
    if (this.phase !== 'lobby') return '이미 게임이 진행 중입니다.';
    if (this.players.size < MIN_PLAYERS_TO_START) {
      return `최소 ${MIN_PLAYERS_TO_START}명(NPC 포함)이 필요합니다.`;
    }
    const startCoins = ROUND_COINS[this.settings.totalRounds];
    for (const p of this.players.values()) {
      p.coins = startCoins;
      p.hits = 0;
      p.netProfit = 0;
      p.hostileUses = 0;
      p.bestRoundNet = 0;
    }
    this.round = 0;
    this.lastGameResult = null;
    this.gameId = uid('g');
    this.ownerRoundCarrots = 0;
    this.broadcast({ type: 'GAME_START', totalRounds: this.settings.totalRounds, startCoins });
    this.startRound(1);
    return null;
  }

  private startRound(round: number): void {
    this.clearTimers();
    this.round = round;
    this.bets = [];
    this.sim = null;
    this.lastRankings = null;
    this.lastRoundResult = null;
    this.augment = null;
    this.triggeredPhases.clear();

    // 코인 부족 구제 (최종 라운드 이후에는 하지 않음 — 라운드 시작 시에만)
    this.roundTopUps = [];
    if (round > 1) {
      for (const p of this.players.values()) {
        if (p.coins < LOW_COIN_THRESHOLD) {
          const amount = TOP_UP_AMOUNT - p.coins;
          p.coins = TOP_UP_AMOUNT;
          this.roundTopUps.push({ playerId: p.id, playerName: p.name, amount });
        }
      }
    }

    this.horses = generateHorses();
    this.enterOwnerHorse();
    this.odds = computeOdds(this.horses);

    for (const p of this.players.values()) {
      p.readyPreview = false;
      p.readyBetting = false;
    }

    this.phase = 'preview';
    this.phaseEndsAt = Date.now() + TIMINGS.preview;
    for (const p of this.players.values()) {
      this.send(p, {
        type: 'ROUND_START',
        round,
        totalRounds: this.settings.totalRounds,
        horses: this.horses,
        odds: this.odds,
        phaseEndsAt: this.phaseEndsAt,
        coins: p.coins,
        topUps: this.roundTopUps
      });
    }
    this.broadcastRoomUpdate();
    this.setTimer(() => this.startBetting(), TIMINGS.preview);
  }

  /**
   * 내 말을 무작위 레인에 출전시킨다. 능력치는 그 레인에 뽑힌 값을 그대로 쓰고
   * (매 경기 무작위) 이름·종류·꾸미기만 내 말의 것으로 바꾼다.
   */
  private enterOwnerHorse(rng: () => number = Math.random): void {
    const owner = this.ownerHorse;
    if (!owner) return;
    const player = this.players.get(owner.playerId);
    if (!player || player.left) return;
    const horse = this.horses[Math.floor(rng() * this.horses.length)];
    // 같은 이름의 출전마가 있으면 그 말의 이름과 맞바꿔 겹치지 않게 한다
    const clash = this.horses.find((h) => h !== horse && h.name === owner.name);
    if (clash) clash.name = horse.name;
    horse.name = owner.name;
    horse.breed = lookBreed(owner.look);
    horse.ownerId = owner.playerId;
    horse.look = owner.look;
  }

  /** 지금 출전 중인 내 말의 번호 (없으면 null) */
  private ownerHorseId(): number | null {
    return this.horses.find((h) => h.ownerId)?.id ?? null;
  }

  private startBetting(): void {
    if (this.phase !== 'preview') return;
    this.clearTimers();
    this.phase = 'betting';
    this.phaseEndsAt = Date.now() + TIMINGS.betting;
    for (const p of this.players.values()) {
      p.coinsAtBettingStart = p.coins;
    }
    this.broadcast({ type: 'BETTING_START', endsAt: this.phaseEndsAt });

    // NPC 배팅 예약
    for (const p of this.players.values()) {
      if (!p.isNpc || !p.persona) continue;
      this.setTimer(() => {
        if (this.phase !== 'betting') return;
        const choices = npcChooseBets(p.persona!, p.coinsAtBettingStart, this.horses, this.odds);
        for (const c of choices) {
          this.placeBet(p.id, c.type, c.horseId, c.amount);
        }
      }, 2000 + Math.random() * 5000);
    }

    this.setTimer(() => this.closeBetting(), TIMINGS.betting);
  }

  private closeBetting(): void {
    if (this.phase !== 'betting') return;
    this.clearTimers();
    // 조기 마감 시 아직 배팅하지 않은 NPC는 즉시 배팅시킨다
    for (const p of this.players.values()) {
      if (!p.isNpc || !p.persona) continue;
      if (this.bets.some((b) => b.playerId === p.id)) continue;
      const choices = npcChooseBets(p.persona, p.coinsAtBettingStart, this.horses, this.odds);
      for (const c of choices) this.placeBet(p.id, c.type, c.horseId, c.amount);
    }
    this.phase = 'reveal';
    this.phaseEndsAt = Date.now() + TIMINGS.reveal;
    // 블라인드 방에서는 다른 사람의 배팅 내용을 아예 보내지 않는다 (건수만 공개)
    const betCounts = this.betCounts();
    for (const p of this.players.values()) {
      this.send(p, {
        type: 'BET_REVEAL',
        bets: this.visibleBets(p.id),
        betCounts,
        blind: !!this.settings.blindBets,
        endsAt: this.phaseEndsAt
      });
    }
    this.broadcastRoomUpdate();
    this.setTimer(() => this.startCountdown(), TIMINGS.reveal);
  }

  /** 이 플레이어가 볼 수 있는 배팅: 블라인드 방이면 본인 것만, 아니면 전부 */
  private visibleBets(forPlayerId: string): RevealedBet[] {
    const all = this.revealedBets();
    return this.settings.blindBets ? all.filter((b) => b.playerId === forPlayerId) : all;
  }

  private betCounts(): BetCount[] {
    return [...this.players.values()].map((p) => ({
      playerId: p.id,
      count: this.bets.filter((b) => b.playerId === p.id).length
    }));
  }

  private revealedBets(): RevealedBet[] {
    return this.bets.map((b) => ({
      ...b,
      playerName: this.players.get(b.playerId)?.name ?? '???'
    }));
  }

  private startCountdown(): void {
    this.phase = 'countdown';
    this.phaseEndsAt = Date.now() + TIMINGS.countdown;
    this.broadcast({ type: 'COUNTDOWN', endsAt: this.phaseEndsAt });
    this.setTimer(() => this.startRace(), TIMINGS.countdown);
  }

  // ---------------- 준비(스킵) ----------------

  setReady(playerId: string, phase: 'preview' | 'betting'): void {
    const p = this.players.get(playerId);
    if (!p) return;
    if (phase === 'preview') p.readyPreview = true;
    else p.readyBetting = true;
    this.broadcastRoomUpdate();
    this.checkEarlySkip();
  }

  private checkEarlySkip(): void {
    const humans = this.connectedHumans();
    if (humans.length === 0) return;
    if (this.phase === 'preview' && humans.every((p) => p.readyPreview)) {
      this.startBetting();
    } else if (this.phase === 'betting' && humans.every((p) => p.readyBetting)) {
      this.closeBetting();
    }
  }

  // ---------------- 배팅 ----------------

  placeBet(playerId: string, betType: BetType, horseId: number, amount: number): string | null {
    if (this.phase !== 'betting') return '지금은 배팅할 수 없습니다.';
    const player = this.players.get(playerId);
    if (!player) return '플레이어를 찾을 수 없습니다.';
    const horse = this.horses.find((h) => h.id === horseId);
    if (!horse) return '존재하지 않는 말입니다.';
    const odds = this.odds[horseId]?.[betType];
    if (!odds) return '배당 정보를 찾을 수 없습니다.';

    const existingTotal = this.bets
      .filter((b) => b.playerId === playerId)
      .reduce((s, b) => s + b.amount, 0);
    const error = validateBet(amount, existingTotal, player.coinsAtBettingStart, player.coins);
    if (error) return error;

    const bet: Bet = { betId: uid('bet'), playerId, type: betType, horseId, amount, odds };
    this.bets.push(bet);
    player.coins -= amount;
    this.send(player, { type: 'BET_ACCEPTED', bet, coins: player.coins });
    return null;
  }

  cancelBet(playerId: string, betId: string): string | null {
    if (this.phase !== 'betting') return '배팅 시간이 끝나 취소할 수 없습니다.';
    const idx = this.bets.findIndex((b) => b.betId === betId && b.playerId === playerId);
    if (idx < 0) return '해당 배팅을 찾을 수 없습니다.';
    const [bet] = this.bets.splice(idx, 1);
    const player = this.players.get(playerId)!;
    player.coins += bet.amount;
    this.send(player, { type: 'BET_CANCELED', betId, coins: player.coins });
    return null;
  }

  private betTotals(): BetTotals {
    const win = new Map<number, number>();
    const total = new Map<number, number>();
    for (const b of this.bets) {
      total.set(b.horseId, (total.get(b.horseId) ?? 0) + b.amount);
      if (b.type === 'winner') win.set(b.horseId, (win.get(b.horseId) ?? 0) + b.amount);
    }
    return { win, total };
  }

  // ---------------- 경주 ----------------

  private startRace(): void {
    this.phase = 'racing';
    this.sim = new RaceSim(this.horses);
    this.raceStartedAt = Date.now();
    this.tickCount = 0;
    this.broadcast({ type: 'RACE_START', startedAt: this.raceStartedAt });

    this.raceInterval = setInterval(() => this.raceTick(), TICK_MS);
  }

  private raceTick(): void {
    const sim = this.sim;
    if (!sim) return;
    sim.tick(TICK_MS);
    this.tickCount++;

    // 증강 구간 발동 체크 (선두 말 진행도 기준)
    if (!sim.allFinished()) {
      const leaderProgress = sim.leaderPos() / COURSE_LENGTH;
      for (const phaseDef of AUGMENT_PHASES) {
        if (this.triggeredPhases.has(phaseDef.phase)) continue;
        if (leaderProgress >= phaseDef.at) {
          this.triggerAugmentPhase(phaseDef.phase, phaseDef.durationMs);
          break; // 한 틱에 하나씩
        }
      }
    }

    // 열린 증강 구간의 시간 만료 처리
    if (this.augment && !this.augment.closed && Date.now() >= this.augment.endsAt) {
      this.closeAugmentPhase();
    }

    // 상태 브로드캐스트 (10Hz)
    if (this.tickCount % BROADCAST_EVERY_TICKS === 0 || sim.allFinished()) {
      this.broadcast({ type: 'RACE_STATE', t: sim.now, horses: sim.snapshot() });
    }

    // 전원 완주 → 경주 종료
    if (sim.allFinished()) {
      if (this.raceInterval) clearInterval(this.raceInterval);
      this.raceInterval = null;
      if (this.augment && !this.augment.closed) this.closeAugmentPhase();
      this.lastRankings = sim.finalRankings();
      this.broadcast({ type: 'RACE_FINISH', rankings: this.lastRankings });
      this.setTimer(() => this.settleRound(), TIMINGS.finishHold);
    }
  }

  // ---------------- 증강 ----------------

  private triggerAugmentPhase(phase: number, durationMs: number): void {
    const sim = this.sim;
    if (!sim) return;
    this.triggeredPhases.add(phase);
    // 이전 구간이 아직 열려 있으면 닫는다
    if (this.augment && !this.augment.closed) this.closeAugmentPhase();

    const totals = this.betTotals();
    const endsAt = Date.now() + durationMs;
    // 등급은 구간당 한 번만 뽑아 전원이 공유한다. 카드는 그 등급 안에서 각자 다르게 뽑는다.
    const tier = rollTier(phase);
    const hands = new Map<string, { cardKey: string; def: AugmentDefinition }[]>();

    for (const p of this.players.values()) {
      const cards = drawCards(sim, phase, tier, totals);
      const hand = cards.map((def, i) => ({ cardKey: `${phase}:${p.id}:${i}`, def }));
      hands.set(p.id, hand);
      const view: AugmentCardView[] = hand.map((c) => ({ cardKey: c.cardKey, defId: c.def.id }));
      this.send(p, { type: 'AUGMENT_PHASE', phase, tier, endsAt, cards: view });
    }

    this.augment = { phase, tier, endsAt, hands, used: new Set(), closed: false };

    // NPC 증강 선택 예약 (연결이 끊긴 사람에게는 자동 사용하지 않음 — NPC만)
    for (const p of this.players.values()) {
      if (!p.isNpc || !p.persona) continue;
      const delay = 1200 + Math.random() * Math.max(1000, durationMs - 2500);
      this.setTimer(() => {
        const aug = this.augment;
        if (!aug || aug.closed || aug.phase !== phase || aug.used.has(p.id)) return;
        if (!this.sim || this.sim.allFinished()) return;
        const hand = aug.hands.get(p.id) ?? [];
        const myBoost = this.bets
          .filter((b) => b.playerId === p.id && (b.type === 'winner' || b.type === 'top3'))
          .map((b) => b.horseId);
        const myHinder = this.bets
          .filter((b) => b.playerId === p.id && (b.type === 'last' || b.type === 'bottom3'))
          .map((b) => b.horseId);
        const totalsNow = this.betTotals();
        let mostBet: number | null = null;
        let mostVal = -1;
        for (const [hid, v] of totalsNow.total) {
          if (v > mostVal) {
            mostVal = v;
            mostBet = hid;
          }
        }
        const choice = npcChooseAugment(
          p.persona!,
          hand.map((h) => h.def),
          {
            sim: this.sim,
            myBoostTargets: myBoost,
            myHinderTargets: myHinder,
            // 블라인드 방에서는 NPC도 남의 배팅을 모르는 것으로 한다
            mostBetHorse: this.settings.blindBets ? null : mostBet,
            ownerHorse: this.ownerHorseId()
          }
        );
        if (choice) {
          this.selectAugment(p.id, hand[choice.index].cardKey, choice.targetHorseId);
        }
      }, delay);
    }
  }

  private closeAugmentPhase(): void {
    if (!this.augment || this.augment.closed) return;
    this.augment.closed = true;
    this.broadcast({ type: 'AUGMENT_CLOSED', phase: this.augment.phase });
  }

  selectAugment(playerId: string, cardKey: string, targetHorseId?: number): void {
    const player = this.players.get(playerId);
    const aug = this.augment;
    const sim = this.sim;
    const fail = (message: string) => {
      if (player) this.send(player, { type: 'AUGMENT_RESULT', ok: false, message });
    };

    if (!player || !aug || !sim) return fail('증강을 사용할 수 없습니다.');
    if (aug.closed || Date.now() >= aug.endsAt) return fail('증강 선택 시간이 지났습니다.');
    if (sim.allFinished()) return fail('경주가 이미 끝났습니다.');
    if (aug.used.has(playerId)) return fail('이번 구간에서는 이미 카드를 사용했습니다.');

    const hand = aug.hands.get(playerId) ?? [];
    const card = hand.find((c) => c.cardKey === cardKey);
    if (!card) return fail('손패에 없는 카드입니다.');

    const result = sim.applyAugment(card.def, { targetHorseId, bets: this.betTotals() });
    if (!result.ok) {
      // 카드를 소모하지 않음 — 다른 카드를 선택할 수 있다
      return fail(result.message ?? '카드를 사용할 수 없습니다.');
    }

    aug.used.add(playerId);
    if (card.def.hostile) player.hostileUses++;
    this.broadcast({
      type: 'AUGMENT_USED',
      playerName: player.name,
      defId: card.def.id,
      targets: result.targets,
      blocked: result.blocked
    });
    this.send(player, { type: 'AUGMENT_RESULT', ok: true, cardKey });
  }

  // ---------------- 정산 / 결과 ----------------

  private settleRound(): void {
    if (!this.lastRankings) return;
    const outcomes = settleBets(this.bets, this.lastRankings);
    const byPlayer = new Map<string, BetOutcome[]>();
    for (const o of outcomes) {
      const list = byPlayer.get(o.playerId) ?? [];
      list.push(o);
      byPlayer.set(o.playerId, list);
    }

    const results: PlayerRoundResult[] = [];
    for (const p of this.players.values()) {
      const myOutcomes = byPlayer.get(p.id) ?? [];
      const payout = myOutcomes.reduce((s, o) => s + o.payout, 0);
      const staked = myOutcomes.reduce((s, o) => s + o.amount, 0);
      const net = payout - staked;
      p.coins += payout;
      p.netProfit += net;
      p.hits += myOutcomes.filter((o) => o.hit).length;
      p.bestRoundNet = Math.max(p.bestRoundNet, net);
      results.push({ playerId: p.id, playerName: p.name, bets: myOutcomes, net, coins: p.coins });
    }

    const isFinal = this.round >= this.settings.totalRounds;
    const standings = this.computeStandings();

    // 내 말의 순위 상금 (당근)
    let ownerPrize: OwnerPrize | undefined;
    const mine = this.horses.find((h) => h.ownerId);
    const mineRank = mine ? this.lastRankings.find((r) => r.horseId === mine.id)?.rank : undefined;
    if (mine && mine.ownerId && mineRank) {
      const carrots = roundPrizeCarrots(mineRank);
      this.ownerRoundCarrots += carrots;
      ownerPrize = {
        key: `${this.gameId}:r${this.round}`,
        playerId: mine.ownerId,
        horseId: mine.id,
        horseName: mine.name,
        rank: mineRank,
        carrots
      };
    }

    this.lastRoundResult = { round: this.round, results, standings, isFinal, ownerPrize };
    this.phase = 'roundResult';
    this.broadcast({ type: 'ROUND_RESULT', round: this.round, results, standings, isFinal, ownerPrize });
  }

  computeStandings(): Standing[] {
    const sorted = [...this.players.values()].sort((a, b) => {
      if (b.coins !== a.coins) return b.coins - a.coins;
      if (b.netProfit !== a.netProfit) return b.netProfit - a.netProfit;
      return b.hits - a.hits;
    });
    const standings: Standing[] = [];
    let prevRank = 0;
    sorted.forEach((p, i) => {
      // 동일 코인·순이익·적중이면 공동 순위
      const prev = sorted[i - 1];
      const tied =
        prev && prev.coins === p.coins && prev.netProfit === p.netProfit && prev.hits === p.hits;
      const rank = tied ? prevRank : i + 1;
      prevRank = rank;
      standings.push({
        playerId: p.id,
        name: p.name,
        isNpc: p.isNpc,
        coins: p.coins,
        rank,
        hits: p.hits,
        netProfit: p.netProfit
      });
    });
    return standings;
  }

  nextRound(byPlayerId: string): string | null {
    if (byPlayerId !== this.hostId) return '방장만 진행할 수 있습니다.';
    if (this.phase !== 'roundResult') return '지금은 진행할 수 없습니다.';
    if (this.round >= this.settings.totalRounds) {
      this.showGameResult();
    } else {
      this.startRound(this.round + 1);
    }
    return null;
  }

  private showGameResult(): void {
    const standings = this.computeStandings();
    const awards: Award[] = [];

    const byBestNet = [...this.players.values()].sort((a, b) => b.bestRoundNet - a.bestRoundNet)[0];
    if (byBestNet && byBestNet.bestRoundNet > 0) {
      awards.push({
        title: '코인 대박상',
        playerName: byBestNet.name,
        detail: `한 라운드 최대 순이익 +${byBestNet.bestRoundNet}`
      });
    }
    const byHostile = [...this.players.values()].sort((a, b) => b.hostileUses - a.hostileUses)[0];
    if (byHostile && byHostile.hostileUses > 0) {
      awards.push({
        title: '최다 견제상',
        playerName: byHostile.name,
        detail: `방해 증강 ${byHostile.hostileUses}회 사용`
      });
    }
    const byHits = [...this.players.values()].sort((a, b) => b.hits - a.hits)[0];
    if (byHits && byHits.hits > 0) {
      awards.push({
        title: '명예 예언가상',
        playerName: byHits.name,
        detail: `배팅 ${byHits.hits}회 적중`
      });
    }

    // 내 말을 출전시킨 플레이어의 게임 종료 보너스 (당근)
    let ownerBonus: OwnerBonus | undefined;
    const owner = this.ownerHorse ? this.players.get(this.ownerHorse.playerId) : undefined;
    const ownerStanding = owner ? standings.find((s) => s.playerId === owner.id) : undefined;
    if (owner && !owner.left && ownerStanding) {
      ownerBonus = {
        key: `${this.gameId}:final`,
        playerId: owner.id,
        placement: ownerStanding.rank,
        placementCarrots: placementCarrots(ownerStanding.rank),
        profitCarrots: profitCarrots(owner.netProfit),
        roundCarrots: this.ownerRoundCarrots
      };
    }

    this.lastGameResult = { standings, awards, ownerBonus };
    this.phase = 'gameResult';
    this.broadcast({ type: 'GAME_RESULT', standings, awards, ownerBonus });
  }

  restart(byPlayerId: string): string | null {
    if (byPlayerId !== this.hostId) return '방장만 다시 시작할 수 있습니다.';
    if (this.phase !== 'gameResult') return '지금은 다시 시작할 수 없습니다.';
    this.clearTimers();
    this.phase = 'lobby';
    this.round = 0;
    this.bets = [];
    this.sim = null;
    this.lastGameResult = null;
    this.lastRoundResult = null;
    this.broadcast({ type: 'LOBBY_RETURN' });
    this.broadcastRoomUpdate();
    return null;
  }

  // ---------------- 스냅샷 (참가/재접속 복구) ----------------

  buildSnapshot(forPlayerId: string): RoomSnapshot {
    const player = this.players.get(forPlayerId);
    const snapshot: RoomSnapshot = {
      roomId: this.id,
      code: this.settings.isPrivate ? this.id : undefined,
      settings: this.settings,
      players: this.publicPlayers(),
      phase: this.phase,
      round: this.round,
      phaseEndsAt: this.phaseEndsAt,
      coins: player?.coins ?? 0,
      myBets: this.bets.filter((b) => b.playerId === forPlayerId)
    };
    if (this.phase !== 'lobby') {
      snapshot.horses = this.horses;
      snapshot.odds = this.odds;
    }
    if (
      this.phase === 'reveal' ||
      this.phase === 'countdown' ||
      this.phase === 'racing' ||
      this.phase === 'roundResult'
    ) {
      // 라운드 결과가 나온 뒤에는 블라인드 방이어도 전부 공개된다
      snapshot.revealedBets =
        this.phase === 'roundResult' ? this.revealedBets() : this.visibleBets(forPlayerId);
      snapshot.betCounts = this.betCounts();
    }
    if (this.phase === 'racing' && this.sim) {
      snapshot.race = { startedAt: this.raceStartedAt, horses: this.sim.snapshot() };
      const aug = this.augment;
      if (aug && !aug.closed && Date.now() < aug.endsAt) {
        const hand = aug.hands.get(forPlayerId) ?? [];
        snapshot.augment = {
          phase: aug.phase,
          tier: aug.tier,
          endsAt: aug.endsAt,
          cards: hand.map((c) => ({ cardKey: c.cardKey, defId: c.def.id })),
          used: aug.used.has(forPlayerId)
        };
      }
    }
    if (this.lastRankings) snapshot.rankings = this.lastRankings;
    if (this.phase === 'roundResult' && this.lastRoundResult) {
      snapshot.roundResult = this.lastRoundResult;
    }
    if (this.phase === 'gameResult' && this.lastGameResult) {
      snapshot.gameResult = this.lastGameResult;
    }
    return snapshot;
  }
}

export { uid };

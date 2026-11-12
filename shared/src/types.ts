// ============================================================
// 증강 경마 (Augment Derby) — 공유 타입 정의
// 클라이언트와 서버가 함께 사용하는 모든 데이터 구조
// ============================================================

// ---------------- 말 ----------------

export interface HorseStats {
  /** 속력 1~100 */
  speed: number;
  /** 가속력 1~100 */
  accel: number;
  /** 지구력 1~100 */
  stamina: number;
  /** 몸무게 350~650(kg) */
  weight: number;
  /** 행운 1~100 */
  luck: number;
}

/** 말의 종류 — 겉모습만 다르고 능력치에는 영향이 없다 */
export type HorseBreed = 'horse' | 'zebra' | 'unicorn' | 'donkey' | 'cow';

export interface HorseInfo {
  id: number; // 1~6
  name: string;
  color: string;
  breed: HorseBreed;
  stats: HorseStats;
  /** 이 말의 주인 (싱글 모드의 내 말). 없으면 주인 없는 일반 출전마 */
  ownerId?: string;
  /** 주인이 고른 꾸미기 — 겉모습 전용 */
  look?: HorseLook;
}

/** 꾸미기 칸 */
export type CosmeticSlot = 'breed' | 'coat' | 'hat' | 'neck' | 'face' | 'trail';

/** 칸마다 고른 꾸미기 항목 ID (shared/src/stable.ts 의 COSMETICS) */
export type HorseLook = Record<CosmeticSlot, string>;

/** 방을 만들 때 보내는 내 말 정보 */
export interface MyHorseEntry {
  name: string;
  look: HorseLook;
}

/** 내 말의 라운드 순위 상금 (당근) */
export interface OwnerPrize {
  /** 중복 지급을 막는 고유 키 */
  key: string;
  playerId: string;
  horseId: number;
  horseName: string;
  rank: number;
  carrots: number;
}

/** 게임이 끝났을 때 받는 당근 보너스 */
export interface OwnerBonus {
  key: string;
  playerId: string;
  placement: number;
  placementCarrots: number;
  profitCarrots: number;
  /** 이번 게임에서 라운드 상금으로 이미 받은 당근 합계 (표시용) */
  roundCarrots: number;
}

export type HorseAnim =
  | 'idle'
  | 'run'
  | 'boost'
  | 'slow'
  | 'tired'
  | 'stunned'
  | 'fallen'
  | 'flying'
  | 'reverse'
  | 'finished';

export interface EffectView {
  defId: string;
  emoji: string;
  hostile: boolean;
  remainMs: number;
}

export interface HorseSnapshot {
  id: number;
  pos: number;
  speed: number;
  rank: number; // 1~6 (현재 순위)
  finished: boolean;
  stamina: number;
  staminaMax: number;
  anim: HorseAnim;
  effects: EffectView[];
  shield: number;
}

// ---------------- 배팅 ----------------

export type BetType = 'winner' | 'last' | 'top3' | 'bottom3';

/** odds[horseId][betType] = 배당률 */
export type OddsTable = Record<number, Record<BetType, number>>;

export interface Bet {
  betId: string;
  playerId: string;
  type: BetType;
  horseId: number;
  amount: number;
  odds: number;
}

export interface RevealedBet extends Bet {
  playerName: string;
}

export interface BetOutcome extends Bet {
  hit: boolean;
  payout: number; // 적중 시 지급액(원금 포함), 실패 시 0
}

// ---------------- 증강 ----------------

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** 증강 구간 등급 — 한 구간의 등급은 모든 플레이어에게 같고, 카드만 플레이어마다 다르다 */
export type AugmentTier = 'silver' | 'gold' | 'platinum';

export type TargetType =
  | 'single'       // 원하는 말 1마리
  | 'odd'          // 1,3,5번
  | 'even'         // 2,4,6번
  | 'front3'       // 현재 1~3등
  | 'back3'        // 현재 4~6등
  | 'rank1'        // 현재 1등
  | 'rank2'        // 현재 2등
  | 'rank6'        // 현재 6등
  | 'rank23'       // 현재 2등과 3등
  | 'rank34'       // 현재 3등과 4등
  | 'fastest2'     // 기본 속력 상위 2마리
  | 'slowest2'     // 기본 속력 하위 2마리
  | 'heaviest2'    // 몸무게 상위 2마리
  | 'mostStamina2' // 현재 지구력 상위 2마리
  | 'leastStamina2'// 현재 지구력 하위 2마리
  | 'mostBetWin'   // 우승 배팅금 최다 말
  | 'leastBetWin'  // 우승 배팅금 최소 말
  | 'mostBetTotal' // 전체 배팅금 최다 말
  | 'swap16';      // 현재 1등과 6등 위치 교환

export type EffectType =
  | 'speedMult'          // value: 증감률(+0.2 = +20%)
  | 'accelMult'          // value: 증감률
  | 'weightMult'         // value: 배수(3.0 = 3배)
  | 'stop'               // 정지
  | 'reverse'            // 뒤로 이동
  | 'fly'                // 비행 (value: 속력 보너스)
  | 'teleport'           // value: 코스 거리 비율(0.03 = 3%)
  | 'staminaRestorePct'  // value: 최대 지구력 대비 회복 %
  | 'staminaDrainPct'    // value: 현재 지구력 감소 %
  | 'shield'             // 방해 1회 무효
  | 'swapPositions'      // 위치 교환
  | 'rankBasedSpeed'     // 순위 기반 속력 증가 (최후의 질주)
  | 'cosmetic';          // 연출 전용 표시 — 즉시 효과 카드의 모습을 잠깐 보여 준다 (능력치 영향 없음)

export interface AugmentDefinition {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  targetType: TargetType;
  effectType: EffectType;
  value: number;
  durationMs: number; // 0 = 즉시 효과
  allowedPhases: number[]; // [1,2,3]
  hostile: boolean;
  emoji: string;
  anim?: HorseAnim;
  /** 3D 화면에서 말의 모습을 바꾸는 연출 종류 */
  visual?: AugmentVisual;
  /** 즉시 효과 카드(durationMs 0)의 연출을 보여 줄 시간 */
  visualMs?: number;
}

export type AugmentVisual =
  | 'bulk' // 몸집이 커짐
  | 'slim' // 몸집이 작아짐
  | 'muscle' // 살짝 커짐
  | 'bipedal' // 두 발로 일어섬
  | 'pony' // 조랑말 (작은 몸, 짧은 다리)
  | 'giraffe' // 긴 목
  | 'balloon' // 부풀어 떠오름
  | 'giant' // 2배 거대화
  | 'paper' // 납작해짐
  | 'moonwalk' // 뒤돌아 달림
  | 'spin' // 빙글빙글 회전
  | 'disco' // 무지개색으로 춤
  | 'shades' // 선글라스
  | 'hop' // 토끼뜀
  | 'fart' // 초록 연기
  | 'wobble' // 비틀비틀 좌우로 흔들림
  | 'bighead' // 머리가 커짐 (대두)
  | 'pose' // 멈춰서 카메라를 보고 포즈
  | 'eat' // 멈춰서 고개를 숙이고 먹음
  | 'rocket' // 엉덩이가 들린 채 앞다리로만 달림
  | 'nap' // 벌렁 드러누워 다리를 하늘로 뻗고 잠
  | 'backpedal' // 머리만 뒤로 돌리고 뒷걸음질
  | 'droop' // 목이 축 늘어져 머리를 끌고 감
  | 'jitter' // 눈이 커지고 온몸을 덜덜 떨며 다리가 빨라짐
  | 'poop' // 다리를 꼬고 종종걸음
  | 'flip' // 공중제비 후 엉덩방아
  | 'lowbat' // 뚝뚝 끊기다 고개를 떨굼
  | 'warp' // 납작하게 눌렸다가 길게 늘어남
  | 'siren' // 머리에 경광등
  | 'swap'; // 하늘로 솟았다가 떨어짐

export interface AugmentCardView {
  cardKey: string; // 이 제시(offer)에만 유효한 고유 키
  defId: string;
}

// ---------------- 플레이어 / 방 ----------------

export type NpcPersona =
  | 'winner'    // 승부사
  | 'saboteur'  // 방해꾼
  | 'avenger'   // 복수귀
  | 'gambler'   // 도박꾼
  | 'angel'     // 천사
  | 'chaos';    // 혼돈의 왕

export interface PlayerPublic {
  id: string;
  name: string;
  isNpc: boolean;
  connected: boolean;
  coins: number;
  isHost: boolean;
  /** 지금 단계(출마표 확인·배팅)에서 준비 완료를 눌렀는지. NPC는 항상 true */
  ready?: boolean;
}

export interface RoomSettings {
  roomName: string;
  isPrivate: boolean;
  maxPlayers: number;
  totalRounds: number;
  /** 블라인드 배팅: 라운드 결과 발표 전까지 각자 자기 배팅만 볼 수 있다 */
  blindBets?: boolean;
}

/** 플레이어별 배팅 건수 — 블라인드 모드에서 내용 대신 공개하는 정보 */
export interface BetCount {
  playerId: string;
  count: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  players: number;
  maxPlayers: number;
  totalRounds: number;
  state: RoomPhase;
}

export type RoomPhase =
  | 'lobby'
  | 'preview'     // 말 능력치 확인
  | 'betting'     // 배팅
  | 'reveal'      // 배팅 공개
  | 'countdown'   // 경주 시작 카운트다운
  | 'racing'      // 경주 중
  | 'roundResult' // 라운드 결과
  | 'gameResult'; // 최종 결과

export interface Standing {
  playerId: string;
  name: string;
  isNpc: boolean;
  coins: number;
  rank: number;
  hits: number;
  netProfit: number;
}

export interface PlayerRoundResult {
  playerId: string;
  playerName: string;
  bets: BetOutcome[];
  net: number;
  coins: number;
}

export interface Award {
  title: string;
  playerName: string;
  detail: string;
}

export interface RankingEntry {
  horseId: number;
  rank: number;
  timeMs: number;
}

// ---------------- 재접속/참가 스냅샷 ----------------

export interface RoomSnapshot {
  roomId: string;
  code?: string;
  settings: RoomSettings;
  players: PlayerPublic[];
  phase: RoomPhase;
  round: number;
  phaseEndsAt?: number;
  horses?: HorseInfo[];
  odds?: OddsTable;
  coins: number;
  myBets: Bet[];
  revealedBets?: RevealedBet[];
  betCounts?: BetCount[];
  race?: { startedAt: number; horses: HorseSnapshot[] };
  augment?: { phase: number; tier: AugmentTier; endsAt: number; cards: AugmentCardView[]; used: boolean; preview?: boolean; queuedKey?: string };
  rankings?: RankingEntry[];
  roundResult?: { round: number; results: PlayerRoundResult[]; standings: Standing[]; isFinal: boolean; ownerPrize?: OwnerPrize };
  gameResult?: { standings: Standing[]; awards: Award[]; ownerBonus?: OwnerBonus };
}

// ---------------- 메시지: 클라이언트 → 서버 ----------------

export type C2S =
  | { type: 'CREATE_ROOM'; playerName: string; roomName: string; isPrivate: boolean; maxPlayers: number; totalRounds: number; npcCount: number; blindBets?: boolean; /** 싱글 모드: 방을 만들자마자 게임을 시작한다 */ autoStart?: boolean; /** 싱글 모드: 6마리 중 하나로 출전시킬 내 말 */ myHorse?: MyHorseEntry }
  | { type: 'JOIN_ROOM'; playerName: string; roomId?: string; code?: string }
  | { type: 'LIST_ROOMS' }
  | { type: 'LEAVE_ROOM' }
  | { type: 'ADD_NPC' }
  | { type: 'REMOVE_NPC' }
  | { type: 'START_GAME' }
  | { type: 'READY'; phase: 'preview' | 'betting'; /** false면 준비 완료를 취소한다 (기본 true) */ ready?: boolean }
  | { type: 'PLACE_BET'; betType: BetType; horseId: number; amount: number }
  | { type: 'CANCEL_BET'; betId: string }
  | { type: 'SELECT_AUGMENT'; cardKey: string; targetHorseId?: number }
  | { type: 'NEXT_ROUND' }
  | { type: 'RESTART' }
  | { type: 'EMOTE'; emoji: string }
  | { type: 'RECONNECT'; playerId: string; secret: string; roomId: string };

// ---------------- 메시지: 서버 → 클라이언트 ----------------

export type S2C =
  | { type: 'WELCOME'; playerId: string; secret: string }
  | { type: 'ROOM_LIST'; rooms: RoomSummary[] }
  | { type: 'ROOM_JOINED'; snapshot: RoomSnapshot; you: string }
  | { type: 'ROOM_UPDATE'; players: PlayerPublic[]; settings: RoomSettings }
  | { type: 'ERROR'; message: string }
  | { type: 'GAME_START'; totalRounds: number; startCoins: number }
  | { type: 'ROUND_START'; round: number; totalRounds: number; horses: HorseInfo[]; odds: OddsTable; phaseEndsAt: number; coins: number; topUps: { playerId: string; playerName: string; amount: number }[] }
  | { type: 'BETTING_START'; endsAt: number }
  | { type: 'BET_ACCEPTED'; bet: Bet; coins: number }
  | { type: 'BET_CANCELED'; betId: string; coins: number }
  | { type: 'BET_REVEAL'; bets: RevealedBet[]; betCounts: BetCount[]; blind: boolean; endsAt: number }
  | { type: 'COUNTDOWN'; endsAt: number }
  | { type: 'RACE_START'; startedAt: number }
  | { type: 'RACE_STATE'; t: number; horses: HorseSnapshot[] }
  | { type: 'AUGMENT_PHASE'; phase: number; tier: AugmentTier; endsAt: number; cards: AugmentCardView[]; /** 미리 고르기 단계: 고른 카드는 증강 지점에서 발동한다 */ preview?: boolean }
  | { type: 'AUGMENT_LIVE'; phase: number; endsAt: number }
  | { type: 'AUGMENT_CLOSED'; phase: number }
  | { type: 'AUGMENT_USED'; playerName: string; defId: string; targets: number[]; blocked: number[] }
  | { type: 'AUGMENT_RESULT'; ok: boolean; message?: string; cardKey?: string; /** 미리 고르기로 예약만 된 상태 */ queued?: boolean }
  | { type: 'RACE_FINISH'; rankings: RankingEntry[] }
  | { type: 'ROUND_RESULT'; round: number; results: PlayerRoundResult[]; standings: Standing[]; isFinal: boolean; ownerPrize?: OwnerPrize }
  | { type: 'GAME_RESULT'; standings: Standing[]; awards: Award[]; ownerBonus?: OwnerBonus }
  | { type: 'EMOTE'; playerName: string; emoji: string }
  | { type: 'LOBBY_RETURN' }
  | { type: 'ROOM_CLOSED'; reason: string };

import type {
  AugmentCardView,
  AugmentTier,
  BetCount,
  Bet,
  BetType,
  AugmentDefinition,
  HorseInfo,
  HorseSnapshot,
  TargetType,
  OddsTable,
  PlayerPublic,
  PlayerRoundResult,
  RankingEntry,
  RevealedBet,
  RoomPhase,
  RoomSettings,
  RoomSnapshot,
  S2C,
  Standing,
  Award,
  OwnerBonus,
  OwnerPrize
} from '../../shared/src/types';
import {
  BET_LIMIT_RATIO,
  BET_MIN,
  BET_TYPE_INFO,
  TIER_INFO,
  TIER_OF_RARITY,
  ROUND_COINS,
  AUGMENT_PHASES,
  PLAYER_COLORS
} from '../../shared/src/constants';
import { AUGMENT_BY_ID, AUGMENTS, TARGET_TYPE_LABELS } from '../../shared/src/augments';
import { BREED_INFO, EMOTES, conditionNote } from '../../shared/src/names';
import { Net, loadToken, saveToken } from './net';
import { Race3DView, type CameraTarget } from './race3d';
import { claimGameBonus, claimRoundPrize, myHorseEntry, stable } from './stable';
import { closeStable, horseSummary, initStableUi, openStable } from './stableUi';
import { bib, icon, inkOn, mountIcons, rankBadge } from './icons';
import { startTitleBg, stopTitleBg } from './titleBg';
import { cardSfx, warmCardSfx, initAudio, onSoundPrefsChange, setMusic, sfx, soundPrefs, toggleMusic, toggleSfx } from './audio';

// ============ 전역 상태 ============

const state = {
  myId: '',
  secret: '',
  roomId: null as string | null,
  players: [] as PlayerPublic[],
  settings: null as RoomSettings | null,
  phase: 'lobby' as RoomPhase,
  round: 0,
  totalRounds: 0,
  horses: [] as HorseInfo[],
  odds: {} as OddsTable,
  coins: 0,
  bettingBaseCoins: 0,
  myBets: [] as Bet[],
  revealed: [] as RevealedBet[],
  /** 플레이어별 배팅 건수 (블라인드 방에서 내용 대신 보여 준다) */
  betCounts: [] as BetCount[],
  phaseEndsAt: 0,
  selBetType: 'winner' as BetType,
  selHorse: null as number | null,
  readySent: false,
  augment: null as {
    phase: number;
    tier: AugmentTier;
    endsAt: number;
    cards: AugmentCardView[];
    used: boolean;
    selectedKey: string | null;
    pending: boolean;
    /** 미리 고르기 단계인지, 예약해 둔 카드가 무엇인지 */
    preview: boolean;
    queuedKey: string | null;
    /** 예약한 카드에 고른 말 (말을 고르는 카드일 때). sentTarget은 서버 답을 기다리는 동안의 값 */
    queuedTarget?: number | null;
    sentTarget?: number | null;
    /** 이미 새로고침한 카드 자리 */
    rerolled: string[];
  } | null,
  rankings: null as RankingEntry[] | null,
  cameraSel: 'leader' as CameraTarget,
  waitingReconnect: false,
  lastWelcome: null as { playerId: string; secret: string } | null
};

const net = new Net();

// ============ DOM 헬퍼 ============

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

function show(id: string): void {
  $(id).classList.remove('hidden');
}
function hide(id: string): void {
  $(id).classList.add('hidden');
}

const SCREENS = ['scr-main', 'scr-create', 'scr-solo', 'scr-stable', 'scr-join', 'scr-lobby', 'scr-game'];
function showScreen(id: string): void {
  for (const s of SCREENS) {
    if (s === id) show(s);
    else hide(s);
  }
  document.body.dataset.screen = id;
  if (id === 'scr-main') startTitleBg();
  else stopTitleBg();
  if (id !== 'scr-stable') closeStable();
  refreshStableBadges();
  // 모바일 세로 화면에서는 게임 중에만 가로 모드 안내를 띄운다
  syncMusic();
}

/** 지금 화면과 진행 단계에 맞는 배경음악을 고른다 */
function syncMusic(): void {
  if (document.body.dataset.screen !== 'scr-game') return setMusic('menu');
  switch (state.phase) {
    case 'preview':
    case 'betting':
    case 'reveal':
    case 'roundResult':
      return setMusic('paddock');
    case 'racing':
      // 결승선을 넘으면 음악을 멈추고 결과 징글에 자리를 내준다
      return setMusic(state.rankings ? null : 'race');
    case 'gameResult':
      return setMusic('menu');
    default:
      // 카운트다운은 똑딱 소리만 들리게 비워 둔다
      return setMusic(null);
  }
}

function toast(message: string, isError = true): void {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  if (isError) sfx('error');
  $('toast-area').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function esc(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ============ 참가자 색 표식 ============
// 사람마다 색과 한 글자를 정해 두고 배팅, 증강 안내, 기록에 같은 표식을 쓴다.
// 흰 글자가 읽히는 진한 색만 쓴다 (말 번호 안장은 네모, 사람 표식은 동그라미)
// 색은 서버가 방 안에서 겹치지 않게 나눠 주고, 대기 로비에서 각자 바꿀 수 있다
const playerSlot = new Map<string, number>();
const COLOR_KEY = 'augment-derby-color';
/** 이번 방에서 내가 좋아하는 색을 이미 요청했는지 */
let colorWished = false;

function playerColor(id: string): string {
  const known = state.players.find((p) => p.id === id);
  if (known) return PLAYER_COLORS[known.color % PLAYER_COLORS.length];
  let slot = playerSlot.get(id);
  if (slot === undefined) {
    // 방에 들어온 순서대로 빈 색을 준다. 한 번 받은 색은 방을 나갈 때까지 그대로다
    const taken = new Set(playerSlot.values());
    slot = 0;
    while (taken.has(slot)) slot++;
    playerSlot.set(id, slot);
  }
  return PLAYER_COLORS[slot % PLAYER_COLORS.length];
}

function playerMark(id: string, name: string): string {
  const letter = [...name.trim()][0] ?? '?';
  return `<span class="pmark" style="background:${playerColor(id)}" title="${esc(name)}">${esc(letter)}</span>`;
}

/** 표식 + 이름 */
function playerChip(id: string, name: string): string {
  return `<span class="pchip">${playerMark(id, name)}<span class="pchip-name">${esc(name)}</span></span>`;
}

const BET_SHORT: Record<BetType, string> = { winner: '우승', last: '꼴찌', top3: '1~3', bottom3: '4~6' };

/** 지금 순위대로 끝나면 맞는 배팅인지 */
function betHits(type: BetType, rank: number, total: number): boolean {
  if (type === 'winner') return rank === 1;
  if (type === 'last') return rank === total;
  if (type === 'top3') return rank <= 3;
  return rank > total - 3;
}

/** 경주 중 내가 볼 수 있는 배팅 — 블라인드 방에서는 내 것만 */
function visibleBets(): RevealedBet[] {
  return betsHidden() ? state.revealed.filter((b) => b.playerId === state.myId) : state.revealed;
}

/** 방해 카드는 빨강 '방해', 돕는 카드는 초록 '도움' 딱지 */
function kindChip(hostile: boolean): string {
  return `<span class="aug-kind ${hostile ? 'bad' : 'good'}">${hostile ? '방해' : '도움'}</span>`;
}

/** 카드 설명은 '소개\n효과' 두 줄이다. 효과 줄은 카드 색(방해 빨강, 도움 초록)으로 크게 보여 준다 */
function effectHtml(description: string): string {
  const [flavor, effect] = description.split('\n');
  if (!effect) return `<span class="fx">${esc(flavor)}</span>`;
  // 효과와 지속 시간은 쉼표 자리에서만 줄이 바뀌게 묶는다
  const parts = effect.split(', ').map((x) => `<span class="fx-part">${esc(x)}</span>`).join(', ');
  return `<span class="fl">${esc(flavor)}</span><span class="fx">${parts}</span>`;
}

/** 카드 안의 효과: 수치를 가장 크게, 지속 시간 같은 나머지는 작은 딱지로, 소개 문구는 맨 아래 작게 */
function cardEffectHtml(description: string): string {
  const [flavor, effect] = description.split('\n');
  if (!effect) return `<div class="aug-fx"><span class="aug-fx-main">${esc(flavor)}</span></div>`;
  const [main, ...rest] = effect.split(', ');
  return `<div class="aug-fx"><span class="aug-fx-main">${esc(main)}</span>${rest.map((x) => `<span class="aug-fx-chip">${esc(x)}</span>`).join('')}</div>
    <div class="aug-flav">${esc(flavor)}</div>`;
}

/** 서버가 마지막으로 보낸 말들의 상태. 카드의 "지금 대상"을 계산할 때 쓴다 */
let lastSnaps: HorseSnapshot[] = [];

/** 순위나 지구력처럼 경주 중에 계속 바뀌는 기준으로 대상을 정하는 카드 */
const LIVE_TARGETS = new Set<TargetType>([
  'front3', 'back3', 'rank1', 'rank2', 'rank6', 'rank23', 'rank34', 'mostStamina2', 'leastStamina2', 'swap16'
]);

/**
 * 카드를 지금 쓰면 맞는 말들 (서버의 대상 해석과 같은 규칙).
 * 직접 고르는 카드이거나 알 수 없으면 null.
 */
function targetsNow(def: AugmentDefinition): number[] | null {
  if (def.targetType === 'single' || lastSnaps.length === 0) return null;
  const live = lastSnaps.filter((h) => !h.finished);
  const alive = (ids: number[]) => ids.filter((id) => live.some((h) => h.id === id));
  const ranking = [...lastSnaps].sort((a, b) => a.rank - b.rank).map((h) => h.id);
  const info = (id: number) => state.horses.find((h) => h.id === id);
  const top = (key: (h: HorseSnapshot) => number, desc: boolean, n: number) =>
    [...live]
      .sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)) || a.id - b.id)
      .slice(0, n)
      .map((h) => h.id);
  const byBet = (types: BetType[] | null, most: boolean): number[] | null => {
    if (betsHidden() || live.length === 0) return null; // 블라인드 방에서는 남의 배팅을 모른다
    const sum = (id: number) =>
      visibleBets().filter((b) => b.horseId === id && (!types || types.includes(b.type))).reduce((t, b) => t + b.amount, 0);
    return [[...live].sort((a, b) => (most ? sum(b.id) - sum(a.id) : sum(a.id) - sum(b.id)) || a.id - b.id)[0].id];
  };
  switch (def.targetType) {
    case 'odd': return alive([1, 3, 5]);
    case 'even': return alive([2, 4, 6]);
    case 'front3': return alive(ranking.slice(0, 3));
    case 'back3': return alive(ranking.slice(3, 6));
    case 'rank1': return alive(ranking.slice(0, 1));
    case 'rank2': return alive(ranking.slice(1, 2));
    case 'rank6': return alive(ranking.slice(5, 6));
    case 'rank23': return alive(ranking.slice(1, 3));
    case 'rank34': return alive(ranking.slice(2, 4));
    case 'fastest2': return top((h) => info(h.id)?.stats.speed ?? 0, true, 2);
    case 'slowest2': return top((h) => info(h.id)?.stats.speed ?? 0, false, 2);
    case 'heaviest2': return top((h) => info(h.id)?.stats.weight ?? 0, true, 2);
    case 'mostStamina2': return top((h) => h.stamina, true, 2);
    case 'leastStamina2': return top((h) => h.stamina, false, 2);
    case 'mostBetWin': return byBet(['winner'], true);
    case 'leastBetWin': return byBet(['winner'], false);
    case 'mostBetTotal': return byBet(null, true);
    case 'swap16': {
      const r = alive(ranking);
      return r.length < 2 ? [] : [r[0], r[r.length - 1]];
    }
    default: return null;
  }
}

/** 카드의 "지금 대상" 표시: 실제 말 번호. 내가 건 말은 노란 테두리 */
function targetNowHtml(def: AugmentDefinition): string {
  const ids = targetsNow(def);
  if (!ids) return '';
  if (ids.length === 0) return '<span class="aug-tgt-none">지금은 해당하는 말이 없음</span>';
  const bibs = ids
    .map((id) => {
      const h = state.horses.find((x) => x.id === id);
      if (!h) return '';
      const mine = state.myBets.some((b) => b.horseId === id);
      return `<span class="aug-tgt-horse${mine ? ' mybet' : ''}" title="${esc(h.name)}${mine ? ' (내가 건 말)' : ''}">${bib(h.id, h.color, 'sm')}</span>`;
    })
    .join('');
  // 순위처럼 계속 바뀌는 기준이면 "지금"임을 밝힌다. 실제 대상은 발동하는 순간에 정해진다
  return `${LIVE_TARGETS.has(def.targetType) ? '<span class="aug-tgt-live">지금</span>' : ''}${bibs}`;
}

/** 예약한 카드에 고른 말 */
function queuedTargetHtml(): string {
  const h = state.horses.find((x) => x.id === state.augment?.queuedTarget);
  if (!h) return '';
  const mine = state.myBets.some((b) => b.horseId === h.id);
  return `<span class="aug-tgt-live">고른 말</span><span class="aug-tgt-horse${mine ? ' mybet' : ''}" title="${esc(h.name)}">${bib(h.id, h.color, 'sm')}</span>`;
}

/** 경주 화면의 말 이름표에 내가 건 배팅을 표시한다 */
function syncBetMarks(): void {
  const marks: Record<number, string> = {};
  for (const b of state.myBets) {
    marks[b.horseId] = marks[b.horseId] ? `${marks[b.horseId]}, ${BET_SHORT[b.type]}` : BET_SHORT[b.type];
  }
  view?.setBetMarks(marks);
}

/** 마우스를 올린 카드(또는 말 고르기 단추). 없으면 눌러서 고른 카드를 기준으로 삼는다 */
let hoverCardKey: string | null = null;
let hoverPick: number | null = null;

/** 올려 둔 카드가 맞힐 말을 경주 화면과 등수표에서 띄워 보인다. 순위가 바뀌면 따라 바뀐다 */
function applyAugmentHighlight(): void {
  const aug = state.augment;
  let ids: number[] = [];
  let good = true;
  if (aug && !aug.used && !augFolded) {
    const key = hoverCardKey ?? aug.selectedKey;
    const card = aug.cards.find((c) => c.cardKey === key);
    const def = card ? AUGMENT_BY_ID[card.defId] : undefined;
    if (def) {
      good = !def.hostile;
      if (def.targetType !== 'single') ids = targetsNow(def) ?? [];
      else if (hoverPick != null && hoverCardKey === key) ids = [hoverPick];
      else if (aug.queuedKey === key && aug.queuedTarget != null) ids = [aug.queuedTarget];
    }
  }
  view?.setHighlight(ids, good);
  const board = $('rank-board');
  board.dataset.hl = ids.join(',');
  board.dataset.hlKind = good ? 'good' : 'bad';
  board.querySelectorAll<HTMLElement>('.rb-row').forEach((row) => {
    row.classList.toggle('hl', ids.includes(Number(row.dataset.h)));
  });
}

/** 순위가 바뀌면 열려 있는 카드의 "지금 대상"만 고쳐 쓴다 (바뀐 칸만) */
function refreshAugmentTargets(): void {
  const aug = state.augment;
  if (!aug || aug.used || augFolded) return;
  document.querySelectorAll<HTMLElement>('#augment-bar [data-tgt]').forEach((el) => {
    const card = aug.cards.find((c) => c.cardKey === el.dataset.tgt);
    const def = card ? AUGMENT_BY_ID[card.defId] : undefined;
    if (!def || def.targetType === 'single') return;
    const html = targetNowHtml(def);
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
  });
  applyAugmentHighlight();
}

function addLog(html: string, cls = ''): void {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  el.innerHTML = html;
  $('game-log').prepend(el);
  while ($('game-log').children.length > 60) $('game-log').lastChild?.remove();
}

/** 메인·혼자 하기 화면의 당근과 내 말 요약을 최신 값으로 맞춘다 */
function refreshStableBadges(): void {
  $('main-carrots').innerHTML = `${icon('carrot')}${stable().carrots}`;
  $('solo-horse-summary').innerHTML = `${icon('star')}${esc(horseSummary())}`;
}

function isMyHorse(h: HorseInfo | undefined): boolean {
  return !!h && !!h.ownerId && h.ownerId === state.myId;
}

function horseName(id: number): string {
  const h = state.horses.find((x) => x.id === id);
  return h ? `${id}번 ${h.name}${isMyHorse(h) ? '(내 말)' : ''}` : `${id}번`;
}

/** 번호 안장 + 이름 (HTML) — 말을 가리키는 곳은 모두 이 모양으로 쓴다 */
function horseChip(id: number, showMine = true): string {
  const h = state.horses.find((x) => x.id === id);
  if (!h) return `${id}번`;
  const mine = showMine && isMyHorse(h) ? `<span class="tag mine">${icon('star')}내 말</span>` : '';
  return `<span class="horse-chip">${bib(id, h.color, 'sm')}<span>${esc(h.name)}</span>${mine}</span>`;
}

function coinHtml(amount: number | string): string {
  return `<span class="coin">${icon('coin')}${amount}</span>`;
}

const NPC_TAG = `<span class="tag npc">${icon('robot')}NPC</span>`;

function horseColor(id: number): string {
  return state.horses.find((x) => x.id === id)?.color ?? '#888';
}

function isHost(): boolean {
  return state.players.find((p) => p.id === state.myId)?.isHost ?? false;
}

function playerName(): string {
  const input = $<HTMLInputElement>('main-name');
  let name = input.value.trim();
  if (!name) {
    name = `기수${Math.floor(Math.random() * 900 + 100)}`;
    input.value = name;
  }
  localStorage.setItem('augment-derby-name', name);
  return name;
}

// ============ 경주 화면 (3D) ============

let view: Race3DView | null = null;
let viewFailed = false;

function ensureGame(): void {
  if (view || viewFailed) return;
  try {
    view = new Race3DView($('race-canvas'));
    // 개발 중 성능을 잴 때만 쓰는 손잡이 (배포판에는 들어가지 않는다)
    if (import.meta.env.DEV) (window as unknown as { __race3d?: Race3DView }).__race3d = view;
  } catch (err) {
    // WebGL을 쓸 수 없는 기기 — 경주 화면 없이 배팅·결과만 진행된다
    viewFailed = true;
    console.error('3D 초기화 실패', err);
    $('race-canvas').innerHTML =
      '<p class="r3d-unsupported">이 기기나 브라우저에서는 3D 화면이 나오지 않아 경주를 보여 드릴 수 없습니다.</p>';
  }
}

// ============ 카메라(관전 대상) 선택 ============

function renderCameraSelect(): void {
  const el = $('camera-select');
  if (state.horses.length === 0) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML =
    `<span class="cam-label" title="따라갈 말">${icon('camera')}</span>` +
    `<button class="cam-leader${state.cameraSel === 'leader' ? ' active' : ''}" data-cam="leader" title="선두 따라가기" aria-label="선두 따라가기">${icon('crown')}</button>` +
    state.horses
      .map((h) => {
        const cls = [
          state.cameraSel === h.id ? 'active' : '',
          isMyHorse(h) ? 'mine' : '',
          inkOn(h.color) ? 'dk' : ''
        ]
          .filter(Boolean)
          .join(' ');
        return `<button style="background:${h.color}" class="${cls}" data-cam="${h.id}" title="${esc(h.name)}${isMyHorse(h) ? ' (내 말)' : ''}">${h.id}</button>`;
      })
      .join('') +
    `<button class="cam-mode" data-act="mode" title="카메라 시점 바꾸기">${view?.viewModeLabel() ?? '중계'} 시점</button>`;
  el.querySelectorAll<HTMLElement>('button').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.act === 'mode') {
        view?.cycleViewMode();
      } else {
        const v = b.dataset.cam!;
        state.cameraSel = v === 'leader' ? 'leader' : Number(v);
        view?.setCameraTarget(state.cameraSel);
      }
      renderCameraSelect();
    };
  });
}

// ============ 로비 / 방 ============

function renderLobby(): void {
  if (!state.settings) return;
  $('lobby-title').textContent = state.settings.roomName;
  const codeEl = $('lobby-code');
  if (state.roomId) {
    codeEl.innerHTML = `초대 코드 <b class="code">${esc(state.roomId)}</b> <span class="muted">친구에게 이 코드를 알려 주세요</span>`;
    codeEl.classList.remove('hidden');
  }
  $('lobby-settings').innerHTML = `
    <span class="chip">최대 ${state.settings.maxPlayers}명</span>
    <span class="chip">${state.settings.totalRounds}라운드</span>
    <span class="chip">시작 코인 ${ROUND_COINS[state.settings.totalRounds].toLocaleString('ko-KR')}</span>
    ${state.settings.blindBets ? `<span class="chip">${icon('blind')}블라인드 배팅</span>` : ''}`;
  $('lobby-players').innerHTML = state.players
    .map(
      (p) => `
    <div class="lobby-player${p.isHost ? ' host' : ''}">
      <span class="dot${p.connected || p.isNpc ? '' : ' off'}"></span>
      ${playerChip(p.id, p.name + (p.id === state.myId ? ' (나)' : ''))}
      ${p.isHost ? icon('crown') : ''}${p.isNpc ? NPC_TAG : ''}
    </div>`
    )
    .join('');
  // 내 색 고르기: 다른 사람이 쓰는 색은 고를 수 없다
  const me = state.players.find((p) => p.id === state.myId);
  $('lobby-colors').innerHTML = PLAYER_COLORS.map((c, i) => {
    const holder = state.players.find((p) => p.color === i && p.id !== state.myId && !p.isNpc);
    const mine = me?.color === i;
    return `<button type="button" class="swatch${mine ? ' active' : ''}" role="radio" aria-checked="${mine}" style="background:${c}" data-color="${i}" ${holder ? 'disabled' : ''} aria-label="${i + 1}번 색${holder ? `, ${esc(holder.name)} 사용 중` : ''}" title="${holder ? esc(holder.name) + ' 사용 중' : '이 색으로 바꾸기'}">${mine ? esc([...(me?.name ?? '').trim()][0] ?? '') : ''}</button>`;
  }).join('');
  $('lobby-colors').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = () => {
      localStorage.setItem(COLOR_KEY, b.dataset.color!);
      net.send({ type: 'SET_COLOR', color: Number(b.dataset.color) });
    };
  });
  const host = isHost();
  $('btn-lobby-start').classList.toggle('hidden', !host);
  $('lobby-npc-controls').classList.toggle('hidden', !host);
  $('lobby-wait-msg').classList.toggle('hidden', host);
}

function renderSidebar(): void {
  $('side-players').innerHTML = state.players
    .map((p) => {
      const off = !p.connected && !p.isNpc;
      return `<div class="side-player${p.id === state.myId ? ' me' : ''}">
        <span class="${off ? 'off' : ''}">${playerChip(p.id, p.name)}${off ? ' (연결 끊김)' : ''} ${p.isHost ? icon('crown') : ''}</span>
        <b>${icon('coin')}${p.coins}</b>
      </div>`;
    })
    .join('');
}

/** 블라인드 방이고 아직 라운드 결과 전이면 남의 배팅은 볼 수 없다 */
function betsHidden(): boolean {
  return !!state.settings?.blindBets && state.phase !== 'roundResult' && state.phase !== 'gameResult';
}

function renderSideBets(): void {
  $('side-bets').innerHTML =
    state.revealed.length === 0 && !betsHidden()
      ? '<p class="muted">배팅이 끝나면 여기에 나옵니다.</p>'
      : `${betsHidden() ? '<p class="muted">블라인드 방입니다. 내 배팅만 보이고, 나머지는 라운드 결과에서 공개됩니다.</p>' : ''}
        <div class="reveal-list">${revealListHtml()}</div>`;
}

// ============ 배팅 화면 ============

function renderBettingOverlay(): void {
  const isBetting = state.phase === 'betting';
  $('betting-title').textContent = isBetting
    ? `${state.round}라운드 배팅`
    : `${state.round}라운드 출마표`;

  renderHorseCards();
  renderBetTabs();
  renderMyBets();

  // 출마표를 보는 동안에는 배팅 칸을 아예 숨겨 화면을 단순하게 둔다
  $('bet-controls').classList.toggle('hidden', !isBetting);

  const btn = $<HTMLButtonElement>('btn-ready');
  // 준비 완료는 다시 누르면 취소된다
  btn.classList.toggle('waiting', state.readySent);
  btn.textContent = state.readySent
    ? '준비 취소 (다른 사람을 기다리는 중)'
    : isBetting
      ? '준비 완료'
      : '출마표 확인 완료';
  renderReadyCount();
  show('overlay-betting');
}

/** 준비 완료를 누른 사람 수 — 모두 누르면 서버가 바로 다음 단계로 넘긴다 */
function renderReadyCount(): void {
  const humans = state.players.filter((p) => !p.isNpc && p.connected);
  const ready = humans.filter((p) => p.ready).length;
  const next = state.phase === 'betting' ? '경주를 시작합니다' : '배팅으로 넘어갑니다';
  $('ready-count').textContent =
    humans.length > 1 ? `준비 완료 ${ready}/${humans.length}명. 모두 누르면 바로 ${next}.` : `누르면 바로 ${next}.`;
}

/** 능력치는 내부 값(1~100)을 10점 만점으로 줄여 보여 준다 */
/** 경주 화면 왼쪽 위의 현재 등수표. 순서가 바뀔 때만 다시 그린다 */
let rankBoardKey = '';
function renderRankBoard(snaps: { id: number; rank: number; finished: boolean }[] | null): void {
  const el = $('rank-board');
  if (!snaps || snaps.length === 0) {
    el.classList.add('hidden');
    rankBoardKey = '';
    return;
  }
  const order = [...snaps].sort((a, b) => a.rank - b.rank);
  const bets = visibleBets();
  const key =
    order.map((s) => `${s.id}${s.finished ? 'f' : ''}`).join(',') +
    '|' +
    bets.map((b) => b.betId + playerColor(b.playerId)).join(',') +
    '|' +
    state.myBets.map((b) => b.horseId).join(',');
  el.classList.remove('hidden');
  if (key === rankBoardKey) return;
  rankBoardKey = key;
  el.innerHTML = order
    .map((s) => {
      const h = state.horses.find((x) => x.id === s.id);
      if (!h) return '';
      // 이 말에 누가 무엇을 걸었는지: 사람 표식 + 배팅 종류. 지금 순위로 맞고 있으면 밝게, 아니면 흐리게
      const betHtml = bets
        .filter((b) => b.horseId === s.id)
        .map(
          (b) =>
            `<span class="rb-bet${betHits(b.type, s.rank, order.length) ? ' hit' : ''}${b.playerId === state.myId ? ' me' : ''}" style="--pc:${playerColor(b.playerId)}" title="${esc(b.playerName)} ${BET_TYPE_INFO[b.type].label} ${b.amount}코인">${BET_SHORT[b.type]}</span>`
        )
        .join('');
      // 노란 줄은 내가 건 말
      const myBet = state.myBets.some((b) => b.horseId === s.id);
      return `<div class="rb-row${myBet ? ' mine' : ''}${s.finished ? ' done' : ''}${(el.dataset.hl ?? '').split(',').includes(String(s.id)) ? ' hl' : ''}" data-h="${s.id}">
        <span class="rb-rank">${s.rank}</span>${bib(h.id, h.color, 'sm')}<span class="rb-name">${esc(h.name)}</span>
        ${betHtml ? `<span class="rb-bets">${betHtml}</span>` : ''}
      </div>`;
    })
    .join('');
}

function statBar(label: string, value: number, color: string): string {
  const shown = Math.max(1, Math.round(value / 10));
  return `<div class="statbar">
    <span class="sb-label">${label}</span>
    <span class="sb-track"><span class="sb-fill" style="width:${shown * 10}%;background:${color}"></span></span>
    <span class="sb-val">${shown}</span>
  </div>`;
}

/** 컨디션 수치(1~100)를 화면에 보이는 1~10으로 */
function conditionShown(luck: number): number {
  return Math.max(1, Math.min(10, Math.round(luck / 10)));
}

/** 컨디션 사유 한 줄 */
function condHtml(h: HorseInfo): string {
  const c = conditionShown(h.stats.luck);
  return `<div class="hc-cond ${c >= 7 ? 'good' : c <= 4 ? 'bad' : ''}">${esc(conditionNote(h))}</div>`;
}

/** 출마표를 볼 때는 카드, 배팅할 때는 한 줄씩(오른쪽에 마권을 크게 두기 위해) */
function renderHorseCards(): void {
  const rows = state.phase === 'betting';
  $('horse-cards').classList.toggle('as-rows', rows);
  // 배팅할 때는 배당 열 바로 위에 전체 배당표를 여는 단추를 둔다
  const oddsBtn = rows ? '<div class="hr-top"><button id="btn-odds-all" class="btn small alt">전체 배당 보기</button></div>' : '';
  $('horse-cards').innerHTML = oddsBtn + state.horses
    .map((h) => {
      const odds = state.odds[h.id];
      const mine = isMyHorse(h);
      const sel = state.selHorse === h.id;
      const oddsText = `×${odds ? odds[state.selBetType].toFixed(2) : '-'}`;
      if (rows) {
        return `<div class="horse-row${sel ? ' selected' : ''}${mine ? ' mine' : ''}" data-horse="${h.id}" role="button" tabindex="0" aria-pressed="${sel}">
          ${bib(h.id, h.color, 'lg')}
          <div class="hr-name"><span class="hc-name">${esc(h.name)}</span>${mine ? `<span class="tag mine">${icon('star')}내 말</span>` : ''}
            <span class="hr-sub">${h.stats.weight}kg, 컨디션 ${conditionShown(h.stats.luck)}</span></div>
          <div class="hr-stats">
            ${statBar('속력', h.stats.speed, '#d92b22')}
            ${statBar('가속', h.stats.accel, '#2447d6')}
            ${statBar('지구력', h.stats.stamina, '#0f7a50')}
          </div>
          ${condHtml(h)}
          <div class="hr-odds"><span>${BET_TYPE_INFO[state.selBetType].label} 배당</span><b>${oddsText}</b></div>
        </div>`;
      }
      return `<div class="horse-card${sel ? ' selected' : ''}${mine ? ' mine' : ''}" data-horse="${h.id}">
        <div class="hc-head">
          ${bib(h.id, h.color, 'lg')}
          <span class="hc-name">${esc(h.name)}</span>
          ${mine ? `<span class="tag mine">${icon('star')}내 말</span>` : ''}
        </div>
        ${statBar('속력', h.stats.speed, '#d92b22')}
        ${statBar('가속', h.stats.accel, '#2447d6')}
        ${statBar('지구력', h.stats.stamina, '#0f7a50')}
        <div class="hc-extra">몸무게 ${h.stats.weight}kg, 컨디션 ${conditionShown(h.stats.luck)}</div>
        ${condHtml(h)}
        <div class="hc-odds">
          <span>${BET_TYPE_INFO[state.selBetType].label} 배당</span>
          <b>${oddsText}</b>
        </div>
      </div>`;
    })
    .join('');
  const oddsAll = document.getElementById('btn-odds-all');
  if (oddsAll) {
    oddsAll.onclick = () => {
      renderOddsTable();
      show('modal-odds');
    };
  }
  document.querySelectorAll<HTMLElement>('#horse-cards [data-horse]').forEach((el) => {
    const pick = (byKey: boolean) => {
      state.selHorse = Number(el.dataset.horse);
      renderHorseCards();
      renderBetTabs();
      // 다시 그리면 초점이 사라지므로 자판으로 골랐을 때는 같은 줄에 돌려 둔다
      if (byKey) document.querySelector<HTMLElement>(`#horse-cards [data-horse="${state.selHorse}"]`)?.focus();
      // 한 단 화면(폰 세로)에서는 마권이 목록 아래에 있어서, 말을 고르면 마권으로 내려 준다
      else if (rows && window.matchMedia('(max-width: 759px)').matches) {
        const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.querySelector('#bet-controls .ticket')?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      }
    };
    el.onclick = () => pick(false);
    el.onkeydown = (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      pick(true);
    };
  });
}

/** 마권: 고른 말, 종류 네 칸(그 말의 배당), 금액, 받을 코인 */
function renderBetTabs(): void {
  const horse = state.horses.find((h) => h.id === state.selHorse);
  $('ticket-head').innerHTML = horse
    ? `${bib(horse.id, horse.color, 'lg')}<div class="t-who"><b>${esc(horse.name)}</b><span>${esc(conditionNote(horse))}</span></div>`
    : `<div class="t-who"><b>말을 고르세요</b><span>목록에서 말을 누르면 배당이 나옵니다.</span></div>`;
  $('bet-type-tabs').innerHTML = (Object.keys(BET_TYPE_INFO) as BetType[])
    .map((t) => {
      const o = horse ? state.odds[horse.id]?.[t] : undefined;
      return `<button class="t-type${state.selBetType === t ? ' active' : ''}" data-type="${t}" aria-pressed="${state.selBetType === t}">
        <span class="tt-label"><b>${BET_TYPE_INFO[t].label}</b><small>${BET_TYPE_INFO[t].desc.replace('고른 말이 ', '')}</small></span>
        <span class="tt-odds${o ? '' : ' blank'}">${o ? `×${o.toFixed(2)}` : '×0.00'}</span>
      </button>`;
    })
    .join('');
  document.querySelectorAll<HTMLElement>('#bet-type-tabs .t-type').forEach((el) => {
    el.onclick = () => {
      state.selBetType = el.dataset.type as BetType;
      renderBetTabs();
      renderHorseCards();
    };
  });
  updateBetSelInfo();
}

/** 전체 배당표 창. 칸을 누르면 그 말과 종류가 마권에 적힌다 */
function renderOddsTable(): void {
  const types = Object.keys(BET_TYPE_INFO) as BetType[];
  $('odds-table').innerHTML =
    `<div class="od-row od-head"><span></span>${types.map((t) => `<span class="od-type"><b>${BET_TYPE_INFO[t].label}</b></span>`).join('')}</div>` +
    state.horses
      .map((h) => {
        const cells = types
          .map((t) => {
            const o = state.odds[h.id]?.[t];
            const sel = state.selHorse === h.id && state.selBetType === t;
            const mine = state.myBets.some((b) => b.horseId === h.id && b.type === t);
            return `<button class="od-cell${sel ? ' selected' : ''}${mine ? ' has-bet' : ''}${o && o >= 10 ? ' hot' : ''}" data-horse="${h.id}" data-type="${t}" aria-label="${esc(h.name)} ${BET_TYPE_INFO[t].label} 배당 ${o ? o.toFixed(2) : '-'}">${o ? `×${o.toFixed(2)}` : '-'}</button>`;
          })
          .join('');
        return `<div class="od-row"><span class="od-horse">${bib(h.id, h.color, 'sm')}<span>${esc(h.name)}</span></span>${cells}</div>`;
      })
      .join('') +
    `<p class="od-legend"><span class="od-mark"></span>이미 건 칸 <span class="od-hot">빨간 숫자</span>는 10배 이상</p>`;
  document.querySelectorAll<HTMLElement>('#odds-table .od-cell').forEach((el) => {
    el.onclick = () => {
      state.selHorse = Number(el.dataset.horse);
      state.selBetType = el.dataset.type as BetType;
      renderHorseCards();
      renderBetTabs();
      hide('modal-odds');
    };
  });
}

function betLimitNow(): { limit: number; used: number } {
  const limit = Math.floor(state.bettingBaseCoins * BET_LIMIT_RATIO);
  const used = state.myBets.reduce((s, b) => s + b.amount, 0);
  return { limit, used };
}

function updateBetSelInfo(): void {
  const { limit, used } = betLimitNow();
  const left = Math.max(0, Math.min(limit - used, state.coins));
  $('bet-limit-info').textContent = `더 걸 수 있는 코인 ${left}`;

  // 배팅 버튼 하나에 "누구에게, 무엇을, 얼마"를 모두 적는다
  const btn = $<HTMLButtonElement>('btn-place-bet');
  const amount = Math.floor(Number($<HTMLInputElement>('bet-amount').value) || 0);
  const horse = state.horses.find((h) => h.id === state.selHorse);
  const odds = horse ? state.odds[horse.id]?.[state.selBetType] : undefined;
  const pay = horse && odds && amount >= BET_MIN ? Math.floor(amount * odds) : 0;
  $('ticket-pay').textContent = pay.toLocaleString('ko-KR');
  $('ticket-pay').classList.toggle('zero', pay === 0);
  if (!horse) {
    btn.disabled = true;
    btn.textContent = '말을 먼저 고르세요';
  } else if (amount < BET_MIN) {
    btn.disabled = true;
    btn.textContent = `금액을 정하세요 (최소 ${BET_MIN}코인)`;
  } else if (amount > left) {
    btn.disabled = true;
    btn.textContent = `${left}코인까지만 걸 수 있습니다`;
  } else {
    btn.disabled = false;
    btn.textContent = `${amount}코인 걸기`;
  }
}

function renderMyBets(): void {
  if (state.myBets.length === 0) {
    $('my-bets').innerHTML = '<p class="muted">아직 건 마권이 없습니다.</p>';
    return;
  }
  $('my-bets').innerHTML = state.myBets
    .map(
      (b) => `<div class="my-bet-item">
        <span class="mb-main">${BET_TYPE_INFO[b.type].label} ${horseChip(b.horseId)} ${coinHtml(b.amount)} <span class="muted">배당 ×${b.odds.toFixed(2)}</span></span>
        ${state.phase === 'betting' ? `<button data-bet="${b.betId}">취소</button>` : ''}
      </div>`
    )
    .join('');
  document.querySelectorAll<HTMLElement>('.my-bet-item button').forEach((el) => {
    el.onclick = () => net.send({ type: 'CANCEL_BET', betId: el.dataset.bet! });
  });
}

// ============ 증강 UI ============

/** 증강 창을 접어 두었는지. 접으면 아래쪽 작은 단추만 남고, 새 증강이 오면 다시 펼쳐진다 */
let augFolded = false;
let augFoldPhase = -1;

function renderAugmentBar(): void {
  renderAugmentBarInner();
  const aug = state.augment;
  if (!aug || aug.used || augFolded) {
    hoverCardKey = null;
    hoverPick = null;
  }
  applyAugmentHighlight();
}

function renderAugmentBarInner(): void {
  const aug = state.augment;
  const bar = $('augment-bar');
  // 증강은 화면 가운데 창으로 뜨므로 카메라를 올릴 필요가 없다
  view?.setBottomInset(false);
  if (aug && aug.phase !== augFoldPhase) {
    augFoldPhase = aug.phase;
    augFolded = false;
  }
  const open = !!aug && !aug.used && !augFolded;
  $('race-wrap').classList.toggle('augment-open', open);
  bar.classList.toggle('folded', !!aug && !open);
  if (!aug) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  if (aug.used) {
    bar.innerHTML = `<div class="augment-used-msg">카드를 썼습니다. 경주를 지켜보세요.</div>`;
    return;
  }
  if (augFolded) {
    // 접은 상태: 남은 시간만 보이는 단추. 누르면 다시 펼친다
    bar.innerHTML = `<button class="aug-pill" data-unfold>${icon('gem')}${aug.phase}차 증강 카드 ${aug.queuedKey ? '바꾸기' : '고르기'} <span id="augment-remain">${aug.preview ? '미리보기' : ''}</span></button>`;
    bar.querySelector<HTMLElement>('[data-unfold]')!.onclick = () => {
      augFolded = false;
      renderAugmentBar();
    };
    return;
  }

  const tierInfo = TIER_INFO[aug.tier];
  const livePct = Math.round((AUGMENT_PHASES.find((ph) => ph.phase === aug.phase)?.at ?? 0) * 100);
  const guide = aug.preview
    ? aug.queuedKey
      ? `예약 완료. 선두가 ${livePct}%에 닿으면 발동`
      : `미리 고르기. 선두가 ${livePct}%에 닿으면 발동`
    : '지금 한 장을 고르세요';
  const head = `<div class="augment-head">
      <b>${aug.phase}차 증강 <span class="aug-tier-chip" style="background:${tierInfo.color}">${icon('gem')}${tierInfo.label}</span> <span class="aug-guide">${guide}</span></b>
      <span class="augment-head-right"><span id="augment-remain"></span><button class="aug-fold" data-fold title="창을 접고 경주 보기">접기</button></span>
    </div>
    <div class="augment-timebar"><div id="augment-timefill"></div></div>`;

  const cards = aug.cards
    .map((c) => {
      const def = AUGMENT_BY_ID[c.defId];
      if (!def) return '';
      const rar = TIER_INFO[TIER_OF_RARITY[def.rarity]];
      const selected = aug.selectedKey === c.cardKey;
      let pickRow = '';
      if (selected && def.targetType === 'single') {
        pickRow = `<div class="augment-pickhorse">${state.horses
          .map(
            (h) =>
              `<button class="pick${inkOn(h.color) ? ' dk' : ''}${state.myBets.some((b) => b.horseId === h.id) ? ' mybet' : ''}" style="background:${h.color}" data-pick="${h.id}" data-key="${c.cardKey}" title="${esc(h.name)}" aria-label="${h.id}번 ${esc(h.name)}">${h.id}</button>`
          )
          .join('')}</div>`;
      } else if (selected) {
        pickRow = `<div class="augment-pickhorse"><button class="btn small" data-confirm="${c.cardKey}">${aug.preview ? '이 카드 예약' : '이 카드 쓰기'}</button></div>`;
      }
      const queued = aug.queuedKey === c.cardKey;
      return `<div class="augment-card ${def.hostile ? 'bad' : 'good'}${selected ? ' selected' : ''}${queued ? ' queued' : ''}" data-card="${c.cardKey}" style="border-color:${rar.color};${aug.pending ? 'opacity:0.5;pointer-events:none' : ''}">
        
        ${queued ? '<span class="aug-queued">예약됨</span>' : ''}
        ${
          aug.rerolled.includes(c.cardKey)
            ? ''
            : `<button class="aug-reroll" data-reroll="${c.cardKey}" title="다른 카드로 바꾸기 (한 번만)" aria-label="${esc(def.name)} 카드를 다른 카드로 바꾸기">${icon('refresh')}</button>`
        }
        <div class="aug-band"><b>${def.hostile ? '방해' : '도움'}</b><span>${esc(def.name)}</span></div>
        <div class="aug-body">
          ${cardEffectHtml(def.description)}
          <div class="aug-tgt"><span class="aug-tgt-label">${icon('target')}${TARGET_TYPE_LABELS[def.targetType] ?? ''}</span><span class="aug-tgt-now" data-tgt="${c.cardKey}">${queued && def.targetType === 'single' ? queuedTargetHtml() : targetNowHtml(def)}</span></div>
          ${pickRow}
        </div>
      </div>`;
    })
    .join('');

  bar.innerHTML = head + `<div class="augment-cards">${cards}</div>`;

  bar.querySelectorAll<HTMLElement>('.augment-card').forEach((el) => {
    el.onclick = (ev) => {
      if ((ev.target as HTMLElement).tagName === 'BUTTON') return;
      const key = el.dataset.card!;
      if (state.augment && state.augment.selectedKey !== key) {
        state.augment.selectedKey = key;
        renderAugmentBar();
      }
    };
  });
  bar.querySelector<HTMLElement>('[data-fold]')!.onclick = () => {
    augFolded = true;
    renderAugmentBar();
  };
  bar.querySelectorAll<HTMLElement>('[data-reroll]').forEach((el) => {
    el.onclick = () => net.send({ type: 'REROLL_AUGMENT', cardKey: el.dataset.reroll! });
  });
  bar.querySelectorAll<HTMLElement>('[data-pick]').forEach((el) => {
    el.onclick = () => {
      sendAugment(el.dataset.key!, Number(el.dataset.pick));
    };
  });
  bar.querySelectorAll<HTMLElement>('[data-confirm]').forEach((el) => {
    el.onclick = () => sendAugment(el.dataset.confirm!);
  });
}

function sendAugment(cardKey: string, targetHorseId?: number): void {
  if (!state.augment) return;
  state.augment.pending = true;
  state.augment.sentTarget = targetHorseId ?? null;
  renderAugmentBar();
  net.send({ type: 'SELECT_AUGMENT', cardKey, targetHorseId });
}

// ============ 결과 화면 ============

function renderRoundResult(data: {
  round: number;
  results: PlayerRoundResult[];
  standings: Standing[];
  isFinal: boolean;
  ownerPrize?: OwnerPrize;
}): void {
  // 내 말의 순위 상금 (당근) — 같은 상금은 한 번만 받는다
  const prize = data.ownerPrize && data.ownerPrize.playerId === state.myId ? data.ownerPrize : null;
  if (prize && claimRoundPrize(prize)) {
    sfx('carrot', 0, 1.5);
    toast(`내 말 ${prize.rank}위, 당근 +${prize.carrots}`, false);
  }
  const prizeHtml = prize
    ? `<div class="carrot-row">${icon('star')}<span>내 말 <b>${esc(prize.horseName)}</b> ${prize.rank}위</span>
        <b class="carrot-chip">${icon('carrot')}+${prize.carrots}</b>
        <span class="muted">지금 ${stable().carrots}개</span></div>`
    : '';

  const rankingHtml = (state.rankings ?? [])
    .map((r) => {
      const h = state.horses.find((x) => x.id === r.horseId);
      return `<div class="result-horse${r.rank === 1 ? ' first' : ''}">
        ${rankBadge(r.rank)}
        ${bib(r.horseId, h?.color ?? '#888')}
        <span class="rh-name">${esc(h?.name ?? '')}${isMyHorse(h) ? ' (내 말)' : ''}</span>
        <span class="muted">${(r.timeMs / 1000).toFixed(2)}초</span>
      </div>`;
    })
    .join('');

  const rows = data.results
    .flatMap((res) => {
      if (res.bets.length === 0) {
        return [
          `<tr><td>${playerChip(res.playerId, res.playerName)}</td><td colspan="3" class="muted">배팅 없음</td><td class="num">${res.coins}</td></tr>`
        ];
      }
      return res.bets.map(
        (b, i) => `<tr>
          <td>${i === 0 ? playerChip(res.playerId, res.playerName) : ''}</td>
          <td><span class="rp-bet">${BET_TYPE_INFO[b.type].label} ${horseChip(b.horseId)} ${coinHtml(b.amount)}</span></td>
          <td>${b.hit ? '<span class="stamp sm">적중</span>' : '<span class="miss">빗나감</span>'}</td>
          <td class="num ${b.hit ? 'pos' : 'neg'}">${b.hit ? `+${b.payout - b.amount}` : `-${b.amount}`}</td>
          <td class="num">${i === 0 ? res.coins : ''}</td>
        </tr>`
      );
    })
    .join('');

  const standingsHtml = data.standings
    .map(
      (s) => `<div class="standing-row${s.playerId === state.myId ? ' me' : ''}">
        <span class="sr-main">${rankBadge(s.rank)}${playerChip(s.playerId, s.name)}${s.isNpc ? NPC_TAG : ''}</span><b>${icon('coin')}${s.coins}</b>
      </div>`
    )
    .join('');

  const hostBtn = isHost()
    ? `<button id="btn-next-round" class="btn big">${data.isFinal ? '최종 결과 보기' : '다음 라운드'}</button>`
    : '<p class="muted">방장이 넘기면 이어집니다.</p>';

  $('result-inner').innerHTML = `
    <div class="result-title"><h2>${data.round}라운드 결과</h2><span class="stamp">확정</span></div>
    <div class="result-rankings">${rankingHtml}</div>
    ${prizeHtml}
    <h3>배팅 정산</h3>
    <table class="result-table">
      <tr><th>플레이어</th><th>배팅</th><th>결과</th><th class="num">손익</th><th class="num">코인</th></tr>
      ${rows}
    </table>
    <h3>현재 순위</h3>
    <div>${standingsHtml}</div>
    <div class="btn-row" style="justify-content:flex-end">${hostBtn}</div>`;
  show('overlay-result');
  const btn = document.getElementById('btn-next-round');
  if (btn) btn.onclick = () => net.send({ type: 'NEXT_ROUND' });
}

function renderGameResult(data: { standings: Standing[]; awards: Award[]; ownerBonus?: OwnerBonus }): void {
  // 게임 종료 당근 보너스 — 한 번만 받는다
  const bonus = data.ownerBonus && data.ownerBonus.playerId === state.myId ? data.ownerBonus : null;
  if (bonus && claimGameBonus(bonus)) {
    sfx('carrot', 0, 2.6);
    toast(`게임 보너스, 당근 +${bonus.placementCarrots + bonus.profitCarrots}`, false);
  }
  const carrots = (n: number): string => `<b>${icon('carrot')}+${n}</b>`;
  const bonusHtml = bonus
    ? `<h3>당근 정산</h3>
      <div class="carrot-box">
        <div><span>내 말 순위 상금 (라운드 합계)</span>${carrots(bonus.roundCarrots)}</div>
        <div><span>최종 ${bonus.placement}위 보너스</span>${carrots(bonus.placementCarrots)}</div>
        <div><span>배팅 순이익 보너스 (순이익의 10%)</span>${carrots(bonus.profitCarrots)}</div>
        <div class="carrot-total"><span>이번 게임에서 번 당근</span>${carrots(
          bonus.roundCarrots + bonus.placementCarrots + bonus.profitCarrots
        )}</div>
      </div>
      <p class="muted">지금 당근 ${stable().carrots}개</p>`
    : '';

  const standingsHtml = data.standings
    .map(
      (s) => `<div class="standing-row${s.playerId === state.myId ? ' me' : ''}">
        <span class="sr-main">${rankBadge(s.rank)}${playerChip(s.playerId, s.name)}${s.isNpc ? NPC_TAG : ''}
        <span class="muted">적중 ${s.hits}회, 순손익 ${s.netProfit >= 0 ? '+' : ''}${s.netProfit}</span></span>
        <b>${icon('coin')}${s.coins}</b>
      </div>`
    )
    .join('');
  const awardsHtml = data.awards
    .map(
      (a) =>
        `<div class="award-row"><b>${esc(a.title)}</b> ${esc(a.playerName)} <span class="muted">${esc(a.detail)}</span></div>`
    )
    .join('');
  const hostBtn = isHost()
    ? '<button id="btn-restart" class="btn big">같은 방에서 다시 하기</button>'
    : '<p class="muted">방장이 다시 시작할 수 있습니다.</p>';
  const winner = data.standings.find((s) => s.rank === 1);

  $('result-inner').innerHTML = `
    <div class="result-title"><h2>최종 결과</h2>${
      winner ? `<span class="stamp">${icon('trophy')} ${esc(winner.name)} 우승</span>` : ''
    }</div>
    <div>${standingsHtml}</div>
    ${bonusHtml}
    ${data.awards.length ? '<h3>이번 판의 기록</h3>' + awardsHtml : ''}
    <div class="btn-row">
      <button id="btn-to-main" class="btn ghost">나가기</button>
      <span class="btn-row">
        ${bonus ? '<button id="btn-to-stable" class="btn big alt">마구간 가기</button>' : ''}
        ${hostBtn}
      </span>
    </div>`;
  show('overlay-result');
  const restart = document.getElementById('btn-restart');
  if (restart) restart.onclick = () => net.send({ type: 'RESTART' });
  document.getElementById('btn-to-main')!.onclick = () => {
    net.send({ type: 'LEAVE_ROOM' });
    leaveToMain();
  };
  const toStable = document.getElementById('btn-to-stable');
  if (toStable) {
    toStable.onclick = () => {
      net.send({ type: 'LEAVE_ROOM' });
      leaveToMain();
      showScreen('scr-stable');
      openStable();
    };
  }
}

function leaveToMain(): void {
  playerSlot.clear();
  colorWished = false;
  state.roomId = null;
  state.phase = 'lobby';
  const tok = loadToken();
  if (tok) saveToken({ ...tok, roomId: null });
  hide('overlay-result');
  hide('overlay-betting');
  hide('overlay-reveal');
  hide('overlay-countdown');
  hide('modal-players');
  hide('modal-bets');
  // 게임 도중에 나가는 경우를 위해 진행 중이던 화면 상태를 모두 비운다
  state.augment = null;
  state.horses = [];
  state.myBets = [];
  state.revealed = [];
  state.rankings = null;
  $('augment-bar').classList.add('hidden');
  renderRankBoard(null);
  $('race-wrap').classList.remove('augment-open');
  $('camera-select').classList.add('hidden');
  $('game-log').innerHTML = '';
  view?.destroy();
  view = null;
  $('race-canvas').innerHTML = '';
  showScreen('scr-main');
}

// ============ 단계 전환 ============

const PHASE_LABELS: Record<RoomPhase, string> = {
  lobby: '대기 중',
  preview: '출마표 확인',
  betting: '배팅 중',
  reveal: '배팅 공개',
  countdown: '출발 준비',
  racing: '경주 중',
  roundResult: '라운드 결과',
  gameResult: '최종 결과'
};

function updateTopbar(): void {
  $('top-round').textContent = state.round > 0 ? `${state.round}/${state.totalRounds} 라운드` : '';
  $('top-phase').textContent = PHASE_LABELS[state.phase];
  // 화면 단계에 따라 CSS가 달라지는 곳(상단 바의 남은 시간 등)에서 쓴다
  $('scr-game').dataset.phase = state.phase;
  $('top-coins').innerHTML = `${icon('coin')}${state.coins}`;
}

function enterGameScreen(): void {
  showScreen('scr-game');
  ensureGame();
  renderSidebar();
  updateTopbar();
}

// ============ 스냅샷 복구 (참가/재접속) ============

function applySnapshot(snap: RoomSnapshot): void {
  state.roomId = snap.roomId;
  state.players = snap.players;
  state.settings = snap.settings;
  state.phase = snap.phase;
  state.round = snap.round;
  state.totalRounds = snap.settings.totalRounds;
  state.coins = snap.coins;
  state.myBets = snap.myBets;
  state.phaseEndsAt = snap.phaseEndsAt ?? 0;
  state.revealed = snap.revealedBets ?? [];
  state.betCounts = snap.betCounts ?? [];
  state.rankings = snap.rankings ?? null;
  state.readySent = false;
  if (snap.horses) state.horses = snap.horses;
  if (snap.odds) state.odds = snap.odds;
  state.bettingBaseCoins = state.coins + state.myBets.reduce((s, b) => s + b.amount, 0);

  const tok = loadToken();
  if (tok) saveToken({ ...tok, roomId: snap.roomId });

  hide('overlay-betting');
  hide('overlay-reveal');
  hide('overlay-result');
  hide('overlay-countdown');
  state.augment = null;

  if (snap.phase === 'lobby') {
    showScreen('scr-lobby');
    renderLobby();
    return;
  }

  enterGameScreen();
  if (snap.horses) view?.setupRace(snap.horses);
  state.cameraSel = 'leader';
  renderCameraSelect();

  switch (snap.phase) {
    case 'preview':
    case 'betting':
      renderBettingOverlay();
      break;
    case 'reveal':
      renderRevealOverlay();
      break;
    case 'countdown':
      show('overlay-countdown');
      break;
    case 'racing':
      if (snap.race) view?.pushState(snap.race.horses);
      if (snap.augment) {
        state.augment = {
          ...snap.augment,
          selectedKey: null,
          pending: false,
          preview: !!snap.augment.preview,
          queuedKey: snap.augment.queuedKey ?? null,
          rerolled: snap.augment.rerolled ?? []
        };
        renderAugmentBar();
      }
      renderSideBets();
      break;
    case 'roundResult':
      if (snap.roundResult) renderRoundResult(snap.roundResult);
      renderSideBets();
      break;
    case 'gameResult':
      if (snap.gameResult) renderGameResult(snap.gameResult);
      break;
  }
  updateTopbar();
}

/** 사람별 배팅 목록 — 배팅 공개 화면과 배팅 현황 창이 함께 쓴다. 블라인드 방에서는 내 것만 내용이 보인다 */
function revealListHtml(): string {
  const blind = betsHidden();
  return state.players
    .map((p) => {
      const bets = state.revealed.filter((b) => b.playerId === p.id);
      const name = playerChip(p.id, p.name + (p.id === state.myId ? ' (나)' : ''));
      const count = state.betCounts.find((c) => c.playerId === p.id)?.count ?? bets.length;
      const hiddenFromMe = blind && p.id !== state.myId;
      let betsHtml: string;
      if (hiddenFromMe) {
        betsHtml =
          count === 0
            ? '<span class="muted">배팅 없음</span>'
            : `<span class="rp-bet">${icon('blind')}마권 ${count}장 <span class="muted">결과가 나오면 공개됩니다</span></span>`;
      } else if (bets.length === 0) {
        betsHtml = '<span class="muted">배팅 없음</span>';
      } else {
        betsHtml = bets
          .map(
            (b) =>
              `<span class="rp-bet">${BET_TYPE_INFO[b.type].label} ${horseChip(b.horseId, false)} ${coinHtml(b.amount)} <span class="muted">배당 ×${b.odds.toFixed(2)}</span></span>`
          )
          .join('');
      }
      return `<div class="reveal-player${p.id === state.myId ? ' me' : ''}"><div class="rp-name">${name}</div><div class="rp-bets">${betsHtml}</div></div>`;
    })
    .join('');
}

function renderRevealOverlay(): void {
  const title = document.querySelector('#overlay-reveal h2');
  if (title) title.textContent = betsHidden() ? '블라인드 배팅' : '배팅 공개';
  $('reveal-list').innerHTML = revealListHtml();
  show('overlay-reveal');
}

// ============ 서버 메시지 처리 ============

net.on((msg: S2C) => {
  switch (msg.type) {
    case 'WELCOME': {
      state.lastWelcome = { playerId: msg.playerId, secret: msg.secret };
      const tok = loadToken();
      if (tok?.roomId) {
        state.waitingReconnect = true;
        net.send({ type: 'RECONNECT', playerId: tok.playerId, secret: tok.secret, roomId: tok.roomId });
      } else {
        state.myId = msg.playerId;
        state.secret = msg.secret;
        saveToken({ playerId: msg.playerId, secret: msg.secret, roomId: null });
      }
      break;
    }

    case 'ROOM_JOINED': {
      state.waitingReconnect = false;
      state.myId = msg.you;
      const tok = loadToken();
      if (tok) saveToken({ ...tok, roomId: msg.snapshot.roomId });
      applySnapshot(msg.snapshot);
      break;
    }

    case 'ROOM_LIST':
      break; // 방은 초대 코드로만 들어온다 (목록 없음)

    case 'ROOM_UPDATE': {
      state.players = msg.players;
      state.settings = msg.settings;
      // 지난번에 고른 색이 비어 있으면 이번 방에서도 그 색을 쓴다 (방마다 한 번만 요청)
      if (!colorWished) {
        const me = msg.players.find((p) => p.id === state.myId);
        if (me) {
          colorWished = true;
          const wish = Number(localStorage.getItem(COLOR_KEY) ?? NaN);
          const free = !msg.players.some((p) => p.color === wish && p.id !== me.id && !p.isNpc);
          if (Number.isInteger(wish) && wish !== me.color && free) net.send({ type: 'SET_COLOR', color: wish });
        }
      }
      if (state.phase === 'lobby') renderLobby();
      if (state.phase === 'preview' || state.phase === 'betting') renderReadyCount();
      renderSidebar();
      break;
    }

    case 'LOBBY_RETURN': {
      state.phase = 'lobby';
      state.round = 0;
      hide('overlay-result');
      hide('overlay-betting');
      hide('overlay-reveal');
      showScreen('scr-lobby');
      renderLobby();
      break;
    }

    case 'ERROR': {
      if (state.waitingReconnect) {
        // 재접속 실패 → 새 세션으로 시작
        state.waitingReconnect = false;
        if (state.lastWelcome) {
          state.myId = state.lastWelcome.playerId;
          state.secret = state.lastWelcome.secret;
          saveToken({ playerId: state.myId, secret: state.secret, roomId: null });
        }
        showScreen('scr-main');
        break;
      }
      toast(msg.message);
      break;
    }

    case 'GAME_START': {
      state.totalRounds = msg.totalRounds;
      state.coins = msg.startCoins;
      break;
    }

    case 'ROUND_START': {
      state.round = msg.round;
      state.totalRounds = msg.totalRounds;
      state.horses = msg.horses;
      state.odds = msg.odds;
      state.coins = msg.coins;
      state.phase = 'preview';
      state.phaseEndsAt = msg.phaseEndsAt;
      state.myBets = [];
      state.revealed = [];
      state.rankings = null;
      state.augment = null;
      state.selHorse = null;
      state.readySent = false;
      hide('overlay-result');
      hide('overlay-reveal');
      $('augment-bar').classList.add('hidden');
      state.cameraSel = 'leader';
      enterGameScreen();
      view?.clearBanner();
      view?.setupRace(msg.horses);
      renderRankBoard(null);
      view?.setCameraTarget('leader');
      renderCameraSelect();
      renderBettingOverlay();
      renderSideBets();
      sfx('reveal');
      // 기록 칸에는 증강 사용만 남긴다. 코인 보충은 잠깐 알림으로만 알린다
      for (const t of msg.topUps) {
        if (t.playerId === state.myId) toast(`코인이 바닥나서 ${t.amount}코인을 받았습니다.`, false);
      }
      updateTopbar();
      break;
    }

    case 'BETTING_START': {
      state.phase = 'betting';
      state.phaseEndsAt = msg.endsAt;
      state.bettingBaseCoins = state.coins;
      state.readySent = false;
      sfx('bell');
      renderBettingOverlay();
      updateTopbar();
      break;
    }

    case 'BET_ACCEPTED': {
      state.myBets.push(msg.bet);
      sfx('coin');
      state.coins = msg.coins;
      renderMyBets();
      updateBetSelInfo();
      updateTopbar();
      break;
    }

    case 'BET_CANCELED': {
      state.myBets = state.myBets.filter((b) => b.betId !== msg.betId);
      sfx('cancel');
      state.coins = msg.coins;
      renderMyBets();
      updateBetSelInfo();
      updateTopbar();
      break;
    }

    case 'BET_REVEAL': {
      state.phase = 'reveal';
      state.phaseEndsAt = msg.endsAt;
      state.revealed = msg.bets;
      state.betCounts = msg.betCounts;
      sfx('reveal');
      hide('overlay-betting');
      renderRevealOverlay();
      renderSideBets();
      updateTopbar();
      break;
    }

    case 'COUNTDOWN': {
      state.phase = 'countdown';
      state.phaseEndsAt = msg.endsAt;
      hide('overlay-reveal');
      show('overlay-countdown');
      updateTopbar();
      break;
    }

    case 'RACE_START': {
      state.phase = 'racing';
      hide('overlay-countdown');
      sfx('go');
      warmCardSfx();
      view?.announce('출발!');
      updateTopbar();
      break;
    }

    case 'RACE_STATE': {
      view?.pushState(msg.horses);
      lastSnaps = msg.horses;
      syncBetMarks();
      renderRankBoard(msg.horses);
      refreshAugmentTargets();
      break;
    }

    case 'AUGMENT_PHASE': {
      state.augment = {
        phase: msg.phase,
        tier: msg.tier,
        endsAt: msg.endsAt,
        cards: msg.cards,
        used: false,
        selectedKey: null,
        pending: false,
        preview: !!msg.preview,
        queuedKey: null,
        rerolled: []
      };
      renderAugmentBar();
      sfx('augment', ['silver', 'gold', 'platinum'].indexOf(msg.tier));
      {
        const tierInfo = TIER_INFO[msg.tier];
        const tierColor = { silver: '#dee2e6', gold: '#ffd43b', platinum: '#66d9e8' }[msg.tier];
        view?.announce(`${msg.phase}차 증강 ${tierInfo.label}`, tierColor);
      }
      break;
    }

    case 'AUGMENT_REROLLED': {
      const aug = state.augment;
      if (!aug) break;
      aug.cards = aug.cards.map((c) => (c.cardKey === msg.cardKey ? { ...c, defId: msg.defId } : c));
      aug.rerolled.push(msg.cardKey);
      // 바꾼 카드를 고르거나 예약해 둔 상태였다면 푼다
      if (aug.selectedKey === msg.cardKey) aug.selectedKey = null;
      if (aug.queuedKey === msg.cardKey) aug.queuedKey = null;
      renderAugmentBar();
      sfx('pop');
      break;
    }

    case 'AUGMENT_LIVE': {
      if (state.augment && state.augment.phase === msg.phase) {
        state.augment.preview = false;
        state.augment.endsAt = msg.endsAt;
        renderAugmentBar();
      }
      break;
    }

    case 'AUGMENT_CLOSED': {
      state.augment = null;
      renderAugmentBar();
      break;
    }

    case 'AUGMENT_RESULT': {
      if (!state.augment) break;
      if (msg.ok && msg.queued) {
        // 미리 고르기: 예약만 됐다. 증강 지점에서 발동하고, 그 전에는 바꿀 수 있다
        state.augment.queuedKey = msg.cardKey ?? null;
        state.augment.queuedTarget = state.augment.sentTarget ?? null;
        state.augment.selectedKey = null;
        state.augment.pending = false;
      } else if (msg.ok) {
        state.augment.used = true;
        state.augment.pending = false;
      } else {
        state.augment.pending = false;
        state.augment.selectedKey = null;
        state.augment.queuedKey = null;
        toast(msg.message ?? '이 카드는 쓸 수 없습니다. 다른 카드를 고르세요.');
      }
      renderAugmentBar();
      break;
    }

    case 'AUGMENT_USED': {
      const def = AUGMENT_BY_ID[msg.defId];
      if (!def) break;
      // 기록은 세 칸: 누가 / 무슨 카드 / 어느 말에게
      const logBib = (id: number, blocked: boolean): string =>
        `<span class="lg-horse${blocked ? ' blocked' : ''}">${bib(id, horseColor(id), 'sm')}<span>${esc(state.horses.find((x) => x.id === id)?.name ?? '')}</span>${blocked ? '<i>막음</i>' : ''}</span>`;
      const hit = [...msg.targets, ...msg.blocked];
      const targetsHtml =
        msg.targets.map((id) => logBib(id, false)).join('') + msg.blocked.map((id) => logBib(id, true)).join('');
      // 내 말이나 내가 건 말이 대상이면 줄을 강조한다
      const myHorseHit = hit.some((id) => isMyHorse(state.horses.find((x) => x.id === id)));
      const myBetHit = hit.some((id) => state.myBets.some((b) => b.horseId === id));
      const flag = myBetHit ? '<span class="lg-flag">내 배팅</span>' : myHorseHit ? '<span class="lg-flag">내 말</span>' : '';
      addLog(
        `<span class="lg-who">${playerChip(msg.playerId, msg.playerName)}</span>` +
          `<span class="lg-card">${kindChip(def.hostile)}<span class="lg-cardname">${esc(def.name)}</span></span>` +
          `<span class="lg-to">${targetsHtml || '<span class="muted">대상 없음</span>'}${flag}</span>`,
        // 내가 건 말이 대상이면 줄에 색을 칠한다: 이로운 효과는 연두, 해로운 효과는 빨강
        `log-row ${def.hostile ? 'log-bad' : 'log-good'}${myBetHit ? (def.hostile ? ' log-mybet-bad' : ' log-mybet-good') : ''}`
      );
      // 누가 무엇을 썼는지는 맞은 말 머리 위에 몇 초간 붙여 둔다
      view?.showAugmentNote(msg.targets, `${def.emoji} ${def.name}`, msg.playerName, def.hostile, playerColor(msg.playerId));
      view?.showAugmentNote(msg.blocked, '방어 성공', def.name, false);
      view?.flashHorses(msg.targets, !def.hostile);
      // 카드마다 고유 효과음이 있고, 없는 카드만 공통 소리를 낸다
      if (!cardSfx(def.id)) sfx(def.hostile ? 'hex' : 'buff');
      if (msg.blocked.length > 0) sfx('shield');
      break;
    }

    case 'RACE_FINISH': {
      state.rankings = msg.rankings;
      state.augment = null;
      renderAugmentBar();
      view?.showFinish(msg.rankings);
      sfx('finish');
      break;
    }

    case 'ROUND_RESULT': {
      state.phase = 'roundResult';
      const mine = msg.results.find((r) => r.playerId === state.myId);
      if (mine) state.coins = mine.coins;
      // 내 배팅이 하나라도 맞았으면 축하, 다 빗나갔으면 뿜뿜뿜
      if (mine) sfx(mine.bets.length === 0 ? 'bell' : mine.bets.some((b) => b.hit) ? 'win' : 'lose');
      state.players = state.players.map((p) => {
        const res = msg.results.find((r) => r.playerId === p.id);
        return res ? { ...p, coins: res.coins } : p;
      });
      // 결과가 나오면 블라인드 방에서도 모든 배팅이 공개된다
      state.revealed = msg.results.flatMap((r) =>
        r.bets.map((b) => ({ ...b, playerName: r.playerName }))
      );
      renderSidebar();
      renderSideBets();
      renderRoundResult(msg);
      updateTopbar();
      break;
    }

    case 'GAME_RESULT': {
      state.phase = 'gameResult';
      sfx(msg.standings.find((s) => s.playerId === state.myId)?.rank === 1 ? 'champion' : 'gameEnd');
      renderGameResult(msg);
      updateTopbar();
      break;
    }

    case 'EMOTE': {
      view?.showEmote(msg.playerName, msg.emoji);
      sfx('pop');
      break;
    }

    case 'ROOM_CLOSED': {
      toast(`방이 닫혔습니다. ${msg.reason}`);
      leaveToMain();
      break;
    }
  }
  syncMusic();
});

// ============ 타이머 루프 ============

/** 마지막으로 똑딱 소리를 낸 초 (같은 초에 두 번 울리지 않게) */
let lastTick = -1;

/** 글자가 실제로 바뀔 때만 쓴다. 같은 글자를 다시 써도 브라우저는 화면을 다시 계산하기 때문이다 */
function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

setInterval(() => {
  const remain = Math.max(0, state.phaseEndsAt - Date.now());
  const sec = Math.ceil(remain / 1000);

  const timed = state.phase === 'preview' || state.phase === 'betting' || state.phase === 'reveal' || state.phase === 'countdown';
  setText($('top-timer'), timed ? `${sec}초` : '');

  if (state.phase === 'preview' || state.phase === 'betting') {
    setText($('betting-timer'), `${sec}초`);
  }

  if (state.phase === 'countdown') {
    const n = Math.ceil(remain / 1000);
    setText($('overlay-countdown'), n > 0 ? String(n) : 'GO!');
    if (n !== lastTick) {
      lastTick = n;
      if (n > 0) sfx('tick');
    }
  } else if (state.phase === 'betting' && !state.readySent && sec > 0 && sec <= 5) {
    // 배팅 마감 5초 전부터 재촉한다
    if (sec !== lastTick) {
      lastTick = sec;
      sfx('warn');
    }
  } else {
    lastTick = -1;
  }

  const aug = state.augment;
  if (aug && !aug.used && !aug.preview) {
    const augRemain = Math.max(0, aug.endsAt - Date.now());
    const el = document.getElementById('augment-remain');
    setText(el, `${(augRemain / 1000).toFixed(1)}초`);
    const fill = document.getElementById('augment-timefill');
    if (fill) {
      const total = AUGMENT_PHASES.find((p) => p.phase === aug.phase)?.durationMs ?? 6000;
      // 너비 대신 transform으로 줄여 레이아웃을 다시 하지 않게 한다
      fill.style.transform = `scaleX(${Math.max(0, augRemain / total).toFixed(3)})`;
    }
  }
}, 150);

// ============ 버튼 바인딩 ============

/** 배경음악·효과음 켜고 끄는 버튼 (메뉴 화면 구석과 게임 전광판에 하나씩 있다) */
function bindSoundButtons(): void {
  const buttons = document.querySelectorAll<HTMLElement>('[data-snd]');
  const refresh = (): void => {
    const p = soundPrefs();
    buttons.forEach((b) => {
      const music = b.dataset.snd === 'music';
      const on = music ? p.music : p.sfx;
      b.setAttribute('aria-pressed', String(on));
      b.title = `${music ? '배경음악' : '효과음'} ${on ? '끄기' : '켜기'}`;
    });
  };
  buttons.forEach((b) => {
    b.onclick = () => (b.dataset.snd === 'music' ? toggleMusic() : toggleSfx());
  });
  onSoundPrefsChange(refresh);
  refresh();
}

function bindUI(): void {
  mountIcons();

  // 참가자 / 배팅 현황 창: 상단 버튼으로 열고, 닫기 버튼이나 바깥을 누르면 닫는다
  for (const [btn, modal] of [['btn-show-players', 'modal-players'], ['btn-show-bets', 'modal-bets']]) {
    $(btn).onclick = () => {
      if (modal === 'modal-bets') renderSideBets();
      const opening = $(modal).classList.contains('hidden');
      hide('modal-players');
      hide('modal-bets');
      if (opening) show(modal);
    };
    $(modal).onclick = (ev) => {
      const t = ev.target as HTMLElement;
      if (t === $(modal) || t.closest('[data-close]')) hide(modal);
    };
  }
  // 증강 카드에 마우스를 올리면 그 카드가 맞힐 말을 띄워 보인다 (다시 그려도 끊기지 않게 창 전체에서 받는다)
  const augBar = $('augment-bar');
  augBar.onmouseover = (ev) => {
    const t = ev.target as HTMLElement;
    const card = t.closest<HTMLElement>('.augment-card');
    const pick = t.closest<HTMLElement>('[data-pick]');
    const key = card?.dataset.card ?? null;
    const horse = pick ? Number(pick.dataset.pick) : null;
    if (key === hoverCardKey && horse === hoverPick) return;
    hoverCardKey = key;
    hoverPick = horse;
    applyAugmentHighlight();
  };
  augBar.onmouseleave = () => {
    hoverCardKey = null;
    hoverPick = null;
    applyAugmentHighlight();
  };
  $('modal-odds').onclick = (ev) => {
    const t = ev.target as HTMLElement;
    if (t === $('modal-odds') || t.closest('[data-close]')) hide('modal-odds');
  };
  initAudio();
  // 한글 웹 글꼴은 글자 묶음별로 나뉘어 있어, 처음 보는 글자가 나오면 그때 내려받느라 잠깐 다른 글꼴로 보인다.
  // 경주 중에 뜨는 카드 이름과 설명의 글자를 미리 받아 둔다
  if (document.fonts?.load) {
    const cardText = AUGMENTS.map((a) => a.name + a.description).join('');
    for (const weight of [500, 800]) void document.fonts.load(`${weight} 16px "Gothic A1"`, cardText).catch(() => undefined);
  }
  bindSoundButtons();
  const savedName = localStorage.getItem('augment-derby-name');
  if (savedName) $<HTMLInputElement>('main-name').value = savedName;

  $('btn-goto-create').onclick = () => {
    // 방 이름을 비워 두면 쓰이는 이름을 미리 보여 준다
    $<HTMLInputElement>('create-name').placeholder = `${playerName()}의 경마장`;
    showScreen('scr-create');
  };
  $('btn-goto-join').onclick = () => {
    playerName();
    showScreen('scr-join');
    $<HTMLInputElement>('join-code').focus();
  };
  // 혼자 하기: NPC 5명과 6인전을 만들고 바로 시작한다
  const soloRounds = $<HTMLInputElement>('solo-rounds');
  // 방 설정은 다음에 열 때도 그대로 나오도록 이 브라우저에 기억한다
  const SETUP_KEY = 'augment-derby-setup';
  const savedSetup = ((): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  })();
  const remember = (key: string, value: string): void => {
    savedSetup[key] = value;
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(savedSetup));
    } catch {
      /* 저장할 수 없는 환경에서는 이번 접속 동안만 유지된다 */
    }
  };
  const restore = (input: HTMLInputElement, key: string): void => {
    const v = Number(savedSetup[key]);
    if (Number.isFinite(v) && v >= Number(input.min) && v <= Number(input.max)) input.value = String(v);
  };
  const coinText = (rounds: number): string => ROUND_COINS[rounds].toLocaleString('ko-KR');
  restore(soloRounds, 'soloRounds');
  const syncSolo = () => {
    remember('soloRounds', soloRounds.value);
    $('solo-rounds-label').textContent = `${soloRounds.value}라운드`;
    $('solo-coins').textContent = coinText(Number(soloRounds.value));
  };
  soloRounds.oninput = syncSolo;
  syncSolo();
  $('btn-goto-solo').onclick = () => {
    playerName();
    showScreen('scr-solo');
  };
  $('btn-solo-back').onclick = () => showScreen('scr-main');
  // 마구간 (내 말 꾸미기)
  initStableUi({ toast, onChange: refreshStableBadges });
  const gotoStable = () => {
    showScreen('scr-stable');
    openStable();
  };
  $('btn-goto-stable').onclick = gotoStable;
  $('btn-solo-stable').onclick = gotoStable;
  $('btn-stable-back').onclick = () => showScreen('scr-main');
  $('btn-stable-solo').onclick = () => {
    playerName();
    showScreen('scr-solo');
  };
  $('btn-solo-go').onclick = () => {
    net.send({
      type: 'CREATE_ROOM',
      playerName: playerName(),
      roomName: `${playerName()}의 혼자 하기`,
      isPrivate: true,
      maxPlayers: 6,
      totalRounds: Number(soloRounds.value),
      npcCount: 5,
      autoStart: true,
      myHorse: myHorseEntry()
    });
  };

  $('btn-howto').onclick = () => show('modal-howto');
  $('btn-howto-close').onclick = () => hide('modal-howto');

  // 방 생성 화면
  const roundsInput = $<HTMLInputElement>('create-rounds');
  const maxInput = $<HTMLInputElement>('create-max');
  const npcInput = $<HTMLInputElement>('create-npc');
  restore(roundsInput, 'rounds');
  restore(maxInput, 'max');
  restore(npcInput, 'npc');
  // 배팅 공개 방식: 둘 중 하나를 고르는 단추
  const blindSeg = $('create-blind');
  const BLIND_HELP: Record<string, string> = {
    open: '배팅이 끝나면 누가 어디에 걸었는지 모두에게 보여 줍니다.',
    blind: '라운드 결과가 나올 때까지 각자 자기 배팅만 볼 수 있습니다.'
  };
  const setBlind = (value: string): void => {
    blindSeg.querySelectorAll<HTMLElement>('button').forEach((b) => {
      const on = b.dataset.value === value;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    blindSeg.dataset.value = value;
    $('create-blind-help').textContent = BLIND_HELP[value];
    remember('blind', value);
  };
  blindSeg.querySelectorAll<HTMLElement>('button').forEach((b) => {
    b.onclick = () => setBlind(b.dataset.value!);
  });
  // 방향키로도 바꿀 수 있다 (라디오 묶음의 기본 조작)
  blindSeg.onkeydown = (ev) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    ev.preventDefault();
    setBlind(blindSeg.dataset.value === 'open' ? 'blind' : 'open');
    blindSeg.querySelector<HTMLElement>('button.active')?.focus();
  };
  setBlind(savedSetup.blind === 'blind' ? 'blind' : 'open');
  const syncCreate = () => {
    $('create-rounds-label').textContent = `${roundsInput.value}라운드`;
    $('create-max-label').textContent = `${maxInput.value}명`;
    $('create-coins').textContent = coinText(Number(roundsInput.value));
    npcInput.max = String(Number(maxInput.value) - 1);
    if (Number(npcInput.value) > Number(npcInput.max)) npcInput.value = npcInput.max;
    const npc = Number(npcInput.value);
    const seats = Number(maxInput.value) - npc;
    $('create-npc-label').textContent = npc === 0 ? '없음' : `${npc}명`;
    $('create-npc-max').textContent = `${npcInput.max}명`;
    $('create-seats').textContent = `사람은 나까지 ${seats}명 들어올 수 있습니다.`;
    remember('rounds', roundsInput.value);
    remember('max', maxInput.value);
    remember('npc', npcInput.value);
  };
  roundsInput.oninput = syncCreate;
  maxInput.oninput = syncCreate;
  npcInput.oninput = syncCreate;
  syncCreate();

  $('btn-create-back').onclick = () => showScreen('scr-main');
  $('btn-create-go').onclick = () => {
    net.send({
      type: 'CREATE_ROOM',
      playerName: playerName(),
      roomName: $<HTMLInputElement>('create-name').value || `${playerName()}의 경마장`,
      isPrivate: true,
      blindBets: $('create-blind').dataset.value === 'blind',
      maxPlayers: Number(maxInput.value),
      totalRounds: Number(roundsInput.value),
      npcCount: Number(npcInput.value)
    });
  };

  // 입력 칸에서 Enter를 누르면 그 화면의 주 동작을 실행한다
  $('create-name').onkeydown = (ev) => {
    if (ev.key === 'Enter') $('btn-create-go').click();
  };
  $('join-code').onkeydown = (ev) => {
    if (ev.key === 'Enter') $('btn-join-code').click();
  };

  // 방 참가 화면
  $('btn-join-back').onclick = () => showScreen('scr-main');
  $('btn-join-code').onclick = () => {
    const code = $<HTMLInputElement>('join-code').value.trim().toUpperCase();
    if (code.length < 4) return toast('초대 코드를 입력하세요.');
    net.send({ type: 'JOIN_ROOM', playerName: playerName(), code });
  };

  // 로비
  $('btn-lobby-leave').onclick = () => {
    net.send({ type: 'LEAVE_ROOM' });
    leaveToMain();
  };
  $('btn-npc-add').onclick = () => net.send({ type: 'ADD_NPC' });
  $('btn-npc-remove').onclick = () => net.send({ type: 'REMOVE_NPC' });
  $('btn-lobby-start').onclick = () => net.send({ type: 'START_GAME' });

  // 배팅
  const amountInput = $<HTMLInputElement>('bet-amount');
  $('btn-place-bet').onclick = () => {
    if (state.selHorse == null) return toast('말을 먼저 고르세요.');
    net.send({ type: 'PLACE_BET', betType: state.selBetType, horseId: state.selHorse, amount: Number(amountInput.value) });
    // 다음 마권을 새로 적을 수 있게 금액을 비운다
    amountInput.value = '0';
    updateBetSelInfo();
  };
  amountInput.oninput = updateBetSelInfo;
  document.querySelectorAll<HTMLElement>('.bet-quick').forEach((el) => {
    el.onclick = () => {
      amountInput.value = String(Number(amountInput.value || 0) + Number(el.dataset.add));
      updateBetSelInfo();
    };
  });
  $('bet-max').onclick = () => {
    const { limit, used } = betLimitNow();
    const max = Math.floor(Math.min(limit - used, state.coins) / 10) * 10;
    amountInput.value = String(Math.max(0, max));
    updateBetSelInfo();
  };
  // 금액 초기화
  $('bet-clear').onclick = () => {
    amountInput.value = '0';
    updateBetSelInfo();
  };
  $('btn-ready').onclick = () => {
    state.readySent = !state.readySent;
    if (state.readySent) sfx('ready');
    net.send({ type: 'READY', phase: state.phase === 'preview' ? 'preview' : 'betting', ready: state.readySent });
    renderBettingOverlay();
  };

  // 게임 중 나가기 — 실수 방지를 위해 3초 안에 두 번 눌러야 나간다
  const leaveBtn = $<HTMLButtonElement>('btn-game-leave');
  let leaveArmed: number | null = null;
  const resetLeave = () => {
    if (leaveArmed !== null) window.clearTimeout(leaveArmed);
    leaveArmed = null;
    leaveBtn.textContent = '나가기';
    leaveBtn.classList.remove('danger');
  };
  leaveBtn.onclick = () => {
    if (leaveArmed === null) {
      leaveBtn.textContent = '한 번 더 누르면 나갑니다';
      leaveBtn.classList.add('danger');
      leaveArmed = window.setTimeout(resetLeave, 3000);
      return;
    }
    resetLeave();
    net.send({ type: 'LEAVE_ROOM' });
    leaveToMain();
    toast('게임에서 나왔습니다.', false);
  };

  // 이모티콘
  $('emotes').innerHTML = EMOTES.map((e) => `<button data-emote="${e}">${e}</button>`).join('');
  document.querySelectorAll<HTMLElement>('#emotes button').forEach((el) => {
    el.onclick = () => net.send({ type: 'EMOTE', emoji: el.dataset.emote! });
  });
}

// ============ 시작 ============

net.onConnectionChange = (connected) => {
  $('conn-banner').classList.toggle('hidden', connected);
  $('conn-banner').textContent = '서버와 연결이 끊겼습니다. 다시 연결하는 중입니다.';
};

if (new URLSearchParams(location.search).has('showcase')) {
  // 확인용 화면: 서버 없이 말 종류와 변신 연출만 보여 준다
  import('./showcase').then((m) => m.startShowcase());
} else {
  bindUI();
  refreshStableBadges();
  document.body.dataset.screen = 'scr-main';
  startTitleBg();
  net.connect();
}

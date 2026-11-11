import type {
  AugmentCardView,
  AugmentTier,
  BetCount,
  Bet,
  BetType,
  HorseInfo,
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
  ROUND_COINS
} from '../../shared/src/constants';
import { AUGMENT_BY_ID, TARGET_TYPE_LABELS } from '../../shared/src/augments';
import { BREED_INFO, EMOTES } from '../../shared/src/names';
import { Net, loadToken, saveToken } from './net';
import { Race3DView, type CameraTarget } from './race3d';
import { claimGameBonus, claimRoundPrize, myHorseEntry, stable } from './stable';
import { closeStable, horseSummary, initStableUi, openStable } from './stableUi';

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
  if (id !== 'scr-stable') closeStable();
  refreshStableBadges();
  // 모바일 세로 화면에서는 게임 중에만 가로 모드 안내를 띄운다
  $('rotate-hint').classList.toggle('when-game', id === 'scr-game');
}

function toast(message: string, isError = true): void {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  $('toast-area').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function esc(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
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
  $('main-carrots').textContent = `🥕 ${stable().carrots}`;
  $('solo-horse-summary').textContent = horseSummary();
}

function isMyHorse(h: HorseInfo | undefined): boolean {
  return !!h && !!h.ownerId && h.ownerId === state.myId;
}

function horseName(id: number): string {
  const h = state.horses.find((x) => x.id === id);
  return h ? `${id}번 ${isMyHorse(h) ? '⭐' : ''}${h.name}` : `${id}번`;
}

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
  } catch (err) {
    // WebGL을 쓸 수 없는 기기 — 경주 화면 없이 배팅·결과만 진행된다
    viewFailed = true;
    console.error('3D 초기화 실패', err);
    $('race-canvas').innerHTML =
      '<p class="r3d-unsupported">이 기기 또는 브라우저는 3D 그래픽(WebGL)을 지원하지 않아 경주 화면을 표시할 수 없습니다.</p>';
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
    `<span class="cam-label">📷</span>` +
    `<button class="cam-leader${state.cameraSel === 'leader' ? ' active' : ''}" data-cam="leader" title="선두 따라가기">👑</button>` +
    state.horses
      .map(
        (h) =>
          `<button style="background:${h.color}" class="${state.cameraSel === h.id ? 'active' : ''}${isMyHorse(h) ? ' mine' : ''}" data-cam="${h.id}" title="${esc(h.name)}${isMyHorse(h) ? ' (내 말)' : ''}">${isMyHorse(h) ? '⭐' : ''}${h.id}</button>`
      )
      .join('') +
    `<button class="cam-mode" data-act="mode" title="카메라 시점 바꾸기">🎥 ${view?.viewModeLabel() ?? '중계'}</button>`;
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
  $('lobby-title').textContent = `🏠 ${state.settings.roomName}`;
  const codeEl = $('lobby-code');
  if (state.settings.isPrivate && state.roomId) {
    codeEl.textContent = `초대 코드: ${state.roomId}`;
    codeEl.classList.remove('hidden');
  } else if (state.roomId) {
    codeEl.textContent = `방 코드: ${state.roomId}`;
    codeEl.classList.remove('hidden');
  }
  $('lobby-settings').innerHTML = `
    <span class="chip">최대 ${state.settings.maxPlayers}명</span>
    <span class="chip">${state.settings.totalRounds}라운드</span>
    <span class="chip">시작 코인 ${ROUND_COINS[state.settings.totalRounds]}</span>
    <span class="chip">${state.settings.isPrivate ? '🔒 비공개' : '🌐 공개'}</span>
    ${state.settings.blindBets ? '<span class="chip">🙈 블라인드 배팅</span>' : ''}`;
  $('lobby-players').innerHTML = state.players
    .map(
      (p) => `
    <div class="lobby-player${p.isHost ? ' host' : ''}">
      <span class="dot${p.connected || p.isNpc ? '' : ' off'}"></span>
      <span>${p.isHost ? '👑 ' : ''}${esc(p.name)}${p.id === state.myId ? ' (나)' : ''}</span>
    </div>`
    )
    .join('');
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
        <span class="${off ? 'off' : ''}">${p.isHost ? '👑' : ''}${esc(p.name)}${off ? ' (연결 끊김)' : ''}</span>
        <b>💰${p.coins}</b>
      </div>`;
    })
    .join('');
}

/** 블라인드 방이고 아직 라운드 결과 전이면 남의 배팅은 볼 수 없다 */
function betsHidden(): boolean {
  return !!state.settings?.blindBets && state.phase !== 'roundResult' && state.phase !== 'gameResult';
}

function renderSideBets(): void {
  const blindNote = betsHidden()
    ? '<p class="muted">🙈 블라인드 배팅 — 다른 사람의 배팅은 라운드 결과에서 공개됩니다.</p>'
    : '';
  if (state.revealed.length === 0) {
    $('side-bets').innerHTML = blindNote || '<p class="muted">아직 공개 전</p>';
    return;
  }
  $('side-bets').innerHTML = blindNote + state.revealed
    .map(
      (b) => `<div class="side-bet">
        <b>${esc(b.playerName)}</b> — ${BET_TYPE_INFO[b.type].label}
        <span style="color:${horseColor(b.horseId)}">●</span>${esc(horseName(b.horseId))}
        <br/>💰${b.amount} (배당 ×${b.odds.toFixed(2)})
      </div>`
    )
    .join('');
}

// ============ 배팅 화면 ============

function renderBettingOverlay(): void {
  const isBetting = state.phase === 'betting';
  $('betting-title').textContent = isBetting
    ? `💰 배팅 시간! (라운드 ${state.round}/${state.totalRounds})`
    : `🐎 출전마 확인 (라운드 ${state.round}/${state.totalRounds})`;

  renderHorseCards();
  renderBetTabs();
  renderMyBets();

  const controls = $('bet-controls');
  controls.style.opacity = isBetting ? '1' : '0.45';
  controls.style.pointerEvents = isBetting ? 'auto' : 'none';

  const btn = $<HTMLButtonElement>('btn-ready');
  btn.disabled = state.readySent;
  btn.textContent = state.readySent
    ? '다른 플레이어를 기다리는 중...'
    : isBetting
      ? '배팅 마감 ✔ (모두 완료 시 바로 시작)'
      : '능력치 확인 완료 ✔';
  show('overlay-betting');
}

function statBar(label: string, value: number, color: string): string {
  return `<div class="statbar">
    <span class="sb-label">${label}</span>
    <span class="sb-track"><span class="sb-fill" style="width:${value}%;background:${color}"></span></span>
    <span class="sb-val">${value}</span>
  </div>`;
}

function renderHorseCards(): void {
  $('horse-cards').innerHTML = state.horses
    .map((h) => {
      const odds = state.odds[h.id];
      return `<div class="horse-card${state.selHorse === h.id ? ' selected' : ''}${isMyHorse(h) ? ' mine' : ''}" data-horse="${h.id}">
        <div class="hc-head">
          <span class="hc-chip" style="background:${h.color}"></span>
          <b>${h.id}번 ${esc(h.name)}</b>
          ${isMyHorse(h) ? '<span class="hc-mine">⭐ 내 말</span>' : ''}
          ${h.breed && h.breed !== 'horse' ? `<span class="hc-breed">${BREED_INFO[h.breed].emoji} ${BREED_INFO[h.breed].label}</span>` : ''}
        </div>
        ${statBar('속력', h.stats.speed, '#ef4565')}
        ${statBar('가속', h.stats.accel, '#ff8906')}
        ${statBar('지구력', h.stats.stamina, '#2cb67d')}
        <div class="hc-extra">⚖️ ${h.stats.weight}kg &nbsp; 🍀 행운 ${h.stats.luck}</div>
        <div class="hc-odds">
          <span>${BET_TYPE_INFO[state.selBetType].label} 배당</span>
          <b>×${odds ? odds[state.selBetType].toFixed(2) : '-'}</b>
        </div>
      </div>`;
    })
    .join('');
  document.querySelectorAll<HTMLElement>('.horse-card').forEach((el) => {
    el.onclick = () => {
      state.selHorse = Number(el.dataset.horse);
      renderHorseCards();
      updateBetSelInfo();
    };
  });
}

function renderBetTabs(): void {
  $('bet-type-tabs').innerHTML = (Object.keys(BET_TYPE_INFO) as BetType[])
    .map(
      (t) =>
        `<button class="bet-tab${state.selBetType === t ? ' active' : ''}" data-type="${t}">
          ${BET_TYPE_INFO[t].label}<span style="font-size:11px"> · ${BET_TYPE_INFO[t].desc}</span>
        </button>`
    )
    .join('');
  document.querySelectorAll<HTMLElement>('.bet-tab').forEach((el) => {
    el.onclick = () => {
      state.selBetType = el.dataset.type as BetType;
      renderBetTabs();
      renderHorseCards();
      updateBetSelInfo();
    };
  });
  updateBetSelInfo();
}

function betLimitNow(): { limit: number; used: number } {
  const limit = Math.floor(state.bettingBaseCoins * BET_LIMIT_RATIO);
  const used = state.myBets.reduce((s, b) => s + b.amount, 0);
  return { limit, used };
}

function updateBetSelInfo(): void {
  const { limit, used } = betLimitNow();
  $('bet-limit-info').textContent =
    `라운드 배팅 한도: ${used} / ${limit} 코인 (보유 코인의 ${BET_LIMIT_RATIO * 100}%) · 최소 ${BET_MIN}코인 · 보유 💰${state.coins}`;
  const info = $('bet-selected-info');
  if (state.selHorse == null) {
    info.textContent = '말을 선택하세요';
  } else {
    const odds = state.odds[state.selHorse]?.[state.selBetType];
    info.innerHTML = `<b>${BET_TYPE_INFO[state.selBetType].label}</b> · <b style="color:${horseColor(state.selHorse)}">${esc(horseName(state.selHorse))}</b> ×${odds?.toFixed(2) ?? '-'}`;
  }
}

function renderMyBets(): void {
  if (state.myBets.length === 0) {
    $('my-bets').innerHTML = '<p class="muted">아직 배팅하지 않았습니다.</p>';
    return;
  }
  $('my-bets').innerHTML = state.myBets
    .map(
      (b) => `<div class="my-bet-item">
        <span>${BET_TYPE_INFO[b.type].label} · ${esc(horseName(b.horseId))} · 💰${b.amount} (×${b.odds.toFixed(2)})</span>
        ${state.phase === 'betting' ? `<button data-bet="${b.betId}">취소</button>` : ''}
      </div>`
    )
    .join('');
  document.querySelectorAll<HTMLElement>('.my-bet-item button').forEach((el) => {
    el.onclick = () => net.send({ type: 'CANCEL_BET', betId: el.dataset.bet! });
  });
}

// ============ 증강 UI ============

function renderAugmentBar(): void {
  const aug = state.augment;
  const bar = $('augment-bar');
  view?.setBottomInset(!!aug && !aug.used);
  $('race-wrap').classList.toggle('augment-open', !!aug && !aug.used);
  if (!aug) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  if (aug.used) {
    bar.innerHTML = `<div class="augment-used-msg">✅ 증강 사용 완료! 경주를 지켜보세요...</div>`;
    return;
  }

  const tierInfo = TIER_INFO[aug.tier];
  const head = `<div class="augment-head">
      <b>⚡ ${aug.phase}차 증강 · <span class="aug-tier-chip" style="background:${tierInfo.color}">${tierInfo.emoji} ${tierInfo.label}</span> 카드 1장을 고르세요 (경주는 계속됩니다!)</b>
      <span id="augment-remain"></span>
    </div>
    <div class="augment-timebar"><div id="augment-timefill" style="width:100%"></div></div>`;

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
              `<button class="btn small" style="background:${h.color};color:#fff" data-pick="${h.id}" data-key="${c.cardKey}">${h.id}번</button>`
          )
          .join('')}</div>`;
      } else if (selected) {
        pickRow = `<div class="augment-pickhorse"><button class="btn small" data-confirm="${c.cardKey}">사용 확정!</button></div>`;
      }
      return `<div class="augment-card${selected ? ' selected' : ''}" data-card="${c.cardKey}" style="border-color:${rar.color};${aug.pending ? 'opacity:0.5;pointer-events:none' : ''}">
        <span class="aug-rarity" style="background:${rar.color}">${rar.emoji} ${rar.label}</span>
        <div class="aug-emoji">${def.emoji}</div>
        <div class="aug-name">${esc(def.name)}</div>
        <div class="aug-desc">${esc(def.description)}</div>
        <div class="aug-target">🎯 ${TARGET_TYPE_LABELS[def.targetType] ?? ''}</div>
        ${pickRow}
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
    toast(`🥕 내 말 ${prize.rank}위! 당근 +${prize.carrots}`, false);
  }
  const prizeHtml = prize
    ? `<div class="carrot-row">⭐ 내 말 <b>${esc(prize.horseName)}</b> ${prize.rank}위 — 상금 <b>🥕 +${prize.carrots}</b> <span class="muted">(보유 🥕 ${stable().carrots})</span></div>`
    : '';
  const rankingHtml = (state.rankings ?? [])
    .map((r) => {
      return `<div class="result-horse${r.rank === 1 ? ' first' : ''}">
        <div style="font-size:22px">${r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}위`}</div>
        <div style="color:${horseColor(r.horseId)}">●</div>
        <div>${esc(horseName(r.horseId))}</div>
        <div class="muted">${(r.timeMs / 1000).toFixed(2)}초</div>
      </div>`;
    })
    .join('');

  const rows = data.results
    .flatMap((res) => {
      if (res.bets.length === 0) {
        return [
          `<tr><td>${esc(res.playerName)}</td><td colspan="3" class="muted">배팅 없음</td><td>${res.coins}</td></tr>`
        ];
      }
      return res.bets.map(
        (b, i) => `<tr>
          <td>${i === 0 ? esc(res.playerName) : ''}</td>
          <td>${BET_TYPE_INFO[b.type].label} · ${esc(horseName(b.horseId))} · ${b.amount}</td>
          <td>${b.hit ? '✅ 적중' : '❌ 실패'}</td>
          <td class="${b.payout - b.amount >= 0 ? 'pos' : 'neg'}">${b.hit ? `+${b.payout - b.amount}` : `-${b.amount}`}</td>
          <td>${i === 0 ? res.coins : ''}</td>
        </tr>`
      );
    })
    .join('');

  const standingsHtml = data.standings
    .map(
      (s) => `<div class="standing-row${s.playerId === state.myId ? ' me' : ''}${s.rank === 1 ? ' first' : ''}">
        <span>${s.rank}위 ${esc(s.name)}</span><b>💰${s.coins}</b>
      </div>`
    )
    .join('');

  const hostBtn = isHost()
    ? `<button id="btn-next-round" class="btn big">${data.isFinal ? '🏆 최종 결과 보기' : '▶ 다음 라운드'}</button>`
    : '<p class="muted center">방장이 진행하길 기다리는 중...</p>';

  $('result-inner').innerHTML = `
    <h2>🏁 라운드 ${data.round} 결과</h2>
    <div class="result-rankings">${rankingHtml}</div>
    ${prizeHtml}
    <h3>배팅 정산</h3>
    <table class="result-table">
      <tr><th>플레이어</th><th>배팅</th><th>결과</th><th>손익</th><th>보유</th></tr>
      ${rows}
    </table>
    <h3>현재 순위</h3>
    ${standingsHtml}
    <div class="center">${hostBtn}</div>`;
  show('overlay-result');
  const btn = document.getElementById('btn-next-round');
  if (btn) btn.onclick = () => net.send({ type: 'NEXT_ROUND' });
}

function renderGameResult(data: { standings: Standing[]; awards: Award[]; ownerBonus?: OwnerBonus }): void {
  const medals = ['🥇', '🥈', '🥉'];
  // 게임 종료 당근 보너스 — 한 번만 받는다
  const bonus = data.ownerBonus && data.ownerBonus.playerId === state.myId ? data.ownerBonus : null;
  if (bonus && claimGameBonus(bonus)) {
    toast(`🥕 게임 보너스! 당근 +${bonus.placementCarrots + bonus.profitCarrots}`, false);
  }
  const bonusHtml = bonus
    ? `<h3>🥕 당근 정산</h3>
      <div class="carrot-box">
        <div><span>내 말 순위 상금 (라운드 합계)</span><b>+${bonus.roundCarrots}</b></div>
        <div><span>최종 ${bonus.placement}위 보너스</span><b>+${bonus.placementCarrots}</b></div>
        <div><span>배팅 순이익 보너스 (순이익의 10%)</span><b>+${bonus.profitCarrots}</b></div>
        <div class="carrot-total"><span>이번 게임에서 번 당근</span><b>🥕 +${
          bonus.roundCarrots + bonus.placementCarrots + bonus.profitCarrots
        }</b></div>
        <div class="muted">지금 보유: 🥕 ${stable().carrots}</div>
      </div>`
    : '';
  const standingsHtml = data.standings
    .map(
      (s) => `<div class="standing-row${s.playerId === state.myId ? ' me' : ''}${s.rank === 1 ? ' first' : ''}">
        <span>${s.rank <= 3 ? medals[s.rank - 1] : `${s.rank}위`} ${esc(s.name)}
        <span class="muted">적중 ${s.hits}회 · 순손익 ${s.netProfit >= 0 ? '+' : ''}${s.netProfit}</span></span>
        <b>💰${s.coins}</b>
      </div>`
    )
    .join('');
  const awardsHtml = data.awards
    .map(
      (a) =>
        `<div class="award-row"><b>${esc(a.title)}</b> — ${esc(a.playerName)} <span class="muted">(${esc(a.detail)})</span></div>`
    )
    .join('');
  const hostBtn = isHost()
    ? '<button id="btn-restart" class="btn big">🔄 같은 방에서 다시 하기</button>'
    : '<p class="muted center">방장이 다시 시작할 수 있습니다.</p>';

  $('result-inner').innerHTML = `
    <h2>🏆 최종 결과</h2>
    ${standingsHtml}
    ${bonusHtml}
    ${data.awards.length ? '<h3>🎖 재미있는 기록</h3>' + awardsHtml : ''}
    <div class="btn-row center" style="justify-content:center">
      ${hostBtn}
      ${bonus ? '<button id="btn-to-stable" class="btn big stable">🐴 마구간 가기</button>' : ''}
      <button id="btn-to-main" class="btn big ghost">🚪 나가기</button>
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
  state.roomId = null;
  state.phase = 'lobby';
  const tok = loadToken();
  if (tok) saveToken({ ...tok, roomId: null });
  hide('overlay-result');
  hide('overlay-betting');
  hide('overlay-reveal');
  hide('overlay-countdown');
  // 게임 도중에 나가는 경우를 위해 진행 중이던 화면 상태를 모두 비운다
  state.augment = null;
  state.horses = [];
  state.myBets = [];
  state.revealed = [];
  state.rankings = null;
  $('augment-bar').classList.add('hidden');
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
  preview: '🐎 출전마 확인',
  betting: '💰 배팅 중',
  reveal: '👀 배팅 공개',
  countdown: '🚦 곧 출발!',
  racing: '🏇 경주 중!',
  roundResult: '🏁 라운드 결과',
  gameResult: '🏆 최종 결과'
};

function updateTopbar(): void {
  $('top-round').textContent = state.round > 0 ? `라운드 ${state.round}/${state.totalRounds}` : '';
  $('top-phase').textContent = PHASE_LABELS[state.phase];
  $('top-coins').textContent = `💰 ${state.coins}`;
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
        state.augment = { ...snap.augment, selectedKey: null, pending: false };
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

function renderRevealOverlay(): void {
  const blind = betsHidden();
  const title = document.querySelector('#overlay-reveal h2');
  if (title) title.textContent = blind ? '🙈 블라인드 배팅 — 내용은 비밀!' : '👀 전체 배팅 공개!';
  $('reveal-list').innerHTML = state.players
    .map((p) => {
      const bets = state.revealed.filter((b) => b.playerId === p.id);
      const name = p.name + (p.id === state.myId ? ' (나)' : '');
      const count = state.betCounts.find((c) => c.playerId === p.id)?.count ?? bets.length;
      const hiddenFromMe = blind && p.id !== state.myId;
      const betsHtml = hiddenFromMe
        ? count === 0
          ? '<span class="muted">배팅 없음</span>'
          : `🙈 배팅 ${count}건 <span class="muted">(결과 발표 때 공개)</span>`
        : bets.length === 0
          ? '<span class="muted">배팅 없음 (소심한가 봐요)</span>'
          : bets
              .map(
                (b) =>
                  `${BET_TYPE_INFO[b.type].label} <b style="color:${horseColor(b.horseId)}">${esc(horseName(b.horseId))}</b> 💰${b.amount} (×${b.odds.toFixed(2)})`
              )
              .join(' · ');
      return `<div class="reveal-player"><div class="rp-name">🎫 ${esc(name)}</div><div class="rp-bets">${betsHtml}</div></div>`;
    })
    .join('');
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

    case 'ROOM_LIST': {
      const list = $('room-list');
      if (msg.rooms.length === 0) {
        list.innerHTML = '<p class="muted">공개 방이 없습니다. 직접 만들어 보세요!</p>';
      } else {
        list.innerHTML = msg.rooms
          .map(
            (r) => `<div class="room-item">
              <span><b>${esc(r.name)}</b> <span class="muted">${r.players}/${r.maxPlayers}명 · ${r.totalRounds}라운드</span></span>
              <button class="btn small" data-room="${r.id}">참가</button>
            </div>`
          )
          .join('');
        list.querySelectorAll<HTMLElement>('button[data-room]').forEach((el) => {
          el.onclick = () =>
            net.send({ type: 'JOIN_ROOM', playerName: playerName(), roomId: el.dataset.room! });
        });
      }
      break;
    }

    case 'ROOM_UPDATE': {
      state.players = msg.players;
      state.settings = msg.settings;
      if (state.phase === 'lobby') renderLobby();
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
      addLog(`🎮 게임 시작! ${msg.totalRounds}라운드 · 시작 코인 ${msg.startCoins}`);
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
      view?.setCameraTarget('leader');
      renderCameraSelect();
      renderBettingOverlay();
      renderSideBets();
      addLog(`🐎 라운드 ${msg.round} 시작! 출전마가 공개되었습니다.`);
      const myHorse = msg.horses.find((h) => isMyHorse(h));
      if (myHorse) {
        addLog(`⭐ 내 말 <b>${esc(myHorse.name)}</b> — 이번에는 ${myHorse.id}번으로 출전!`, 'log-good');
      }
      for (const t of msg.topUps) {
        addLog(`💝 ${esc(t.playerName)} 코인 부족 구제 +${t.amount}`, 'log-good');
      }
      updateTopbar();
      break;
    }

    case 'BETTING_START': {
      state.phase = 'betting';
      state.phaseEndsAt = msg.endsAt;
      state.bettingBaseCoins = state.coins;
      state.readySent = false;
      renderBettingOverlay();
      updateTopbar();
      break;
    }

    case 'BET_ACCEPTED': {
      state.myBets.push(msg.bet);
      state.coins = msg.coins;
      renderMyBets();
      updateBetSelInfo();
      updateTopbar();
      break;
    }

    case 'BET_CANCELED': {
      state.myBets = state.myBets.filter((b) => b.betId !== msg.betId);
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
      addLog('🏇 경주 시작!');
      view?.announce('🏇 출발!!');
      updateTopbar();
      break;
    }

    case 'RACE_STATE': {
      view?.pushState(msg.horses);
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
        pending: false
      };
      renderAugmentBar();
      {
        const tierInfo = TIER_INFO[msg.tier];
        const tierColor = { silver: '#dee2e6', gold: '#ffd43b', platinum: '#66d9e8' }[msg.tier];
        view?.announce(`⚡ ${msg.phase}차 증강 — ${tierInfo.emoji} ${tierInfo.label}!`, tierColor);
        addLog(`⚡ ${msg.phase}차 증강: <b>${tierInfo.emoji} ${tierInfo.label}</b> 등급 (모두 같은 등급, 카드는 각자 다름)`, 'log-augment');
      }
      break;
    }

    case 'AUGMENT_CLOSED': {
      if (state.augment && !state.augment.used) {
        addLog('⏰ 증강 선택 시간이 끝났습니다.', 'log-augment');
      }
      state.augment = null;
      renderAugmentBar();
      break;
    }

    case 'AUGMENT_RESULT': {
      if (!state.augment) break;
      if (msg.ok) {
        state.augment.used = true;
        state.augment.pending = false;
      } else {
        state.augment.pending = false;
        state.augment.selectedKey = null;
        toast(msg.message ?? '카드를 사용할 수 없습니다. 다른 카드를 선택하세요.');
      }
      renderAugmentBar();
      break;
    }

    case 'AUGMENT_USED': {
      const def = AUGMENT_BY_ID[msg.defId];
      if (!def) break;
      const targetNames = msg.targets.map((id) => horseName(id)).join(', ');
      const blockedNames = msg.blocked.map((id) => horseName(id)).join(', ');
      let line = `${def.emoji} <b>${esc(msg.playerName)}</b> ▶ <b>${esc(def.name)}</b>`;
      if (targetNames) line += ` → ${esc(targetNames)}`;
      if (blockedNames) line += ` <span class="log-bad">(${esc(blockedNames)} 방어!)</span>`;
      addLog(line, def.hostile ? 'log-bad' : 'log-good');
      view?.announce(`${def.emoji} ${msg.playerName}: ${def.name}!`, def.hostile ? '#ef4565' : '#2cb67d');
      view?.flashHorses(msg.targets, !def.hostile);
      break;
    }

    case 'RACE_FINISH': {
      state.rankings = msg.rankings;
      state.augment = null;
      renderAugmentBar();
      view?.showFinish(msg.rankings);
      const first = msg.rankings.find((r) => r.rank === 1);
      if (first) addLog(`🏁 경주 종료! 우승: <b>${esc(horseName(first.horseId))}</b>`);
      break;
    }

    case 'ROUND_RESULT': {
      state.phase = 'roundResult';
      const mine = msg.results.find((r) => r.playerId === state.myId);
      if (mine) state.coins = mine.coins;
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
      renderGameResult(msg);
      updateTopbar();
      break;
    }

    case 'EMOTE': {
      view?.showEmote(msg.playerName, msg.emoji);
      addLog(`${msg.emoji} ${esc(msg.playerName)}`);
      break;
    }

    case 'ROOM_CLOSED': {
      toast(`방이 닫혔습니다: ${msg.reason}`);
      leaveToMain();
      break;
    }
  }
});

// ============ 타이머 루프 ============

setInterval(() => {
  const remain = Math.max(0, state.phaseEndsAt - Date.now());
  const sec = Math.ceil(remain / 1000);

  if (['preview', 'betting', 'reveal', 'countdown'].includes(state.phase)) {
    $('top-timer').textContent = `⏱ ${sec}초`;
  } else {
    $('top-timer').textContent = '';
  }

  if (state.phase === 'preview' || state.phase === 'betting') {
    $('betting-timer').textContent = `⏱ ${sec}초`;
  }

  if (state.phase === 'countdown') {
    const n = Math.ceil(remain / 1000);
    $('overlay-countdown').textContent = n > 0 ? String(n) : 'GO!';
  }

  const aug = state.augment;
  if (aug && !aug.used) {
    const augRemain = Math.max(0, aug.endsAt - Date.now());
    const el = document.getElementById('augment-remain');
    if (el) el.textContent = `${(augRemain / 1000).toFixed(1)}초`;
    const fill = document.getElementById('augment-timefill');
    if (fill) {
      const total = aug.phase === 1 ? 7000 : aug.phase === 2 ? 6000 : 5000;
      fill.style.width = `${Math.max(0, (augRemain / total) * 100)}%`;
    }
  }
}, 150);

// ============ 버튼 바인딩 ============

function bindUI(): void {
  const savedName = localStorage.getItem('augment-derby-name');
  if (savedName) $<HTMLInputElement>('main-name').value = savedName;

  $('btn-goto-create').onclick = () => {
    playerName();
    showScreen('scr-create');
  };
  $('btn-goto-join').onclick = () => {
    playerName();
    showScreen('scr-join');
    net.send({ type: 'LIST_ROOMS' });
  };
  // 혼자 하기: NPC 5명과 6인전을 만들고 바로 시작한다
  const soloRounds = $<HTMLInputElement>('solo-rounds');
  const syncSolo = () => {
    $('solo-rounds-label').textContent = `${soloRounds.value}라운드`;
    $('solo-coins').textContent = String(ROUND_COINS[Number(soloRounds.value)]);
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
  const syncCreate = () => {
    $('create-rounds-label').textContent = `${roundsInput.value}라운드`;
    $('create-max-label').textContent = `${maxInput.value}명`;
    $('create-coins').textContent = String(ROUND_COINS[Number(roundsInput.value)]);
    npcInput.max = String(Number(maxInput.value) - 1);
    if (Number(npcInput.value) > Number(npcInput.max)) npcInput.value = npcInput.max;
    $('create-npc-label').textContent = npcInput.value;
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
      isPrivate: $<HTMLSelectElement>('create-private').value === 'private',
      blindBets: $<HTMLSelectElement>('create-blind').value === 'blind',
      maxPlayers: Number(maxInput.value),
      totalRounds: Number(roundsInput.value),
      npcCount: Number(npcInput.value)
    });
  };

  // 방 참가 화면
  $('btn-join-back').onclick = () => showScreen('scr-main');
  $('btn-refresh-rooms').onclick = () => net.send({ type: 'LIST_ROOMS' });
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
  $('btn-place-bet').onclick = () => {
    if (state.selHorse == null) return toast('말을 먼저 선택하세요!');
    const amount = Number($<HTMLInputElement>('bet-amount').value);
    net.send({ type: 'PLACE_BET', betType: state.selBetType, horseId: state.selHorse, amount });
  };
  document.querySelectorAll<HTMLElement>('.bet-quick').forEach((el) => {
    el.onclick = () => {
      const input = $<HTMLInputElement>('bet-amount');
      input.value = String(Number(input.value || 0) + Number(el.dataset.add));
    };
  });
  $('bet-max').onclick = () => {
    const { limit, used } = betLimitNow();
    const max = Math.floor(Math.min(limit - used, state.coins) / 10) * 10;
    $<HTMLInputElement>('bet-amount').value = String(Math.max(0, max));
  };
  $('btn-ready').onclick = () => {
    state.readySent = true;
    net.send({ type: 'READY', phase: state.phase === 'preview' ? 'preview' : 'betting' });
    renderBettingOverlay();
  };

  // 게임 중 나가기 — 실수 방지를 위해 3초 안에 두 번 눌러야 나간다
  const leaveBtn = $<HTMLButtonElement>('btn-game-leave');
  let leaveArmed: number | null = null;
  const resetLeave = () => {
    if (leaveArmed !== null) window.clearTimeout(leaveArmed);
    leaveArmed = null;
    leaveBtn.textContent = '🚪 나가기';
    leaveBtn.classList.remove('danger');
  };
  leaveBtn.onclick = () => {
    if (leaveArmed === null) {
      leaveBtn.textContent = '정말 나갈까요? 한 번 더!';
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
  $('conn-banner').textContent = '서버 연결이 끊어졌습니다. 재연결 중...';
};

if (new URLSearchParams(location.search).has('showcase')) {
  // 확인용 화면: 서버 없이 말 종류와 변신 연출만 보여 준다
  import('./showcase').then((m) => m.startShowcase());
} else {
  bindUI();
  refreshStableBadges();
  net.connect();
}

import type { AdminRoom, AdminState, AdminUser, C2S, RoomPhase, S2C } from '../../shared/src/types';
import { SERVER_PORT } from '../../shared/src/constants';
import { esc } from './text';

// ============================================================
// 관리자 화면 — 게임과 같은 WebSocket으로 서버에 붙어 비밀번호를 맞힌 뒤
// 방 목록, 접속자, 서버 상태를 3초마다 받아 그린다. 접속자에게 당근을 보낼 수 있다.
// 비밀번호는 이 탭의 메모리에만 둔다 (새로고침하면 다시 입력).
// ============================================================

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const PHASE_LABEL: Record<RoomPhase, string> = {
  lobby: '대기실',
  preview: '출마표',
  betting: '배팅',
  reveal: '배팅 공개',
  countdown: '출발 준비',
  racing: '경주 중',
  roundResult: '라운드 결과',
  gameResult: '최종 결과'
};
/** 게임이 진행 중인 단계 (대기실과 최종 결과는 쉬는 중) */
const PLAYING = new Set<RoomPhase>(['preview', 'betting', 'reveal', 'countdown', 'racing', 'roundResult']);
const REFRESH_MS = 3000;

let ws: WebSocket | null = null;
let password = '';
let loggedIn = false;
let last: AdminState | null = null;
/** 서버 시계와 이 컴퓨터 시계의 차이 (경과 시간을 서버 기준으로 센다) */
let clockSkew = 0;
let lastAt = 0;
let refreshTimer: number | null = null;
let giftTarget: AdminUser | null = null;

function send(msg: C2S): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect(): void {
  const url = import.meta.env.DEV
    ? `ws://${location.hostname}:${SERVER_PORT}`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    setConn('연결됨');
    // 끊겼다 다시 붙으면 같은 비밀번호로 다시 들어간다
    if (password) send({ type: 'ADMIN_LOGIN', password });
  };
  sock.onmessage = (ev) => {
    let msg: S2C;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    onMessage(msg);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    setConn('연결이 끊겼습니다. 다시 붙는 중…', true);
    window.setTimeout(connect, 2000);
  };
}

function onMessage(msg: S2C): void {
  switch (msg.type) {
    case 'ADMIN_OK':
      loggedIn = true;
      $('login').hidden = true;
      $('board').hidden = false;
      $<HTMLButtonElement>('login-go').disabled = false;
      startRefresh();
      break;
    case 'ADMIN_DENIED':
      loggedIn = false;
      password = '';
      stopRefresh();
      $('board').hidden = true;
      $('login').hidden = false;
      $('login-msg').textContent = msg.message;
      $<HTMLButtonElement>('login-go').disabled = false;
      $<HTMLInputElement>('login-pw').select();
      break;
    case 'ADMIN_STATE':
      last = msg.state;
      lastAt = Date.now();
      clockSkew = msg.state.now - lastAt;
      render(msg.state);
      break;
    case 'ADMIN_RESULT':
      if (msg.ok) {
        ($('gift') as HTMLDialogElement).close();
        toast(msg.message);
      } else {
        $('gift-msg').textContent = msg.message;
      }
      $<HTMLButtonElement>('gift-go').disabled = false;
      break;
  }
}

function startRefresh(): void {
  stopRefresh();
  refreshTimer = window.setInterval(() => {
    // 탭이 가려져 있으면 쉬었다가, 다시 보이면 곧바로 받는다
    if (document.visibilityState === 'visible') send({ type: 'ADMIN_REFRESH' });
    tickClock();
  }, REFRESH_MS);
}
function stopRefresh(): void {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = null;
}
document.addEventListener('visibilitychange', () => {
  if (loggedIn && document.visibilityState === 'visible') send({ type: 'ADMIN_REFRESH' });
});

// ---------------- 그리기 ----------------

/** 3분 12초 / 2시간 5분 / 3일 4시간 */
function span(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}일 ${h}시간`;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s % 60}초`;
  return `${s}초`;
}
const serverNow = (): number => Date.now() + clockSkew;
const num = (n: number): string => n.toLocaleString('ko-KR');

function render(st: AdminState): void {
  const playing = st.rooms.filter((r) => PLAYING.has(r.phase)).length;
  $('st-conn').textContent = num(st.connections);
  $('st-rooms').textContent = num(st.rooms.length);
  $('st-playing').textContent = st.rooms.length ? `게임 중 ${playing}` : '';
  $('st-created').textContent = num(st.roomsCreated);
  $('st-total').textContent = num(st.connectionsTotal);
  $('st-gifts').textContent = num(st.giftsSent);
  $('st-mem').textContent = st.memoryMB != null ? `메모리 ${st.memoryMB}MB` : '';
  tickClock();
  renderUsers(st.users);
  renderRooms(st.rooms);
}

/** 가동 시간과 "몇 초 전에 받음"만 1초 단위로 다시 쓴다 */
function tickClock(): void {
  if (!last) return;
  $('st-up').textContent = span(serverNow() - last.startedAt);
  const ago = Math.round((Date.now() - lastAt) / 1000);
  setConn(ago <= 1 ? '방금 받음' : `${ago}초 전에 받음`, ago > 10);
}

function setConn(text: string, warn = false): void {
  const el = $('conn');
  el.textContent = text;
  el.classList.toggle('warn', warn);
}

function renderUsers(users: AdminUser[]): void {
  const box = $('users');
  if (users.length === 0) {
    box.innerHTML = '<p class="empty">지금 접속한 사람이 없습니다.</p>';
    return;
  }
  box.innerHTML = `<table class="tbl">
    <thead><tr><th>이름</th><th class="r">당근</th><th>있는 곳</th><th class="r">접속</th><th></th></tr></thead>
    <tbody>${users
      .map(
        (u) => `<tr>
        <td class="name">${u.name ? esc(u.name) : '<span class="muted">이름 모름</span>'}</td>
        <td class="r num">${u.carrots != null ? num(u.carrots) : '<span class="muted">-</span>'}</td>
        <td class="where">${u.roomId ? `<span class="code">${esc(u.roomId)}</span> ${esc(u.roomName ?? '')}` : '<span class="muted">메인 화면</span>'}</td>
        <td class="r muted">${span(serverNow() - u.connectedAt)}</td>
        <td class="r"><button class="btn small" type="button" data-gift="${esc(u.sid)}">당근 보내기</button></td>
      </tr>`
      )
      .join('')}</tbody></table>`;
  box.querySelectorAll<HTMLButtonElement>('[data-gift]').forEach((b) => {
    b.onclick = () => openGift(users.find((u) => u.sid === b.dataset.gift) ?? null);
  });
}

function renderRooms(rooms: AdminRoom[]): void {
  const box = $('rooms');
  if (rooms.length === 0) {
    box.innerHTML = '<p class="empty">열린 방이 없습니다.</p>';
    return;
  }
  box.innerHTML = rooms
    .map((r) => {
      const kind = r.solo ? '혼자 하기' : r.isPrivate ? '초대 전용' : '공개';
      const round = r.round > 0 ? `${r.round}/${r.totalRounds}라운드` : `${r.totalRounds}라운드`;
      const humans = r.players.filter((p) => !p.isNpc);
      return `<article class="room${PLAYING.has(r.phase) ? ' live' : ''}">
        <header>
          <span class="code big">${esc(r.id)}</span>
          <div class="room-title">
            <b>${esc(r.name)}</b>
            <span class="muted">${kind}${r.blindBets ? ', 블라인드' : ''}, ${round}, ${span(serverNow() - r.createdAt)} 전에 만듦</span>
          </div>
          <span class="phase phase-${r.phase}">${PHASE_LABEL[r.phase]}</span>
        </header>
        <ul class="players">${r.players
          .map(
            (p) => `<li class="${p.connected ? '' : 'off'}">
              <span class="pname">${esc(p.name)}</span>
              ${p.isHost ? '<span class="tag">방장</span>' : ''}${p.isNpc ? '<span class="tag npc">NPC</span>' : ''}${p.connected ? '' : '<span class="tag off">끊김</span>'}
              <span class="coins num">${num(p.coins)}</span>
            </li>`
          )
          .join('')}</ul>
        <p class="room-foot muted">사람 ${humans.length}명, NPC ${r.players.length - humans.length}명</p>
      </article>`;
    })
    .join('');
}

// ---------------- 당근 보내기 ----------------

function openGift(user: AdminUser | null): void {
  if (!user) return;
  giftTarget = user;
  $('gift-who').innerHTML = `${user.name ? `<b>${esc(user.name)}</b>` : '<b>이름 모르는 접속자</b>'}${
    user.carrots != null ? `<span class="muted">지금 당근 ${num(user.carrots)}개</span>` : ''
  }`;
  $('gift-msg').textContent = '';
  $<HTMLInputElement>('gift-note').value = '';
  ($('gift') as HTMLDialogElement).showModal();
  $<HTMLInputElement>('gift-n').select();
}

$('gift-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!giftTarget) return;
  const n = Math.floor(Number($<HTMLInputElement>('gift-n').value));
  if (!Number.isFinite(n) || n < 1 || n > 10000) {
    $('gift-msg').textContent = '당근은 1~10,000개까지 보낼 수 있습니다.';
    return;
  }
  $<HTMLButtonElement>('gift-go').disabled = true;
  send({ type: 'ADMIN_GIFT', sid: giftTarget.sid, carrots: n, note: $<HTMLInputElement>('gift-note').value });
});
$('gift-cancel').onclick = () => ($('gift') as HTMLDialogElement).close();
document.querySelectorAll<HTMLButtonElement>('.quick button').forEach((b) => {
  b.onclick = () => {
    $<HTMLInputElement>('gift-n').value = b.dataset.n!;
  };
});

let toastTimer: number | null = null;
function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3500);
}

// ---------------- 로그인 ----------------

$('login-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  password = $<HTMLInputElement>('login-pw').value;
  if (!password) return;
  $('login-msg').textContent = '';
  $<HTMLButtonElement>('login-go').disabled = true;
  if (ws && ws.readyState === WebSocket.OPEN) send({ type: 'ADMIN_LOGIN', password });
  else $('login-msg').textContent = '서버에 연결하는 중입니다. 잠시 뒤 다시 눌러 주세요.';
  if (!ws || ws.readyState !== WebSocket.OPEN) $<HTMLButtonElement>('login-go').disabled = false;
});

$('logout').onclick = () => {
  // 비밀번호를 잊고 연결을 새로 열어 관리자 권한을 버린다
  password = '';
  loggedIn = false;
  stopRefresh();
  $<HTMLInputElement>('login-pw').value = '';
  $('board').hidden = true;
  $('login').hidden = false;
  const old = ws;
  ws = null;
  old?.close();
  connect();
};

connect();
$<HTMLInputElement>('login-pw').focus();

import type { HorseBreed, HorseInfo, HorseSnapshot } from '../../shared/src/types';
import { HORSE_COLORS } from '../../shared/src/names';
import { Race3DView } from './race3d';

// ============================================================
// 타이틀 배경 — 메인 화면 뒤에서 여섯 마리가 실제 경주 화면 그대로 달린다.
// 서버 없이 가짜 위치만 넣어 주는 연출이며, 메인 화면을 떠나면 정리한다.
// WebGL을 쓸 수 없으면 잔디 줄무늬 배경이 그대로 보인다.
// ============================================================

const BREEDS: HorseBreed[] = ['horse', 'zebra', 'horse', 'unicorn', 'cow', 'donkey'];
const NAMES = ['번개감자', '월요병', '치킨러버', '로켓배송', '당근중독', '낮잠천재'];
const START = 90;
const LAP = 820;
const SPEED = 13;

let view: Race3DView | null = null;
let timer: number | null = null;
let failed = false;

export function startTitleBg(): void {
  if (view || failed) return;
  const box = document.getElementById('title-bg');
  if (!box) return;
  const horses: HorseInfo[] = BREEDS.map((breed, i) => ({
    id: i + 1,
    name: NAMES[i],
    color: HORSE_COLORS[i],
    breed,
    stats: { speed: 60, accel: 60, stamina: 60, weight: 500, luck: 50 }
  }));
  try {
    view = new Race3DView(box, { backdrop: true });
  } catch (err) {
    failed = true;
    console.warn('타이틀 배경을 그릴 수 없습니다', err);
    return;
  }
  view.setupRace(horses);
  box.classList.add('on');

  const t0 = performance.now();
  let lap = 0;
  const tick = (): void => {
    if (!view) return;
    const t = (performance.now() - t0) / 1000;
    const nowLap = Math.floor((t * SPEED) / LAP);
    if (nowLap !== lap) {
      // 한 바퀴가 끝나면 출발선에서 다시 시작한다
      lap = nowLap;
      view.setupRace(horses);
    }
    const base = START + ((t * SPEED) % LAP);
    // 서로 앞서거니 뒤서거니 하도록 말마다 다른 박자로 흔든다
    const pos = horses.map((_, i) => base + Math.sin(t * 0.33 + i * 1.9) * 16 + Math.sin(t * 0.11 + i) * 9);
    const order = pos.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
    const snaps: HorseSnapshot[] = horses.map((h, i) => ({
      id: h.id,
      pos: pos[i],
      speed: 15 + Math.cos(t * 0.33 + i * 1.9) * 3,
      rank: order.findIndex((o) => o.i === i) + 1,
      finished: false,
      stamina: 80,
      staminaMax: 100,
      anim: 'run',
      effects: [],
      shield: 0
    }));
    view.pushState(snaps);
  };
  tick();
  timer = window.setInterval(tick, 100);
}

export function stopTitleBg(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  if (view) {
    view.destroy();
    view = null;
  }
  const box = document.getElementById('title-bg');
  if (box) {
    box.classList.remove('on');
    box.innerHTML = '';
  }
}

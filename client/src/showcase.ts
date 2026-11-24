import type { HorseBreed, HorseInfo, HorseSnapshot } from '../../shared/src/types';
import { AUGMENT_BY_ID } from '../../shared/src/augments';
import { BREED_INFO, HORSE_COLORS } from '../../shared/src/names';
import { Race3DView } from './race3d';
import { playCardSfx } from './cardSfx';

/**
 * 쇼케이스 — 서버 없이 말 종류와 변신 증강 연출을 차례로 보여 주는 확인용 화면.
 * 주소 뒤에 ?showcase 를 붙이면 열린다. (예: http://localhost:5173/?showcase)
 */
const BREEDS: HorseBreed[] = ['horse', 'zebra', 'unicorn', 'donkey', 'cow', 'zebra'];
/** ?showcase&cards=a,b,c 로 보고 싶은 카드만 고를 수 있다 */
const PICKED = new URLSearchParams(location.search).get('cards');
/**
 * 고르기 막대: 주소에 ?… 를 붙일 수 없는 곳(공유용 페이지)에 올릴 때 쓴다.
 * VITE_SHOWCASE_PICKER=카드1,카드2 로 빌드하면 쇼케이스가 바로 열리고, 화면 아래 단추로 카드를 고른다.
 */
const PICKER: string[] = (import.meta.env.VITE_SHOWCASE_PICKER as string | undefined)?.split(',') ?? [];
let CARDS = PICKER.length ? [PICKER[0]] : PICKED ? PICKED.split(',') : [
  'banana_peel', 'poop_signal', 'stamina_sap', 'teleport', 'muscle_awakening', 'catch_fast', 'extreme_swap', 'shield',
  'rocket_booster', 'sudden_sleep', 'reverse_instinct', 'stamina_steal', 'energy_drink', 'angel_wings',
  'bipedal', 'pony_morph', 'giraffe_neck', 'balloon_horse', 'giant_horse', 'paper_horse',
  'moonwalk', 'dizzy_spin', 'disco_time', 'cool_shades', 'bunny_hop', 'fart_boost',
  'bulk_up', 'feather_body',
  'first_suffering', 'mukbang', 'leg_tangle', 'popular_tragedy', 'light_feather',
  'front_check', 'last_spurt', 'last_miracle', 'popularity_crash', 'infinite_stamina',
  'odd_bless', 'odd_curse', 'even_curse', 'unpopular_rebellion', 'rival_duel', 'front_fatigue', 'fat_strike',
  'back_recover', 'slow_cheer', 'escape_last',
  'back_smash', 'all_or_nothing', 'spicy_carrot', 'whip_crack', 'hurdle_set'
];
/** 걸린 순간부터 차례로 진행하는 연출 — 실제처럼 남은 시간이 줄어들게 보여 준다 */
const TIMED_VISUALS = new Set(['flip', 'smack', 'yut', 'spicy', 'whip', 'hurdle']);
const STEP_MS = 3200;
/** 고르기 막대 화면의 확대 배율 */
const ZOOM = 1.6;
let LOSE = new URLSearchParams(location.search).has('lose');
/** ?bystander 를 붙이면 카드의 주인공이 아닌 쪽(허들을 넘는 말, 당근만 먹는 말)을 본다 */
let BYSTANDER = new URLSearchParams(location.search).has('bystander');

export function startShowcase(): void {
  document.querySelectorAll<HTMLElement>('.screen').forEach((el) => {
    el.classList.toggle('hidden', el.id !== 'scr-game');
  });
  for (const id of ['sidebar', 'bottom-bar', 'camera-select', 'btn-game-leave']) {
    document.getElementById(id)?.classList.add('hidden');
  }
  document.getElementById('top-round')!.textContent = '쇼케이스';
  const phaseEl = document.getElementById('top-phase')!;
  document.getElementById('top-coins')!.textContent = '';

  // 고르기 막대를 쓰는 화면은 폰 세로로 보므로 세 마리만 가까이 세운다
  const gap = PICKER.length ? 9 : 10;
  const horses: HorseInfo[] = (PICKER.length ? BREEDS.slice(0, 3) : BREEDS).map((breed, i) => ({
    id: i + 1,
    name: BREED_INFO[breed].label,
    color: HORSE_COLORS[i],
    breed,
    stats: { speed: 60, accel: 60, stamina: 60, weight: 500, luck: 50 }
  }));

  const view = new Race3DView(document.getElementById('race-canvas')!);
  view.setupRace(horses);
  // 개발 중 확인용: 실제 경주 화면과 같은 이름으로 꺼내 둔다
  if (import.meta.env.DEV) (window as unknown as { __race3d?: Race3DView }).__race3d = view;
  // ?showcase=side 처럼 시점을 고를 수 있다 (기본: 측면)
  const wanted = new URLSearchParams(location.search).get('showcase') || 'side';
  const order = ['broadcast', 'side', 'chase', 'top'];
  for (let i = 0; i < Math.max(0, order.indexOf(wanted)); i++) view.cycleViewMode();

  view.setCameraTarget(PICKER.length ? 2 : 4);
  if (PICKER.length) {
    // 폰 세로 화면에서는 말이 작게 잡혀 연출이 안 보인다. 렌즈만 당겨서 크게 본다 (경주 화면의 카메라는 건드리지 않는다)
    const cam = (view as unknown as { camera: { zoom: number; updateProjectionMatrix(): void } }).camera;
    cam.zoom = ZOOM;
    cam.updateProjectionMatrix();
  }

  if (new URLSearchParams(location.search).has('motions')) {
    runMotionDemo(view, horses, phaseEl);
    return;
  }

  let start = performance.now();
  let lastStep = -1;
  const picker = PICKER.length ? buildPicker(() => { start = performance.now(); lastStep = -1; }) : null;
  setInterval(() => {
    const elapsed = performance.now() - start;
    const step = Math.floor(elapsed / STEP_MS);
    if (step !== lastStep) {
      lastStep = step;
      picker?.onStep();
    }
    const pos = 60 + ((elapsed / 1000) * 14) % 860;
    // 정지·역주행 카드는 실제 게임처럼 제자리에 서거나 뒤로 가게 보여 준다
    const stepStartPos = 60 + (((step * STEP_MS) / 1000) * 14) % 860;
    const stepSec = (elapsed - step * STEP_MS) / 1000;
    const names: string[] = [];
    const snaps: HorseSnapshot[] = horses.map((h, i) => {
      const def = AUGMENT_BY_ID[CARDS[(step + i * 3) % CARDS.length]];
      if (!picker || i === 0) names.push(picker ? `${def.emoji} ${def.name}` : `${h.id}번 ${def.emoji}${def.name}`);
      let anim: HorseSnapshot['anim'] = def.anim ?? 'run';
      if (def.effectType === 'stop') anim = 'stunned';
      if (def.effectType === 'fly') anim = 'flying';
      return {
        id: h.id,
        // 옆으로 벌려 세워 한 화면에 모두 보이게 한다
        pos:
          (anim === 'stunned' ? stepStartPos : anim === 'reverse' ? stepStartPos - stepSec * 10 : pos) +
          (def.visual === 'ride' && i > 0 ? i - 1 : i) * gap - (def.visual === 'ride' && i > 0 ? 0.5 : 0),
        speed: anim === 'stunned' ? 0 : 16,
        rank: i + 1,
        finished: false,
        stamina: 80,
        staminaMax: 100,
        anim,
        // 한 번 재생하는 연출(공중제비·워프 등)은 실제처럼 남은 시간이 줄어든다
        effects:
          def.visualMs || TIMED_VISUALS.has(def.visual ?? '')
            ? stepSec * 1000 < (def.visualMs || def.durationMs)
              // ?lose 를 붙이면 '모 아니면 도'의 꽝(도) 쪽을 본다
              ? [{ defId: def.id, emoji: def.emoji, hostile: def.hostile || (def.effectType === 'gamble' && LOSE), remainMs: (def.visualMs || def.durationMs) - stepSec * 1000, ...(BYSTANDER ? { quiet: true } : {}) }]
              : []
            : [{ defId: def.id, emoji: def.emoji, hostile: def.hostile, remainMs: 1000, ...(def.visual === 'ride' && i > 0 ? { link: h.id - 1 } : {}) }],
        shield: def.effectType === 'shield' ? 1 : 0
      };
    });
    phaseEl.textContent = names.join(' · ');
    view.pushState(snaps);
  }, 100);
}

/** 결과가 둘로 갈리는 카드: [기본 쪽 이름, 다른 쪽 이름] */
const VARIANTS: Record<string, [string, string]> = {
  all_or_nothing: ['모 (성공)', '도 (꽝)'],
  spicy_carrot: ['걸린 말', '안 걸린 말'],
  hurdle_set: ['걸린 말', '넘는 말']
};

/** 화면 아래 고르기 막대: 카드, 갈리는 결과, 소리. 고르면 restart 로 연출을 처음부터 다시 튼다 */
function buildPicker(restart: () => void): { onStep: () => void } {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:50;background:#1a2150;color:#fff;font:700 14px/1.45 "Pretendard",system-ui,sans-serif;padding:10px 12px calc(10px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px';
  const desc = document.createElement('div');
  desc.style.cssText = 'font-weight:500;color:#c9d2ff;min-height:2.9em';
  const row = (): HTMLDivElement => {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
    return el;
  };
  const chip = (label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'font:800 14px "Pretendard",system-ui,sans-serif;border:2px solid #fff;border-radius:4px;padding:9px 11px;cursor:pointer;white-space:nowrap';
    return b;
  };
  const paint = (b: HTMLButtonElement, on: boolean): void => {
    b.style.background = on ? '#ffe23f' : 'transparent';
    b.style.color = on ? '#1a2150' : '#fff';
    b.setAttribute('aria-pressed', String(on));
  };
  const cardRow = row();
  const optRow = row();
  bar.append(desc, cardRow, optRow);
  document.body.appendChild(bar);

  let ac: AudioContext | null = null;
  let soundOn = false;
  let other = false;
  const playNow = (): void => {
    if (!ac || !soundOn) return;
    // 게임과 같이 녹음 효과음을 먼저 쓰고, 녹음을 못 받으면 합성음을 낸다
    const card = CARDS[0];
    const clip = new Audio(`${import.meta.env.BASE_URL}sfx/${card}.mp3`);
    clip.volume = 0.9;
    clip.play().catch(() => {
      if (!ac) return;
      const out = ac.createGain();
      out.gain.value = 0.9;
      out.connect(ac.destination);
      playCardSfx(card, ac, out, ac.currentTime + 0.03);
    });
  };
  const soundBtn = chip('소리 켜기');
  soundBtn.onclick = () => {
    soundOn = !soundOn;
    if (soundOn) {
      ac ??= new AudioContext();
      void ac.resume();
    }
    soundBtn.textContent = soundOn ? '소리 끄기' : '소리 켜기';
    paint(soundBtn, soundOn);
    if (soundOn) restart();
  };
  paint(soundBtn, false);

  const cardBtns = PICKER.map((id) => {
    const def = AUGMENT_BY_ID[id];
    const b = chip(`${def.emoji} ${def.name}`);
    b.onclick = () => {
      CARDS = [id];
      other = false;
      render();
      restart();
    };
    cardRow.appendChild(b);
    return b;
  });

  const render = (): void => {
    const id = CARDS[0];
    const def = AUGMENT_BY_ID[id];
    cardBtns.forEach((b, i) => paint(b, PICKER[i] === id));
    desc.textContent = def.description.replace(/\n/g, ' ');
    LOSE = id === 'all_or_nothing' && other;
    BYSTANDER = id !== 'all_or_nothing' && other;
    optRow.replaceChildren();
    VARIANTS[id]?.forEach((label, i) => {
      const b = chip(label);
      paint(b, other === (i === 1));
      b.onclick = () => {
        other = i === 1;
        render();
        restart();
      };
      optRow.appendChild(b);
    });
    optRow.appendChild(soundBtn);
  };
  render();
  return { onStep: playNow };
}

/** 새 카드 9장의 동작 시안: 한 장면에 한 카드씩, 누가 어떤 동작을 하는지 글로 함께 보여 준다 */
interface MotionScene {
  title: string;
  note: string;
  /** 말 번호 → 걸린 효과 */
  fx: Record<number, { id: string; quiet?: boolean; link?: number; oneShot?: boolean }>;
  /** 말 번호 → 다른 말과 같은 위치에 세운다 (업히기, 나란히) */
  at?: Record<number, number>;
  /** 장면 뒷부분(초)부터 멈춰 서는 말 */
  stopAfter?: Record<number, number>;
  ms?: number;
}

const MOTION_SCENES: MotionScene[] = [
  { title: '한눈팔기', note: '2번, 4번: 고개를 옆으로 돌리고 건들건들 걷다가 발을 헛디딘다', fx: { 2: { id: 'love_whistle' }, 4: { id: 'love_whistle' } } },
  { title: '자석', note: '5번: 코부터 끌려가느라 몸이 늘어나고 다리가 뒤로 쓸린다', fx: { 5: { id: 'magnet', link: 3 } } },
  { title: '나란히 달리기', note: '3번과 4번: 서로 바라보며 무릎을 높이 드는 발맞춤 행진', fx: { 3: { id: 'side_by_side', link: 4 }, 4: { id: 'side_by_side', link: 3 } }, at: { 4: 3 } },
  { title: '어부바', note: '4번이 3번 등에 업혀 손을 흔든다. 3번은 주저앉아 부들부들', fx: { 4: { id: 'piggyback', link: 3 }, 3: { id: 'piggyback', quiet: true } }, at: { 4: 3 } },
  { title: '치어리더 등장', note: '6번: 펄쩍펄쩍 뛰며 앞다리를 치켜든다. 1번(선두)은 시끄러워 고개를 젓는다', fx: { 6: { id: 'cheer_squad' }, 1: { id: 'cheer_squad', quiet: true } } },
  { title: '당근 낚싯대', note: '2번: 목을 빼고 당근을 덥석덥석. 마지막에는 못 먹고 허탈하게 멈춘다', fx: { 2: { id: 'carrot_rod' } }, stopAfter: { 2: 3.2 }, ms: 5200 },
  { title: '재채기 릴레이', note: '2번, 3번: 에… 에… 고개를 젖혔다가 취! 하고 튀어 오른다', fx: { 2: { id: 'sneeze_relay' }, 3: { id: 'sneeze_relay' } } },
  { title: '결승선 당기기', note: '모두: 깜짝 놀라 네 다리를 벌리고 펄쩍 뛴다 (결승문은 스르륵 끌려온다)', fx: { 1: { id: 'short_course', oneShot: true }, 2: { id: 'short_course', oneShot: true }, 3: { id: 'short_course', oneShot: true }, 4: { id: 'short_course', oneShot: true }, 5: { id: 'short_course', oneShot: true }, 6: { id: 'short_course', oneShot: true } }, ms: 3000 },
  { title: '자리 뽑기', note: '모두: 하늘로 솟아 한 바퀴 구르고 다른 자리에 떨어진다', fx: { 1: { id: 'musical_chairs', oneShot: true }, 2: { id: 'musical_chairs', oneShot: true }, 3: { id: 'musical_chairs', oneShot: true }, 4: { id: 'musical_chairs', oneShot: true }, 5: { id: 'musical_chairs', oneShot: true }, 6: { id: 'musical_chairs', oneShot: true } }, ms: 3000 }
];

function runMotionDemo(view: Race3DView, horses: HorseInfo[], captionEl: HTMLElement): void {
  // ?motions=3 처럼 번호를 주면 그 장면만 되풀이한다
  const only = Number(new URLSearchParams(location.search).get('motions'));
  const scenes = only >= 1 && only <= MOTION_SCENES.length ? [MOTION_SCENES[only - 1]] : MOTION_SCENES;
  const total = scenes.reduce((sum, sc) => sum + (sc.ms ?? 4200), 0);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:50;background:#1a2150;color:#fff;font:800 18px/1.5 "Pretendard",sans-serif;padding:10px 14px 10px 18px;border-radius:4px;max-width:94vw;display:flex;align-items:center;gap:14px';
  const note = document.createElement('span');
  note.style.cssText = 'text-align:left';
  const btnCss = 'font:800 15px "Pretendard",sans-serif;color:#1a2150;background:#ffe23f;border:2px solid #fff;border-radius:4px;padding:8px 12px;cursor:pointer;white-space:nowrap;flex:none';
  // 소리: 브라우저는 한 번 눌러야 소리를 낼 수 있어서 단추로 켠다. 켜 두면 장면이 바뀔 때마다 그 카드의 효과음이 난다
  const soundBtn = document.createElement('button');
  soundBtn.style.cssText = btnCss;
  soundBtn.textContent = '소리 켜기';
  const againBtn = document.createElement('button');
  againBtn.style.cssText = btnCss + ';background:#fff';
  againBtn.textContent = '다시 듣기';
  bar.append(note, soundBtn, againBtn);
  document.body.appendChild(bar);
  let ac: AudioContext | null = null;
  let soundOn = false;
  let currentCard = '';
  const playNow = (): void => {
    if (!ac || !soundOn || !currentCard) return;
    // 게임과 같이 녹음 효과음을 먼저 쓰고, 녹음이 없는 카드만 합성음을 낸다
    const card = currentCard;
    const clip = new Audio(`/sfx/${card}.mp3`);
    clip.volume = 0.9;
    clip.play().catch(() => {
      if (!ac) return;
      const out = ac.createGain();
      out.gain.value = 0.9;
      out.connect(ac.destination);
      playCardSfx(card, ac, out, ac.currentTime + 0.03);
    });
  };
  soundBtn.onclick = () => {
    soundOn = !soundOn;
    if (soundOn) {
      ac ??= new AudioContext();
      void ac.resume();
      playNow();
    }
    soundBtn.textContent = soundOn ? '소리 끄기' : '소리 켜기';
  };
  againBtn.onclick = () => {
    if (!soundOn) soundBtn.click();
    else playNow();
  };
  const start = performance.now();
  let shownTitle = '';
  setInterval(() => {
    const elapsed = performance.now() - start;
    let inLoop = elapsed % total;
    let index = 0;
    while (inLoop >= (scenes[index].ms ?? 4200)) {
      inLoop -= scenes[index].ms ?? 4200;
      index++;
    }
    const sc = scenes[index];
    const sec = inLoop / 1000;
    if (sc.title !== shownTitle) {
      shownTitle = sc.title;
      const num = MOTION_SCENES.indexOf(sc) + 1;
      captionEl.textContent = `${num}/${MOTION_SCENES.length} ${sc.title}`;
      note.textContent = `${num}. ${sc.title}: ${sc.note}`;
      // 장면의 주인공 카드(수치만 걸린 쪽이 아닌 첫 효과)의 효과음을 낸다
      currentCard = Object.values(sc.fx).find((f) => !f.quiet)?.id ?? '';
      // 한 번에 터지는 연출(펄쩍, 공중제비)은 동작이 시작되는 0.8초 뒤에 맞춘다
      const delay = Object.values(sc.fx).some((f) => f.oneShot) ? 800 : 150;
      setTimeout(playNow, delay);
    }
    const base = 60 + ((elapsed / 1000) * 14) % 860;
    const snaps: HorseSnapshot[] = horses.map((h, i) => {
      const f = sc.fx[h.id];
      const def = f ? AUGMENT_BY_ID[f.id] : undefined;
      const stopAt = sc.stopAfter?.[h.id];
      const stopped = stopAt != null && sec >= stopAt;
      const slot = sc.at?.[h.id] != null ? sc.at[h.id] - 1 : i;
      const oneShotLeft = def?.visualMs ? def.visualMs - (sec - 0.8) * 1000 : 0;
      const effects =
        !f || !def
          ? []
          : f.oneShot
            ? sec > 0.8 && oneShotLeft > 0
              ? [{ defId: def.id, emoji: def.emoji, hostile: def.hostile, remainMs: oneShotLeft }]
              : []
            : [{ defId: def.id, emoji: def.emoji, hostile: def.hostile, remainMs: 1000, ...(f.link ? { link: f.link } : {}), ...(f.quiet || stopped ? { quiet: true } : {}) }];
      return {
        id: h.id,
        pos: (stopped ? base - (sec - stopAt!) * 14 : base) + slot * 10 - (sc.at?.[h.id] != null && f?.id === 'piggyback' ? 0.5 : 0),
        speed: stopped ? 0 : 16,
        rank: i + 1,
        finished: false,
        stamina: 80,
        staminaMax: 100,
        anim: stopped ? 'stunned' : def?.anim ?? 'run',
        effects,
        shield: 0
      };
    });
    view.pushState(snaps);
  }, 100);
}

import type { HorseBreed, HorseInfo, HorseSnapshot } from '../../shared/src/types';
import { AUGMENT_BY_ID } from '../../shared/src/augments';
import { BREED_INFO, HORSE_COLORS } from '../../shared/src/names';
import { Race3DView } from './race3d';

/**
 * 쇼케이스 — 서버 없이 말 종류와 변신 증강 연출을 차례로 보여 주는 확인용 화면.
 * 주소 뒤에 ?showcase 를 붙이면 열린다. (예: http://localhost:5173/?showcase)
 */
const BREEDS: HorseBreed[] = ['horse', 'zebra', 'unicorn', 'donkey', 'cow', 'zebra'];
const CARDS = [
  'banana_peel', 'poop_signal', 'stamina_sap', 'teleport', 'muscle_awakening', 'catch_fast', 'extreme_swap', 'shield',
  'rocket_booster', 'sudden_sleep', 'reverse_instinct', 'stamina_steal', 'energy_drink', 'angel_wings',
  'bipedal', 'pony_morph', 'giraffe_neck', 'balloon_horse', 'giant_horse', 'paper_horse',
  'moonwalk', 'dizzy_spin', 'disco_time', 'cool_shades', 'bunny_hop', 'fart_boost',
  'bulk_up', 'feather_body',
  'first_suffering', 'mukbang', 'leg_tangle', 'popular_tragedy', 'light_feather'
];
const STEP_MS = 3200;

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

  const horses: HorseInfo[] = BREEDS.map((breed, i) => ({
    id: i + 1,
    name: BREED_INFO[breed].label,
    color: HORSE_COLORS[i],
    breed,
    stats: { speed: 60, accel: 60, stamina: 60, weight: 500, luck: 50 }
  }));

  const view = new Race3DView(document.getElementById('race-canvas')!);
  view.setupRace(horses);
  // ?showcase=side 처럼 시점을 고를 수 있다 (기본: 측면)
  const wanted = new URLSearchParams(location.search).get('showcase') || 'side';
  const order = ['broadcast', 'side', 'chase', 'top'];
  for (let i = 0; i < Math.max(0, order.indexOf(wanted)); i++) view.cycleViewMode();

  view.setCameraTarget(4);

  const start = performance.now();
  setInterval(() => {
    const elapsed = performance.now() - start;
    const step = Math.floor(elapsed / STEP_MS);
    const pos = 60 + ((elapsed / 1000) * 14) % 860;
    // 정지·역주행 카드는 실제 게임처럼 제자리에 서거나 뒤로 가게 보여 준다
    const stepStartPos = 60 + (((step * STEP_MS) / 1000) * 14) % 860;
    const stepSec = (elapsed - step * STEP_MS) / 1000;
    const names: string[] = [];
    const snaps: HorseSnapshot[] = horses.map((h, i) => {
      const def = AUGMENT_BY_ID[CARDS[(step + i * 3) % CARDS.length]];
      names.push(`${h.id}번 ${def.emoji}${def.name}`);
      let anim: HorseSnapshot['anim'] = def.anim ?? 'run';
      if (def.effectType === 'stop') anim = 'stunned';
      if (def.effectType === 'fly') anim = 'flying';
      return {
        id: h.id,
        // 옆으로 벌려 세워 한 화면에 모두 보이게 한다
        pos:
          (anim === 'stunned' ? stepStartPos : anim === 'reverse' ? stepStartPos - stepSec * 10 : pos) +
          i * 10,
        speed: anim === 'stunned' ? 0 : 16,
        rank: i + 1,
        finished: false,
        stamina: 80,
        staminaMax: 100,
        anim,
        // 한 번 재생하는 연출(공중제비·워프 등)은 실제처럼 남은 시간이 줄어든다
        effects:
          def.visualMs || def.visual === 'flip'
            ? stepSec * 1000 < (def.visualMs || def.durationMs)
              ? [{ defId: def.id, emoji: def.emoji, hostile: def.hostile, remainMs: (def.visualMs || def.durationMs) - stepSec * 1000 }]
              : []
            : [{ defId: def.id, emoji: def.emoji, hostile: def.hostile, remainMs: 1000 }],
        shield: def.effectType === 'shield' ? 1 : 0
      };
    });
    phaseEl.textContent = names.join(' · ');
    view.pushState(snaps);
  }, 100);
}

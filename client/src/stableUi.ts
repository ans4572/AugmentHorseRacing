import type { CosmeticSlot, HorseInfo, HorseLook } from '../../shared/src/types';
import {
  COSMETICS,
  COSMETIC_BY_ID,
  DEFAULT_LOOK,
  SLOT_LABELS,
  SLOT_ORDER,
  lookBreed
} from '../../shared/src/stable';
import { HORSE_COLORS } from '../../shared/src/names';
import { Race3DView } from './race3d';
import { buy, equip, isOwned, setHorseName, stable } from './stable';
import { icon } from './icons';
import { sfx } from './audio';

// ============================================================
// 마구간 화면 — 내 말 미리보기, 꾸미기 상점, 입어 보기
// ============================================================

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let preview: Race3DView | null = null;
let previewFailed = false;
let slot: CosmeticSlot = 'breed';
/** 아직 사지 않은 항목을 미리 입혀 본 상태 (칸별) */
let tryOn: Partial<HorseLook> = {};
let notify: (message: string, isError?: boolean) => void = () => {};
let onChange: () => void = () => {};

function esc(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function shownLook(): HorseLook {
  return { ...stable().look, ...tryOn };
}

/** 내 말을 한 줄로 설명한다 (혼자 하기 화면용) */
export function horseSummary(): string {
  const s = stable();
  const parts = SLOT_ORDER.filter((k) => s.look[k] !== DEFAULT_LOOK[k]).map(
    (k) => COSMETIC_BY_ID[s.look[k]].name
  );
  return `${s.name}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

function refreshPreview(): void {
  if (previewFailed) return;
  const box = el('stable-preview');
  if (!preview) {
    try {
      preview = new Race3DView(box, { preview: true });
    } catch (err) {
      previewFailed = true;
      console.error('미리보기 초기화 실패', err);
      box.innerHTML = '<p class="r3d-unsupported">이 기기에서는 3D 미리보기를 표시할 수 없습니다.</p>';
      return;
    }
  }
  const look = shownLook();
  const info: HorseInfo = {
    id: 1,
    name: stable().name,
    color: HORSE_COLORS[0],
    breed: lookBreed(look),
    stats: { speed: 60, accel: 60, stamina: 60, weight: 500, luck: 50 },
    ownerId: 'me',
    look
  };
  preview.setupRace([info]);
  // 제자리에서 가볍게 달리게 해 발자국 색까지 보여 준다
  preview.pushState([
    {
      id: 1,
      pos: 120,
      speed: 9,
      rank: 1,
      finished: false,
      stamina: 100,
      staminaMax: 100,
      anim: 'run',
      effects: [],
      shield: 0
    }
  ]);
}

function render(): void {
  const s = stable();
  el('stable-carrots').innerHTML = `${icon('carrot')}${s.carrots}`;
  el('stable-stats').textContent =
    s.stats.races > 0
      ? `출전 ${s.stats.races}회, 우승 ${s.stats.wins}회, 3위 안 ${s.stats.podiums}회. 지금까지 번 당근 ${s.stats.earned}개.`
      : '아직 출전 기록이 없습니다. 혼자 하기에서 첫 경주를 뛰어 보세요.';

  el('stable-tabs').innerHTML = SLOT_ORDER.map(
    (k) => `<button class="stable-tab${k === slot ? ' active' : ''}" data-slot="${k}">${SLOT_LABELS[k]}</button>`
  ).join('');
  el('stable-tabs')
    .querySelectorAll<HTMLElement>('button')
    .forEach((b) => {
      b.onclick = () => {
        slot = b.dataset.slot as CosmeticSlot;
        render();
      };
    });

  const shown = shownLook();
  el('stable-items').innerHTML = COSMETICS.filter((c) => c.slot === slot)
    .map((c) => {
      const owned = isOwned(c.id);
      const equipped = s.look[c.slot] === c.id;
      const trying = !owned && shown[c.slot] === c.id;
      const stateText = equipped ? '착용 중' : owned ? '보유' : `${icon('carrot')}${c.price}`;
      const swatch = c.color ? `<span class="si-swatch" style="background:${c.color}"></span>` : '';
      return `<button class="stable-item${equipped ? ' equipped' : ''}${trying ? ' trying' : ''}${owned ? '' : ' locked'}" data-id="${c.id}">
        <span class="si-emoji">${c.emoji}${swatch}</span>
        <span class="si-name">${esc(c.name)}</span>
        <span class="si-state">${stateText}</span>
      </button>`;
    })
    .join('');
  el('stable-items')
    .querySelectorAll<HTMLElement>('button')
    .forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.id!;
        const item = COSMETIC_BY_ID[id];
        if (isOwned(id)) {
          equip(id);
          sfx('equip');
          delete tryOn[item.slot];
        } else if (tryOn[item.slot] === id) {
          delete tryOn[item.slot]; // 다시 누르면 입어 보기 취소
        } else {
          tryOn[item.slot] = id;
        }
        render();
        refreshPreview();
        onChange();
      };
    });

  // 입어 보는 중인 항목의 구매 안내
  const tryingId = tryOn[slot];
  const bar = el('stable-buybar');
  if (tryingId) {
    const item = COSMETIC_BY_ID[tryingId];
    const lack = item.price - s.carrots;
    bar.classList.remove('hidden');
    bar.innerHTML = `<span><b>${esc(item.name)}</b> 입어 보는 중</span>
      <button id="btn-stable-buy" class="btn small"${lack > 0 ? ' disabled' : ''}>${
        lack > 0 ? `당근 ${lack}개 부족` : `당근 ${item.price}개로 사기`
      }</button>`;
    el<HTMLButtonElement>('btn-stable-buy').onclick = () => {
      const result = buy(tryingId);
      if (result === 'ok') {
        delete tryOn[item.slot];
        sfx('buy');
        notify(`${item.name}을(를) 사서 바로 입혔습니다.`, false);
      } else if (result === 'poor') {
        notify('당근이 부족합니다. 혼자 하기에서 모을 수 있습니다.');
      }
      render();
      refreshPreview();
      onChange();
    };
  } else {
    bar.classList.add('hidden');
    bar.innerHTML = '';
  }
}

export function initStableUi(opts: {
  toast: (message: string, isError?: boolean) => void;
  onChange: () => void;
}): void {
  notify = opts.toast;
  onChange = opts.onChange;
  const nameInput = el<HTMLInputElement>('stable-name');
  nameInput.onchange = () => {
    setHorseName(nameInput.value);
    nameInput.value = stable().name;
    onChange();
  };
}

export function openStable(): void {
  tryOn = {};
  el<HTMLInputElement>('stable-name').value = stable().name;
  render();
  refreshPreview();
}

/** 화면을 떠날 때 미리보기를 정리한다 (사지 않고 입어 본 항목은 벗는다) */
export function closeStable(): void {
  tryOn = {};
  if (preview) {
    preview.destroy();
    preview = null;
    el('stable-preview').innerHTML = '';
  }
}

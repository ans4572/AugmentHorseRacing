import type { CosmeticSlot, HorseInfo, HorseLook } from '../../shared/src/types';
import {
  COSMETICS,
  COSMETIC_BY_ID,
  DEFAULT_LOOK,
  MAX_HORSES,
  SLOT_LABELS,
  SLOT_ORDER,
  lookBreed
} from '../../shared/src/stable';
import { HORSE_COLORS } from '../../shared/src/names';
import { Race3DView } from './race3d';
import {
  activeHorse,
  addHorse,
  buy,
  equip,
  horseAt,
  isOwned,
  removeHorse,
  setActiveHorse,
  setHorseName,
  stable
} from './stable';
import { icon } from './icons';
import { sfx } from './audio';
import { esc, particle } from './text';

// ============================================================
// 마구간 화면 — 내 말 고르기(최대 3마리), 미리보기, 꾸미기 상점, 입어 보기
// ============================================================

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let preview: Race3DView | null = null;
let previewFailed = false;
let slot: CosmeticSlot = 'breed';
/** 지금 꾸미는 말의 번호 (출전마와 다를 수 있다) */
let editing = 0;
/** 내보내기를 한 번 눌러 확인을 기다리는 중 */
let confirmRemove = false;
/** 아직 사지 않은 항목을 미리 입혀 본 상태 (칸별) */
let tryOn: Partial<HorseLook> = {};
let notify: (message: string, isError?: boolean) => void = () => {};
let onChange: () => void = () => {};


function shownLook(): HorseLook {
  return { ...horseAt(editing).look, ...tryOn };
}

/**
 * 말 종류 아이콘. 이모지는 종류마다 전신, 얼굴, 날개로 제각각이라
 * 게임의 3D 모델을 같은 각도와 크기로 찍은 그림(client/public/breeds)을 쓴다
 */
export function breedIcon(breedItemId: string): string {
  const item = COSMETIC_BY_ID[breedItemId] ?? COSMETIC_BY_ID[DEFAULT_LOOK.breed];
  return `<img class="breed-ic" src="${import.meta.env.BASE_URL}breeds/${item.breed}.png" alt="" width="64" height="64" draggable="false" />`;
}

/** 혼자 하기 화면에 보여 줄 출전마의 이름 */
export function horseSummary(): string {
  return activeHorse().name;
}

/** 꾸밀 말을 바꾼다. 입어 보던 항목은 벗긴다 */
function selectHorse(index: number): void {
  editing = index;
  tryOn = {};
  confirmRemove = false;
  el<HTMLInputElement>('stable-name').value = horseAt(editing).name;
  render();
  refreshPreview();
}

/** 위쪽의 말 고르기 줄과, 미리보기 아래의 출전·내보내기 단추 */
function renderHorses(): void {
  const s = stable();
  const cards = s.horses.map((h, i) => {
    const on = i === editing;
    return `<button type="button" class="sh-card${on ? ' active' : ''}" role="tab" aria-selected="${on}" data-i="${i}" title="${esc(h.name)}">
      <span class="sh-emoji" aria-hidden="true">${breedIcon(h.look.breed)}</span>
      <span class="sh-name">${esc(h.name)}</span>
      ${i === s.active ? '<span class="sh-badge">출전</span>' : ''}
    </button>`;
  });
  if (s.horses.length < MAX_HORSES) {
    cards.push(`<button type="button" class="sh-card add" data-add="1">
      <span class="sh-emoji" aria-hidden="true">＋</span>
      <span class="sh-name">새 말 들이기</span>
    </button>`);
  }
  el('stable-horses').innerHTML = cards.join('');
  el('stable-horses')
    .querySelectorAll<HTMLElement>('button')
    .forEach((b) => {
      b.onclick = () => {
        if (b.dataset.add) {
          const i = addHorse();
          if (i === null) return;
          sfx('equip');
          notify(`${horseAt(i).name}${particle(horseAt(i).name, '이', '가')} 마구간에 들어왔습니다. 이름과 꾸미기를 바꿔 보세요.`, false);
          selectHorse(i);
          onChange();
        } else {
          selectHorse(Number(b.dataset.i));
        }
      };
    });

  const isActive = editing === s.active;
  const go = el<HTMLButtonElement>('btn-stable-active');
  go.disabled = isActive;
  go.innerHTML = isActive ? `${icon('star')}출전하는 말` : '이 말로 출전';
  go.onclick = () => {
    if (!setActiveHorse(editing)) return;
    sfx('equip');
    notify(`이제 ${horseAt(editing).name}${particle(horseAt(editing).name, '이', '가')} 출전합니다.`, false);
    render();
    onChange();
  };
  const out = el<HTMLButtonElement>('btn-stable-remove');
  out.hidden = s.horses.length <= 1;
  out.textContent = confirmRemove ? '정말 내보내기' : '내보내기';
  out.classList.toggle('danger', confirmRemove);
  out.onclick = () => {
    if (!confirmRemove) {
      confirmRemove = true;
      renderHorses();
      return;
    }
    const name = horseAt(editing).name;
    if (!removeHorse(editing)) return;
    notify(`${name}${particle(name, '을', '를')} 내보냈습니다. 산 꾸미기는 그대로 남아 있습니다.`, false);
    selectHorse(stable().active);
    onChange();
  };
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
      box.innerHTML = '<p class="r3d-unsupported">이 기기에서는 3D 미리보기가 나오지 않습니다.</p>';
      return;
    }
  }
  const look = shownLook();
  const info: HorseInfo = {
    id: 1,
    name: horseAt(editing).name,
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
  const horse = horseAt(editing);
  renderHorses();
  el('stable-carrots').innerHTML = `${icon('carrot')}${s.carrots}`;
  el('stable-stats').textContent =
    s.stats.races > 0
      ? `출전 ${s.stats.races}회, 우승 ${s.stats.wins}회, 1~3위 ${s.stats.podiums}회. 지금까지 번 당근 ${s.stats.earned}개.`
      : '아직 출전 기록이 없습니다. 게임에 출전시켜 첫 경주를 뛰어 보세요.';

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
  // 보유한 항목을 먼저, 그 안에서는 가격이 싼 순서로 보여 준다 (같은 값이면 카탈로그 순서)
  el('stable-items').innerHTML = COSMETICS.filter((c) => c.slot === slot)
    .sort((a, b) => Number(isOwned(b.id)) - Number(isOwned(a.id)) || a.price - b.price)
    .map((c) => {
      const owned = isOwned(c.id);
      const equipped = horse.look[c.slot] === c.id;
      const trying = !owned && shown[c.slot] === c.id;
      const stateText = equipped ? '착용 중' : owned ? '보유' : `${icon('carrot')}${c.price}`;
      const swatch = c.color ? `<span class="si-swatch" style="background:${c.color}"></span>` : '';
      return `<button class="stable-item${equipped ? ' equipped' : ''}${trying ? ' trying' : ''}${owned ? '' : ' locked'}" data-id="${c.id}">
        <span class="si-emoji">${c.slot === 'breed' ? breedIcon(c.id) : c.emoji}${swatch}</span>
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
          equip(editing, id);
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
      const result = buy(editing, tryingId);
      if (result === 'ok') {
        delete tryOn[item.slot];
        sfx('buy');
        notify(`${item.name}${objectParticle(item.name)} 사서 바로 입혔습니다.`, false);
      } else if (result === 'poor') {
        notify('당근이 부족합니다. 게임에 내 말을 출전시키면 모을 수 있습니다.');
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
    setHorseName(editing, nameInput.value);
    nameInput.value = horseAt(editing).name;
    render();
    onChange();
  };
}

export function openStable(): void {
  selectHorse(stable().active);
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

/** 이름 끝 글자에 받침이 있으면 '을', 없으면 '를' */
function objectParticle(word: string): string {
  return particle(word, '을', '를');
}

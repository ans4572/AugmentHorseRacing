import type { CosmeticSlot, HorseBreed, HorseInfo, HorseLook } from '../../../shared/src/types';
import { COSMETICS, DEFAULT_LOOK } from '../../../shared/src/stable';
import { BREED_INFO, HORSE_COLORS, HORSE_NAMES } from '../../../shared/src/names';
import { pickDistinct, randInt } from './rng';

/** 능력치 총합(속력+가속+지구력) 허용 범위 — 극단 조합 방지 */
export const STAT_SUM_MIN = 150;
export const STAT_SUM_MAX = 230;

/** 말 종류를 가중치에 따라 뽑는다 (겉모습 전용) */
export function pickBreed(rng: () => number = Math.random): HorseBreed {
  const breeds = Object.keys(BREED_INFO) as HorseBreed[];
  const total = breeds.reduce((s, b) => s + BREED_INFO[b].weight, 0);
  let roll = rng() * total;
  for (const b of breeds) {
    roll -= BREED_INFO[b].weight;
    if (roll < 0) return b;
  }
  return 'horse';
}

/** 칸마다 꾸미기를 붙일 확률. 나머지는 맨몸(기본값)이다 */
const DRESS_CHANCE: Partial<Record<CosmeticSlot, number>> = {
  coat: 0, // 털 색은 번호를 알아보는 데 쓰이므로 바꾸지 않는다
  hat: 0.5,
  neck: 0.4,
  face: 0.3,
  trail: 0.3
};

/** 출전마의 겉모습을 무작위로 꾸민다 (능력치와는 무관). 같은 종류라도 매번 다르게 보인다 */
export function randomLook(breed: HorseBreed, rng: () => number = Math.random): HorseLook {
  const look: HorseLook = { ...DEFAULT_LOOK, breed: `breed_${breed}` };
  for (const slot of Object.keys(DRESS_CHANCE) as CosmeticSlot[]) {
    if (rng() >= (DRESS_CHANCE[slot] ?? 0)) continue;
    const items = COSMETICS.filter((c) => c.slot === slot && c.id !== DEFAULT_LOOK[slot]);
    if (items.length > 0) look[slot] = items[Math.floor(rng() * items.length)].id;
  }
  return look;
}

/**
 * 매 라운드 6마리의 말을 무작위 생성한다.
 * usedNames를 주면 거기 있는 이름은 피한다 (한 게임 안에서 같은 이름이 다시 나오지 않게).
 */
export function generateHorses(rng: () => number = Math.random, usedNames?: Set<string>): HorseInfo[] {
  const fresh = usedNames ? HORSE_NAMES.filter((n) => !usedNames.has(n)) : HORSE_NAMES;
  const names = pickDistinct(fresh.length >= 6 ? fresh : HORSE_NAMES, 6, rng);
  const horses: HorseInfo[] = [];
  for (let id = 1; id <= 6; id++) {
    let speed = 0;
    let accel = 0;
    let stamina = 0;
    // 총합 제한을 만족할 때까지 재추출
    do {
      speed = randInt(rng, 20, 95);
      accel = randInt(rng, 20, 95);
      stamina = randInt(rng, 20, 95);
    } while (speed + accel + stamina < STAT_SUM_MIN || speed + accel + stamina > STAT_SUM_MAX);
    horses.push({
      id,
      name: names[id - 1],
      color: HORSE_COLORS[id - 1],
      breed: pickBreed(rng),
      stats: {
        speed,
        accel,
        stamina,
        weight: randInt(rng, 350, 650),
        luck: randInt(rng, 1, 100)
      }
    });
  }
  // 겉모습은 능력치를 다 뽑은 뒤에 정한다 (같은 씨앗이면 능력치가 전과 같게)
  for (const h of horses) h.look = randomLook(h.breed, rng);
  return horses;
}

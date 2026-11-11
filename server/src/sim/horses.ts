import type { HorseBreed, HorseInfo } from '../../../shared/src/types';
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

/** 매 라운드 6마리의 말을 무작위 생성한다. */
export function generateHorses(rng: () => number = Math.random): HorseInfo[] {
  const names = pickDistinct(HORSE_NAMES, 6, rng);
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
  return horses;
}

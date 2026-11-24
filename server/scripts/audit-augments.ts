/**
 * 증강 점검 도구 — 모든 카드를 같은 조건에서 걸어 보고 실제 효과를 잰다.
 *   npm run audit:augments
 * 15초 달린 뒤 카드를 쓰고, 8초 뒤 대상 말이 "카드를 안 쓴 경우"보다 얼마나 앞서거나 뒤처졌는지(코스 단위) 출력한다.
 * 강화 카드가 음수이거나 방해 카드가 양수이면, 또는 0에 가까우면 문제가 있는 카드다.
 */
import type { HorseInfo } from '../../shared/src/types';
import { AUGMENTS } from '../../shared/src/augments';
import { TIER_INFO, TIER_OF_RARITY } from '../../shared/src/constants';
import { RaceSim } from '../src/sim/race';
import { mulberry32 } from '../src/sim/rng';

const horses: HorseInfo[] = [70, 66, 62, 58, 54, 50].map((speed, i) => ({
  id: i + 1,
  name: `말${i + 1}`,
  color: '#fff',
  breed: 'horse',
  stats: { speed, accel: 55, stamina: 60, weight: 450 + i * 30, luck: 50 }
}));

const bets = { win: new Map([[3, 100], [5, 10]]), total: new Map([[3, 150], [5, 10]]) };

function warmedUp(): RaceSim {
  // 카드의 뽑기는 다른 난수로 돌려, 카드를 쓴 경주와 안 쓴 경주의 운(컨디션 변동)이 똑같이 흐르게 한다
  const sim = new RaceSim(horses, mulberry32(7), mulberry32(11));
  for (let i = 0; i < 300; i++) sim.tick(50);
  return sim;
}

export interface AuditRow {
  id: string;
  name: string;
  tier: string;
  hostile: boolean;
  effectType: string;
  targets: number[];
  /** 카드를 쓰고 1초 동안 대상이 움직인 거리 (음수면 뒤로 감) */
  moved1s: number;
  /** 8초 뒤 대조군 대비 위치 차이 */
  delta8s: number;
  /** 사용 직후 대조군 대비 지구력 차이 */
  staminaDelta: number;
  shield: number;
  /** 완주 시각 차이(초). 음수면 카드를 쓴 쪽이 더 빨리 들어옴 */
  finishDelta: number;
}

export function auditAll(): AuditRow[] {
  return AUGMENTS.map((def) => {
    const test = warmedUp();
    const ctrl = warmedUp();
    // 고를 수 있는 말에 조건이 붙은 카드는 조건에 맞는 말에게 쓴다 (4등 아래 → 5등, 맨 앞 제외 → 3등)
    const order = test.currentRanking();
    // 그 말에게 쓸 수 없으면(예: 자석은 이미 앞 말에 붙어 있으면 못 쓴다) 조건에 맞는 다른 말로 넘어간다
    const picks = def.targetRule === 'back3' ? [order[4], order[5], order[3]] : def.targetRule === 'notFirst' ? [order[2]] : [3];
    let result = test.applyAugment(def, { targetHorseId: picks[0], bets });
    for (let n = 1; !result.ok && n < picks.length; n++) result = test.applyAugment(def, { targetHorseId: picks[n], bets });
    const id = result.targets[0] ?? 3;
    const startPos = test.horse(id).pos;
    const staminaDelta = test.horse(id).stamina - ctrl.horse(id).stamina;
    const shield = test.horse(id).shield;
    // 위치 교환은 사용 순간 위치가 바뀌므로 그 차이를 그대로 잰다
    const swapJump = def.effectType === 'swapPositions' ? startPos - ctrl.horse(id).pos : 0;
    for (let i = 0; i < 20; i++) {
      test.tick(50);
      ctrl.tick(50);
    }
    const moved1s = test.horse(id).pos - startPos;
    for (let i = 0; i < 140; i++) {
      test.tick(50);
      ctrl.tick(50);
    }
    const delta8s = test.horse(id).pos - ctrl.horse(id).pos;
    let guard = 0;
    while ((!test.allFinished() || !ctrl.allFinished()) && guard++ < 4000) {
      test.tick(50);
      ctrl.tick(50);
    }
    const finishDelta = ((test.horse(id).finishTime ?? 0) - (ctrl.horse(id).finishTime ?? 0)) / 1000;
    return {
      id: def.id,
      name: def.name,
      tier: TIER_INFO[TIER_OF_RARITY[def.rarity]].label,
      hostile: def.hostile,
      effectType: def.effectType,
      targets: result.targets,
      moved1s: Math.round(moved1s * 10) / 10,
      delta8s: Math.round((delta8s + swapJump * 0) * 10) / 10,
      finishDelta: Math.round(finishDelta * 100) / 100,
      staminaDelta: Math.round(staminaDelta * 10) / 10,
      shield
    };
  });
}

if (process.argv[1]?.includes('audit-augments')) {
  const rows = auditAll();
  console.log('카드 | 등급 | 구분 | 대상 | 1초 이동 | 8초 뒤 차이 | 지구력 | 완주 시각 차이(초) | 판정');
  for (const r of rows) {
    let verdict = 'OK';
    const moves = !['shield', 'staminaRestorePct', 'staminaDrainPct'].includes(r.effectType);
    if (r.effectType === 'gamble') verdict = '반반 (모 또는 도)';
    // 누가 득을 볼지 상황에 따라 달라지는 카드: 8초 뒤 위치 차이로는 판정할 수 없어 테스트('판을 흔드는 카드')에서 따로 본다
    else if (r.effectType === 'pairUp') verdict = '두 말이 가운데로 모임 (따로 검사)';
    else if (r.effectType === 'shuffleAll') verdict = '자리를 무작위로 섞음 (따로 검사)';
    // 결승선 당기기는 위치가 아니라 완주 시각이 당겨진다
    else if (r.effectType === 'finishLine') verdict = r.finishDelta < -0.2 ? 'OK' : '⚠ 효과 거의 없음';
    else if (moves) {
      if (Math.abs(r.delta8s) < 2) verdict = '⚠ 효과 거의 없음';
      else if (r.hostile && r.delta8s > 0) verdict = '⚠ 방해인데 빨라짐';
      else if (!r.hostile && r.delta8s < 0) verdict = '⚠ 강화인데 느려짐';
    }
    if (r.effectType === 'reverse' && r.moved1s >= 0) verdict = '⚠ 뒤로 가지 않음';
    console.log(
      `${r.name} | ${r.tier} | ${r.hostile ? '방해' : '강화'} | ${r.targets.join(',') || '-'} | ${r.moved1s} | ${r.delta8s} | ${r.staminaDelta} | ${r.finishDelta} | ${verdict}`
    );
  }
}

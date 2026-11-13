import type { AugmentDefinition } from './types';

const ALL_PHASES = [1, 2, 3, 4, 5];
/** 라운드 종료까지 지속 (실질적 무제한) */
const PERMANENT = 10 * 60 * 1000;

// ============================================================
// 증강 카드 풀 — 기획서 15장 기준
// 능력치를 바꾸는 6마리 전체 대상 증강은 없다. 전체 대상은 판 자체를 바꾸는 전설 카드 두 장뿐이다.
// 위치 교환(swap16)은 75% 구간(3차)에서 등장하지 않는다.
// ============================================================

export const AUGMENTS: AugmentDefinition[] = [
  // ---------- 15.1 단일 강화 ----------
  { id: 'muscle_awakening', name: '득근 각성', description: '당근 단백질의 힘!\n속력 +8%, 라운드 끝까지', rarity: 'epic', targetType: 'single', effectType: 'speedMult', value: 0.08, durationMs: PERMANENT, allowedPhases: ALL_PHASES, hostile: false, emoji: '💪', visual: 'muscle' },
  { id: 'rocket_booster', name: '엉덩이 로켓', description: '엉덩이에 불이 붙었다!\n속력 +60%, 4초', rarity: 'rare', targetType: 'single', effectType: 'speedMult', value: 0.6, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🚀', anim: 'boost', visual: 'rocket' },
  { id: 'angel_wings', name: '목 프로펠러', description: '목을 헬리콥터처럼 돌려 날아오른다.\n속력 +50%, 방해 면역, 3초', rarity: 'rare', targetType: 'single', effectType: 'fly', value: 0.5, durationMs: 3000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🚁', anim: 'flying' },
  { id: 'infinite_stamina', name: '물통 원샷', description: '벌컥벌컥!\n지구력 20% 회복', rarity: 'rare', targetType: 'single', effectType: 'staminaRestorePct', value: 20, durationMs: 0, allowedPhases: ALL_PHASES, hostile: false, emoji: '🪣' },
  { id: 'feather_body', name: '간헐적 단식', description: '굶어서 몸무게가 절반이 된다.\n속력 +19%, 5초', rarity: 'common', targetType: 'single', effectType: 'weightMult', value: 0.5, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🪶', visual: 'slim' },
  { id: 'teleport', name: '지름길 발견', description: '어, 이쪽이 더 빠르네?\n코스 3% 건너뛰기', rarity: 'rare', targetType: 'single', effectType: 'teleport', value: 0.03, durationMs: 0, allowedPhases: ALL_PHASES, hostile: false, emoji: '🧭', visual: 'warp', visualMs: 700 },
  { id: 'last_spurt', name: '결승선 냄새', description: '킁킁, 결승선이다! 순위가 낮을수록 빨라진다.\n속력 +20~45%, 5초', rarity: 'rare', targetType: 'single', effectType: 'rankBasedSpeed', value: 0, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: false, emoji: '👃', anim: 'boost' },
  { id: 'shield', name: '뽁뽁이 갑옷', description: '뽁뽁이로 둘둘 감는다.\n다음 방해 1회 무효', rarity: 'rare', targetType: 'single', effectType: 'shield', value: 1, durationMs: 0, allowedPhases: ALL_PHASES, hostile: false, emoji: '🛡️' },

  // ---------- 15.2 단일 방해 ----------
  { id: 'bulk_up', name: '건초 폭식', description: '건초를 너무 많이 먹어 몸무게가 3배가 된다.\n속력 -24%, 6초', rarity: 'rare', targetType: 'single', effectType: 'weightMult', value: 3.0, durationMs: 6000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🌾', visual: 'bulk' },
  { id: 'sudden_sleep', name: '식곤증', description: '점심 먹고 꾸벅꾸벅…\n정지, 1.5초', rarity: 'rare', targetType: 'single', effectType: 'stop', value: 0, durationMs: 1500, allowedPhases: ALL_PHASES, hostile: true, emoji: '😴', anim: 'stunned', visual: 'nap' },
  { id: 'banana_peel', name: '바나나 껍질', description: '미끄덩! 넘어진다.\n속력 -50%, 2초', rarity: 'common', targetType: 'single', effectType: 'speedMult', value: -0.5, durationMs: 2000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🍌', anim: 'fallen', visual: 'flip' },
  { id: 'leg_tangle', name: '스텝 꼬임', description: '네 다리가 서로 싸운다.\n속력 -40%, 5초', rarity: 'rare', targetType: 'single', effectType: 'speedMult', value: -0.4, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🪢', anim: 'slow', visual: 'wobble' },
  { id: 'reverse_instinct', name: '마구간에 당근 두고 왔다', description: '아 맞다, 내 당근! 왔던 길을 되돌아간다.\n뒤로 달림, 1초', rarity: 'epic', targetType: 'single', effectType: 'reverse', value: 0, durationMs: 1000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🥕', anim: 'reverse', visual: 'backpedal' },
  { id: 'poop_signal', name: '급똥 신호', description: '배에서 신호가 온다…\n속력 -35%, 2초', rarity: 'common', targetType: 'single', effectType: 'speedMult', value: -0.35, durationMs: 2000, allowedPhases: ALL_PHASES, hostile: true, emoji: '💩', anim: 'slow', visual: 'poop' },
  { id: 'mukbang', name: '당근 먹방', description: '구독과 좋아요! 멈춰서 당근을 먹는다.\n정지, 2초', rarity: 'rare', targetType: 'single', effectType: 'stop', value: 0, durationMs: 2000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🥕', anim: 'stunned', visual: 'eat' },
  { id: 'stamina_steal', name: '하품 전염', description: '하아암… 옮았다.\n지구력 30% 감소', rarity: 'rare', targetType: 'single', effectType: 'staminaDrainPct', value: 30, durationMs: 0, allowedPhases: ALL_PHASES, hostile: true, emoji: '🥱', visual: 'droop', visualMs: 2600 },

  // ---------- 15.3 홀수·짝수 ----------
  { id: 'odd_bless', name: '홀수 떡상', description: '1·3·5번 떡상!\n속력 +20%, 4초', rarity: 'common', targetType: 'odd', effectType: 'speedMult', value: 0.2, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: false, emoji: '✨' },
  { id: 'odd_curse', name: '홀수 떡락', description: '1·3·5번 떡락…\n속력 -20%, 4초', rarity: 'common', targetType: 'odd', effectType: 'speedMult', value: -0.2, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🌧️' },
  { id: 'even_bless', name: '짝수 떡상', description: '2·4·6번 떡상!\n속력 +20%, 4초', rarity: 'common', targetType: 'even', effectType: 'speedMult', value: 0.2, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🌟' },
  { id: 'even_curse', name: '짝수 떡락', description: '2·4·6번 떡락…\n속력 -20%, 4초', rarity: 'common', targetType: 'even', effectType: 'speedMult', value: -0.2, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: true, emoji: '⛈️' },
  { id: 'odd_bulk', name: '홀수 건초 파티', description: '1·3·5번 단체 건초 파티. 몸무게가 1.5배가 된다.\n속력 -10%, 5초', rarity: 'common', targetType: 'odd', effectType: 'weightMult', value: 1.5, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🌾', visual: 'bulk' },
  { id: 'even_diet', name: '짝수 새벽 훈련', description: '2·4·6번 지옥의 새벽 훈련. 몸무게가 40% 빠진다.\n속력 +14%, 5초', rarity: 'common', targetType: 'even', effectType: 'weightMult', value: 0.6, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🌅', visual: 'slim' },

  // ---------- 15.4 선두권·하위권 ----------
  { id: 'front_check', name: '꼬리 물기', description: '뒤에서 꼬리를 덥석!\n속력 -25%, 4초', rarity: 'common', targetType: 'front3', effectType: 'speedMult', value: -0.25, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: true, emoji: '😬' },
  { id: 'front_sprint', name: '될놈될', description: '될 놈은 된다.\n속력 +20%, 4초', rarity: 'common', targetType: 'front3', effectType: 'speedMult', value: 0.2, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🏇' },
  { id: 'back_rebellion', name: '꼴찌들의 반란', description: '더는 못 참아!\n속력 +30%, 5초', rarity: 'rare', targetType: 'back3', effectType: 'speedMult', value: 0.3, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: false, emoji: '⚡' },
  { id: 'back_swamp', name: '안될안', description: '안 될 놈은 안 된다.\n속력 -20%, 4초', rarity: 'common', targetType: 'back3', effectType: 'speedMult', value: -0.2, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🕸️' },
  { id: 'front_fatigue', name: '선두는 외로워', description: '앞에서 바람을 다 맞는다.\n지구력 20% 감소', rarity: 'rare', targetType: 'front3', effectType: 'staminaDrainPct', value: 20, durationMs: 0, allowedPhases: ALL_PHASES, hostile: true, emoji: '🥵' },
  { id: 'back_recover', name: '꼴찌 전용 각설탕', description: '달콤한 각설탕 한 알.\n지구력 18% 회복', rarity: 'epic', targetType: 'back3', effectType: 'staminaRestorePct', value: 18, durationMs: 0, allowedPhases: ALL_PHASES, hostile: false, emoji: '🍬' },
  { id: 'first_suffering', name: '이른 세리머니', description: '벌써 이긴 줄 알고 포즈를 잡는다.\n정지, 1초', rarity: 'rare', targetType: 'rank1', effectType: 'stop', value: 0, durationMs: 1000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🙌', anim: 'stunned', visual: 'pose' },
  { id: 'last_miracle', name: '꼴찌의 분노', description: '나만 뒤처질 순 없다!\n속력 +60%, 3초', rarity: 'rare', targetType: 'rank6', effectType: 'speedMult', value: 0.6, durationMs: 3000, allowedPhases: ALL_PHASES, hostile: false, emoji: '😤', anim: 'boost' },

  // ---------- 15.5 능력치 기반 ----------
  { id: 'slow_cheer', name: '느림보 팬클럽', description: '팬들이 왔다!\n속력 +30%, 4초', rarity: 'common', targetType: 'slowest2', effectType: 'speedMult', value: 0.3, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: false, emoji: '📣' },
  { id: 'catch_fast', name: '고삐 당기기', description: '워워, 천천히!\n속력 -25%, 4초', rarity: 'common', targetType: 'fastest2', effectType: 'speedMult', value: -0.25, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🪢', visual: 'siren' },
  { id: 'fat_strike', name: '뚱보들의 역습', description: '무게는 곧 힘이다.\n속력 +35%, 4초', rarity: 'rare', targetType: 'heaviest2', effectType: 'speedMult', value: 0.35, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🐷' },
  { id: 'light_feather', name: '헬륨 가스', description: '둥실둥실. 몸무게가 절반이 된다.\n속력 +19%, 5초', rarity: 'common', targetType: 'heaviest2', effectType: 'weightMult', value: 0.5, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🎈', visual: 'balloon' },
  { id: 'stamina_sap', name: '헉헉 방전', description: '헉… 헉… 너무 달렸다.\n지구력 25% 감소', rarity: 'rare', targetType: 'mostStamina2', effectType: 'staminaDrainPct', value: 25, durationMs: 0, allowedPhases: ALL_PHASES, hostile: true, emoji: '😮‍💨', visual: 'lowbat', visualMs: 2600 },
  { id: 'energy_drink', name: '에너지 드링크', description: '원샷!\n지구력 12% 회복', rarity: 'rare', targetType: 'leastStamina2', effectType: 'staminaRestorePct', value: 12, durationMs: 0, allowedPhases: ALL_PHASES, hostile: false, emoji: '🥤', visual: 'jitter', visualMs: 2600 },

  // ---------- 15.6 특수 조건 ----------
  { id: 'popular_tragedy', name: '우승 후보 병', description: '벌써 우승한 줄 안다.\n속력 -30%, 4초', rarity: 'common', targetType: 'mostBetWin', effectType: 'speedMult', value: -0.3, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: true, emoji: '👑', visual: 'bighead' },
  { id: 'unpopular_rebellion', name: '무관심이 약', description: '아무도 안 볼 때 잘한다.\n속력 +35%, 4초', rarity: 'common', targetType: 'leastBetWin', effectType: 'speedMult', value: 0.35, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: false, emoji: '📈' },
  { id: 'extreme_swap', name: '말생 역전', description: '말 팔자 뒤웅박!\n1등과 6등 위치 교체', rarity: 'legendary', targetType: 'swap16', effectType: 'swapPositions', value: 0, durationMs: 0, allowedPhases: [1, 2, 3, 4], hostile: true, emoji: '🔀', visual: 'swap', visualMs: 1000 },
  { id: 'no_middle', name: '중간은 싫어', description: '어중간한 건 못 참아.\n속력 +40%, 3초', rarity: 'common', targetType: 'rank34', effectType: 'speedMult', value: 0.4, durationMs: 3000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🙃' },
  { id: 'retake_lead', name: '만년 2등의 한', description: '이번엔 내가 1등!\n속력 +45%, 3초', rarity: 'common', targetType: 'rank2', effectType: 'speedMult', value: 0.45, durationMs: 3000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🥈', anim: 'boost' },
  { id: 'escape_last', name: '꼴찌 탈출 넘버원', description: '꼴찌는 이제 그만!\n코스 2% 건너뛰기', rarity: 'rare', targetType: 'rank6', effectType: 'teleport', value: 0.02, durationMs: 0, allowedPhases: ALL_PHASES, hostile: false, emoji: '🏃' },
  { id: 'rival_duel', name: '라이벌 대결', description: '너한텐 못 져!\n속력 +30%, 3초', rarity: 'common', targetType: 'rank23', effectType: 'speedMult', value: 0.3, durationMs: 3000, allowedPhases: ALL_PHASES, hostile: false, emoji: '⚔️' },
  { id: 'popularity_crash', name: '관중 야유', description: '우우우~ 야유가 쏟아져 급제동한다.\n속도 -70% 후 가속력 -50%, 5초', rarity: 'common', targetType: 'mostBetTotal', effectType: 'accelMult', value: -0.5, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: true, emoji: '👎' },
  // ---------- 판을 흔드는 카드 (추가) ----------
  { id: 'love_whistle', name: '한눈팔기', description: '예쁜 말을 보고 휘파람을 분다.\n속력 -35%, 4초', rarity: 'rare', targetType: 'single', effectType: 'speedMult', value: -0.35, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: true, emoji: '😗', anim: 'slow', visual: 'whistle' },
  { id: 'magnet', name: '자석', description: '두 등수 앞의 말에게 철썩 달라붙는다. 4등 아래의 말만 고를 수 있다.\n두 등수 앞 말 바로 뒤까지 끌려감, 3초', rarity: 'epic', targetType: 'single', effectType: 'magnet', value: 6, durationMs: 3000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🧲', visual: 'magnet', targetRule: 'back3' },
  { id: 'side_by_side', name: '나란히 달리기', description: '옆 레인 말과 발을 맞춘다.\n가까운 옆 레인 말과 중간 지점으로 모임, 3초', rarity: 'rare', targetType: 'single', effectType: 'pairUp', value: 0, durationMs: 3000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🤝', visual: 'pair' },
  { id: 'piggyback', name: '어부바', description: '바로 앞 말 등에 업혀 간다. 업은 말은 무거워서 느려진다.\n앞 말과 함께 이동, 지구력 10% 회복, 4초', rarity: 'rare', targetType: 'single', effectType: 'piggyback', value: -0.1, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🙌', visual: 'ride', targetRule: 'notFirst' },
  { id: 'cheer_squad', name: '치어리더 등장', description: '꼴찌에게 응원단이 붙는다. 선두는 시끄러워서 집중이 안 된다.\n6등 속력 +40%, 1등 속력 -10%, 4초', rarity: 'rare', targetType: 'rank6', effectType: 'cheer', value: 0.4, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: false, emoji: '📣', anim: 'boost', visual: 'cheer' },
  { id: 'carrot_rod', name: '당근 낚싯대', description: '눈앞에 당근이 매달렸다. 끝내 못 먹고 허탈해한다.\n속력 +50%, 5초 뒤 정지 0.8초', rarity: 'rare', targetType: 'single', effectType: 'carrotRod', value: 0.5, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🎣', anim: 'boost', visual: 'carrot' },
  { id: 'sneeze_relay', name: '재채기 릴레이', description: '에취! 재채기가 뒤따르는 말에게 옮는다.\n속력 -25%, 2초. 끝나면 한 등수 뒤 말도 속력 -25%, 2초', rarity: 'common', targetType: 'single', effectType: 'sneeze', value: -0.25, durationMs: 2000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🤧', anim: 'slow', visual: 'sneeze' },
  { id: 'short_course', name: '결승선 당기기', description: '누가 결승선을 옮겨 놨다.\n결승선이 80% 지점으로 바뀜', rarity: 'legendary', targetType: 'all', effectType: 'finishLine', value: 0.8, durationMs: 0, allowedPhases: [1, 2, 3], hostile: false, emoji: '🏁', visual: 'surprise', visualMs: 900 },
  { id: 'musical_chairs', name: '자리 뽑기', description: '모두 제비를 뽑아 자리를 바꾼다.\n달리는 말 전부의 위치를 무작위로 섞음', rarity: 'legendary', targetType: 'all', effectType: 'shuffleAll', value: 0, durationMs: 0, allowedPhases: [1, 2, 3, 4], hostile: true, emoji: '🎲', visual: 'swap', visualMs: 1000, drawWeight: 0.5 },

  // ---------- 코믹 변신 (기획서 외 추가) — 효과는 단순하지만 말의 모습이 바뀐다 ----------
  { id: 'cool_shades', name: '간지 폭발', description: '선글라스를 쓴다.\n속력 +20%, 5초', rarity: 'common', targetType: 'single', effectType: 'speedMult', value: 0.2, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🕶️', visual: 'shades' },
  { id: 'paper_horse', name: '종이 말', description: '종이처럼 납작해져 바람을 가른다.\n속력 +25%, 4초', rarity: 'common', targetType: 'single', effectType: 'speedMult', value: 0.25, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: false, emoji: '📄', visual: 'paper' },
  { id: 'bunny_hop', name: '깡충깡충', description: '토끼처럼 뛰어다닌다.\n속력 -25%, 4초', rarity: 'common', targetType: 'single', effectType: 'speedMult', value: -0.25, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🐇', visual: 'hop' },
  { id: 'moonwalk', name: '문워크', description: '뒤돌아서 문워크를 춘다.\n속력 -40%, 3초', rarity: 'common', targetType: 'single', effectType: 'speedMult', value: -0.4, durationMs: 3000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🕺', visual: 'moonwalk' },
  { id: 'bipedal', name: '이족보행', description: '두 발로 일어나 뛴다.\n속력 -35%, 4초', rarity: 'rare', targetType: 'single', effectType: 'speedMult', value: -0.35, durationMs: 4000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🚶', visual: 'bipedal' },
  { id: 'pony_morph', name: '조랑말 변신', description: '조랑말이 되어 버린다.\n속력 -30%, 5초', rarity: 'rare', targetType: 'single', effectType: 'speedMult', value: -0.3, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🐴', visual: 'pony' },
  { id: 'giraffe_neck', name: '기린 목', description: '목이 쭉 늘어난다.\n속력 +40%, 4.5초', rarity: 'rare', targetType: 'single', effectType: 'speedMult', value: 0.4, durationMs: 4500, allowedPhases: ALL_PHASES, hostile: false, emoji: '🦒', visual: 'giraffe' },
  { id: 'fart_boost', name: '방귀 부스터', description: '뿡!\n속력 +70%, 3초', rarity: 'rare', targetType: 'single', effectType: 'speedMult', value: 0.7, durationMs: 3000, allowedPhases: ALL_PHASES, hostile: false, emoji: '☁️', anim: 'boost', visual: 'fart' },
  { id: 'dizzy_spin', name: '빙글빙글', description: '팽이처럼 돌면서 달린다.\n속력 -50%, 3초', rarity: 'rare', targetType: 'single', effectType: 'speedMult', value: -0.5, durationMs: 3000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🌀', visual: 'spin' },
  { id: 'balloon_horse', name: '풍선 말', description: '풍선처럼 부풀어 둥실둥실 떠간다.\n속력 +50%, 5초', rarity: 'epic', targetType: 'single', effectType: 'speedMult', value: 0.5, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🎈', visual: 'balloon' },
  { id: 'giant_horse', name: '거대화', description: '몸집이 2배로 커진다.\n속력 +55%, 5초', rarity: 'epic', targetType: 'single', effectType: 'speedMult', value: 0.55, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: false, emoji: '🦖', visual: 'giant' },
  { id: 'disco_time', name: '디스코 타임', description: '음악이 나오면 춤을 참을 수 없다.\n정지, 1초', rarity: 'epic', targetType: 'front3', effectType: 'stop', value: 0, durationMs: 1000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🪩', visual: 'disco' },
  { id: 'pony_party', name: '단체 조랑말', description: '단체로 조랑말이 되어 버린다.\n속력 -35%, 5초', rarity: 'epic', targetType: 'front3', effectType: 'speedMult', value: -0.35, durationMs: 5000, allowedPhases: ALL_PHASES, hostile: true, emoji: '🎠', visual: 'pony' }
];

export const AUGMENT_BY_ID: Record<string, AugmentDefinition> = Object.fromEntries(
  AUGMENTS.map((a) => [a.id, a])
);

export const TARGET_TYPE_LABELS: Record<string, string> = {
  single: '말 1마리 선택',
  odd: '홀수 번호 (1·3·5)',
  even: '짝수 번호 (2·4·6)',
  front3: '현재 선두권 (1~3등)',
  back3: '현재 하위권 (4~6등)',
  rank1: '현재 1등',
  rank2: '현재 2등',
  rank6: '현재 6등',
  rank23: '현재 2등과 3등',
  rank34: '현재 3등과 4등',
  fastest2: '기본 속력 상위 2마리',
  slowest2: '기본 속력 하위 2마리',
  heaviest2: '몸무게 상위 2마리',
  mostStamina2: '현재 지구력 상위 2마리',
  leastStamina2: '현재 지구력 하위 2마리',
  mostBetWin: '우승 배팅금 최다 말',
  leastBetWin: '우승 배팅금 최소 말',
  mostBetTotal: '전체 배팅금 최다 말',
  swap16: '현재 1등 ↔ 6등',
  all: '달리는 말 전부'
};

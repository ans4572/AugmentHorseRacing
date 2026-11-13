/** 말 번호(1~6)별 고정 색상 — 구분용 */
export const HORSE_COLORS = [
  '#e74c3c', // 1 빨강
  '#3498db', // 2 파랑
  '#2ecc71', // 3 초록
  '#f39c12', // 4 주황
  '#9b59b6', // 5 보라
  '#17b8a6'  // 6 청록
];

/** 코믹한 말 이름 풀 */
export const HORSE_NAMES = [
  '번개감자', '뚱뚱보', '퇴근마렵다', '월요병', '치킨러버', '로켓배송',
  '핵불닭', '당근중독', '야근요정', '숙면왕', '질주본능', '간식도둑',
  '낮잠천재', '커피수혈', '인절미', '떡상기원', '지각대장', '용돈탕진',
  '바람돌이', '꿀잠각', '파워당근', '삼겹살', '초코파이', '불금전사',
  '셀카장인', '복권기원', '배터리1퍼', '혼밥고수', '엉덩이춤', '방구대포',
  '칼퇴요정', '라면물조절', '알람무시', '택배왔다', '주말순삭', '와이파이',
  '통장텅장', '급식왕', '이불밖위험', '눈치백단', '뒷북장인', '새벽감성',
  '콧노래', '멍때리기', '군고구마', '물만두', '찹쌀떡', '호떡집불',
  '단짠단짠', '마감임박', '오타대장', '충전중', '자동저장', '재부팅'
];

/** NPC 이름과 성격 */
export const NPC_PROFILES: { persona: import('./types').NpcPersona; name: string }[] = [
  { persona: 'winner', name: '불꽃승부' },
  { persona: 'saboteur', name: '심술쟁이' },
  { persona: 'avenger', name: '복수의화신' },
  { persona: 'gambler', name: '올인왕' },
  { persona: 'angel', name: '하늘천사' },
  { persona: 'chaos', name: '혼돈대마왕' }
];

export const EMOTES = ['😂', '😱', '🔥', '👏', '😭', '🤬', '🙏', '🎉'];

/** 말 종류 정보와 등장 가중치 (겉모습 전용) */
export const BREED_INFO: Record<
  import('./types').HorseBreed,
  { label: string; emoji: string; weight: number }
> = {
  horse: { label: '말', emoji: '🐎', weight: 46 },
  zebra: { label: '얼룩말', emoji: '🦓', weight: 15 },
  unicorn: { label: '유니콘', emoji: '🦄', weight: 13 },
  donkey: { label: '당나귀', emoji: '🐴', weight: 13 },
  cow: { label: '젖소 무늬 말', emoji: '🐮', weight: 13 }
};

/** 컨디션 수치(화면 표기 1~10)를 다섯 단계로 나눈 사유 문구 */
const CONDITION_NOTES: string[][] = [
  // 1~2: 아주 나쁨
  [
    '부상에서 돌아온 지 사흘밖에 안 됐다.',
    '어젯밤 한숨도 못 잤다.',
    '아침에 먹은 당근이 체했다.',
    '감기 기운이 있어 콧물을 흘린다.',
    '어제 연습에서 발목을 삐끗했다.',
    '이사 온 마구간이 낯설어 밤새 서성였다.',
    '출발 직전까지 하품만 스무 번 했다.'
  ],
  // 3~4: 나쁨
  [
    '전날 잠을 설쳤다.',
    '연습 기록이 평소보다 조금 느렸다.',
    '아침밥을 절반만 먹었다.',
    '옆 칸 말과 다투고 기분이 상했다.',
    '오는 길에 차멀미를 했다.',
    '편자를 새로 갈아서 아직 어색하다.',
    '비 오는 날 연습하다 몸이 굳었다.'
  ],
  // 5~6: 보통
  [
    '평소와 다름없다.',
    '연습은 무난하게 마쳤다.',
    '잘 먹고 잘 잤다.',
    '특별히 좋지도 나쁘지도 않다.',
    '몸은 가벼운데 의욕은 그저 그렇다.',
    '조련사 말로는 "늘 하던 대로"란다.',
    '아침 산책을 얌전히 다녀왔다.'
  ],
  // 7~8: 좋음
  [
    '연습 폼이 좋았다.',
    '어젯밤 푹 자고 일어났다.',
    '아침밥을 두 그릇 비웠다.',
    '지난주부터 기록이 계속 오르고 있다.',
    '좋아하는 간식을 받고 신이 났다.',
    '몸풀기에서 발걸음이 가벼웠다.',
    '새 편자가 발에 꼭 맞는다.'
  ],
  // 9~10: 아주 좋음
  [
    '연습에서 개인 최고 기록을 냈다.',
    '몸 상태가 올해 들어 가장 좋다.',
    '아침부터 뛰고 싶어 문을 걷어찼다.',
    '조련사가 "오늘은 다르다"고 장담했다.',
    '열 시간을 자고 털에 윤기가 돈다.',
    '몸풀기에서 다른 말을 전부 따돌렸다.',
    '눈빛이 살아 있고 콧김이 뜨겁다.'
  ]
];

/**
 * 말의 컨디션 수치에 어울리는 가상의 사유를 돌려준다.
 * 같은 말은 라운드 내내, 모든 사람 화면에서 같은 문구가 나오도록 능력치로 고른다.
 */
export function conditionNote(horse: { id: number; name: string; stats: { speed: number; accel: number; stamina: number; weight: number; luck: number } }): string {
  const shown = Math.max(1, Math.min(10, Math.round(horse.stats.luck / 10)));
  const notes = CONDITION_NOTES[Math.floor((shown - 1) / 2)];
  const s = horse.stats;
  let hash = horse.id * 31 + s.speed * 7 + s.accel * 13 + s.stamina * 17 + s.weight * 3 + s.luck * 11;
  for (let i = 0; i < horse.name.length; i++) hash = (hash * 33 + horse.name.charCodeAt(i)) >>> 0;
  return notes[hash % notes.length];
}

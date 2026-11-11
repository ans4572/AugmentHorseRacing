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
  '셀카장인', '복권기원', '배터리1퍼', '혼밥고수', '엉덩이춤', '방구대포'
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

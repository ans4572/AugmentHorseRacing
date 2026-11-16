// ============================================================
// 경주 중 효과 기호 — 말과 같은 남색 외곽선, 납작한 색으로 그린 만화 기호.
// 별·불꽃·음표·눈송이에는 얼굴을, 쾅에는 의성어를, 느낌표·번개에는 강조선을 붙여 우스꽝스럽게 그린다.
// 이모지는 기기마다 그림이 다르고 광택 있는 3D 그림이라 툰 말과 어울리지 않는다.
// 자주 나오는 기호(화남, 번개, 반짝, 잠, 별, 음표, 느낌표 등)만 직접 그리고,
// 나머지(💩, 🦖처럼 그림 자체가 농담인 것)와 바람, 땀, 물방울, 하트는 이모지를 그대로 쓴다.
// 64×64 격자에 그린다. 경주 화면의 3D 스티커와 이름표 상태 아이콘이 같은 그림을 쓴다.
// 주소에 ?fx=emoji 를 붙이면 예전처럼 이모지만 쓴다 (비교용).
// ============================================================

const INK = '#1a2150';
const WHITE = '#ffffff';
const BLUE = '#74c0fc';
const YELLOW = '#ffe23f';
const RED = '#e8453c';
const PINK = '#ff8fb8';
const ORANGE = '#ff922b';
const PURPLE = '#b197fc';

type Draw = (g: CanvasRenderingContext2D) => void;

/** 속을 채운 도형 + 남색 외곽선 */
function blob(g: CanvasRenderingContext2D, d: string, fill: string, lw = 3.5): void {
  const p = new Path2D(d);
  g.fillStyle = fill;
  g.fill(p);
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke(p);
}

/** 굵은 선 + 남색 외곽선 (선 모양 기호) */
function line(g: CanvasRenderingContext2D, d: string, color: string, w = 5, outline = 4): void {
  const p = new Path2D(d);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.lineWidth = w + outline * 2;
  g.stroke(p);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke(p);
}

/** 밝은 쪽 윗부분에 찍는 작은 흰 광택 */
function shine(g: CanvasRenderingContext2D, d: string, w = 3): void {
  const p = new Path2D(d);
  g.lineCap = 'round';
  g.strokeStyle = WHITE;
  g.lineWidth = w;
  g.stroke(p);
}

function starPath(cx: number, cy: number, r1: number, r2: number, n = 5, rot = -Math.PI / 2): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = rot + (i * Math.PI) / n;
    d += `${i === 0 ? 'M' : 'L'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }
  return d + 'Z';
}

/** 귀여운 얼굴: 점 눈 + 웃는 입 + 볼터치 (cx, cy는 얼굴 가운데) */
function face(g: CanvasRenderingContext2D, cx: number, cy: number, s = 1, mood: 'smile' | 'angry' | 'happy' = 'smile'): void {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.fillStyle = 'rgba(255, 120, 150, 0.55)';
  g.beginPath();
  g.ellipse(-10, 4, 3.6, 2.4, 0, 0, Math.PI * 2);
  g.ellipse(10, 4, 3.6, 2.4, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineCap = 'round';
  g.lineWidth = 2.6;
  if (mood === 'happy') {
    // 눈웃음 ^ ^
    g.beginPath();
    g.moveTo(-8.5, -1);
    g.lineTo(-6, -4);
    g.lineTo(-3.5, -1);
    g.moveTo(3.5, -1);
    g.lineTo(6, -4);
    g.lineTo(8.5, -1);
    g.stroke();
  } else {
    g.beginPath();
    g.ellipse(-6, -2, 2.3, 3, 0, 0, Math.PI * 2);
    g.ellipse(6, -2, 2.3, 3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = WHITE;
    g.beginPath();
    g.arc(-5.3, -3.2, 0.9, 0, Math.PI * 2);
    g.arc(6.7, -3.2, 0.9, 0, Math.PI * 2);
    g.fill();
    if (mood === 'angry') {
      // 잔뜩 성난 눈썹
      g.beginPath();
      g.moveTo(-10, -9);
      g.lineTo(-3, -6);
      g.moveTo(10, -9);
      g.lineTo(3, -6);
      g.stroke();
    }
  }
  g.beginPath();
  if (mood === 'angry') {
    // 이를 악문 입
    g.fillStyle = WHITE;
    g.rect(-5, 3, 10, 4.5);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(0, 3);
    g.lineTo(0, 7.5);
    g.stroke();
  } else {
    g.arc(0, 2.5, 3.6, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
  }
  g.restore();
}

/** 만화 의성어: 남색 테두리를 두른 굵은 글자 */
function word(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, rot = 0): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.font = `900 ${size}px Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.32;
  g.strokeStyle = INK;
  g.strokeText(text, 0, 0);
  g.fillStyle = color;
  g.fillText(text, 0, 0);
  g.restore();
}

/** 강조선: 기호 둘레에 짧게 뻗는 선 */
function burstLines(g: CanvasRenderingContext2D, lines: string): void {
  const p = new Path2D(lines);
  g.lineCap = 'round';
  g.strokeStyle = INK;
  g.lineWidth = 3.2;
  g.stroke(p);
}

/** 들쭉날쭉한 폭발 모양 (뾰족한 끝 길이가 제각각이다) */
function jagged(cx: number, cy: number, radii: number[], rot = 0): string {
  let d = '';
  radii.forEach((r, i) => {
    const a = rot + (i * Math.PI * 2) / radii.length;
    d += `${i === 0 ? 'M' : 'L'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  });
  return d + 'Z';
}

const anger: Draw = (g) => {
  // 만화 핏줄 마크: 네 변에 하나씩, 가운데 쪽으로 오목하게 휜 통통한 조각
  g.save();
  for (let i = 0; i < 4; i++) {
    g.translate(32, 32);
    g.rotate(Math.PI / 2);
    g.translate(-32, -32);
    line(g, 'M12 8Q32 29 52 8', RED, 8, 3.5);
  }
  g.restore();
};

const bolt: Draw = (g) => {
  burstLines(g, 'M6 16l7 4M5 30h8M56 38l-7-3M58 50l-7-1M47 6l-3 6');
  blob(g, 'M38 3L13 36H29L23 61L51 25H35Z', YELLOW, 4);
  // 찌릿: 번개 안쪽의 밝은 줄
  shine(g, 'M33 10L22 29', 2.6);
};

const sparkle: Draw = (g) => {
  blob(g, 'M27 3Q30 23 47 27Q30 31 27 51Q24 31 7 27Q24 23 27 3Z', YELLOW);
  face(g, 27, 28, 0.62, 'happy');
  blob(g, 'M49 37Q50.4 46 59 47.5Q50.4 49 49 58Q47.6 49 39 47.5Q47.6 46 49 37Z', WHITE, 3);
  blob(g, 'M52 6a3.2 3.2 0 1 0 .01 0Z', WHITE, 2.5);
  blob(g, 'M9 50a2.6 2.6 0 1 0 .01 0Z', YELLOW, 2.5);
};

const zzz: Draw = (g) => {
  // 콧방울 + 삐뚤빼뚤 Z
  g.save();
  g.globalAlpha = 0.85;
  blob(g, 'M17 10a11 11 0 1 0 .01 0Z', '#d0ebff', 3);
  g.restore();
  shine(g, 'M10 18q1-4 5-5', 2.6);
  const zs: [number, number, number, number][] = [
    [14, 50, 1.15, -0.18],
    [33, 33, 0.9, 0.12],
    [50, 17, 0.7, -0.08]
  ];
  for (const [x, y, s, r] of zs) {
    g.save();
    g.translate(x, y);
    g.rotate(r);
    g.scale(s, s);
    blob(g, 'M-9-9h18l-1 4.5L-1 4h9l-1 5h-18l1-4.5L1-4h-9z', PURPLE, 3);
    g.restore();
  }
};

const dizzy: Draw = (g) => {
  // 빙글빙글 소용돌이 + 도는 별
  let d = '';
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = t * Math.PI * 4.2;
    const r = 2 + t * 17;
    d += `${i === 0 ? 'M' : 'L'}${(32 + Math.cos(a) * r).toFixed(2)} ${(32 + Math.sin(a) * r * 0.82).toFixed(2)}`;
  }
  line(g, d, YELLOW, 4.5, 3);
  blob(g, starPath(11, 49, 9, 4.2, 5, -1.2), YELLOW, 3);
  blob(g, starPath(53, 13, 8, 3.8, 5, -1.9), WHITE, 3);
};

const star: Draw = (g) => {
  blob(g, starPath(32, 34, 28, 13.5, 5, -Math.PI / 2 - 0.12), YELLOW, 4);
  face(g, 32, 37, 0.8, 'smile');
};

const boom: Draw = (g) => {
  blob(g, jagged(32, 32, [31, 19, 29, 16, 32, 20, 27, 15, 31, 18, 28, 17, 32, 16], 0.25), ORANGE, 3.5);
  blob(g, jagged(32, 33, [20, 12, 19, 10, 21, 12, 18, 11, 20, 11], -0.2), YELLOW, 3);
  word(g, '쾅!', 33, 34, 21, RED, -0.16);
};

const flame: Draw = (g) => {
  // 혀를 날름대는 불꽃 + 잔뜩 성난 표정
  blob(g, 'M33 2C38 12 46 14 49 24C51 19 50 15 49 12C56 19 58 30 54 42A22 21 0 0 1 10 42C7 33 10 25 15 20C15 25 17 28 20 30C18 20 23 9 33 2Z', ORANGE);
  blob(g, 'M32 22C38 31 47 35 46 45A14 13 0 0 1 18 45C18 37 26 32 32 22Z', YELLOW, 3);
  face(g, 32, 43, 0.72, 'angry');
};

const note1: Draw = (g) => {
  burstLines(g, 'M8 22q4-3 0-7M12 30q5-4 0-9');
  line(g, 'M37 46V8Q39 18 53 22', PINK, 5);
  g.save();
  g.translate(28, 47);
  g.rotate(-0.32);
  blob(g, 'M-11 0a11 8.5 0 1 0 22 0a11 8.5 0 1 0-22 0Z', PINK);
  g.restore();
  face(g, 28, 47, 0.42, 'happy');
};

const note2: Draw = (g) => {
  burstLines(g, 'M4 26q4-3 0-7M8 34q5-4 0-9');
  line(g, 'M25 46V13L53 7V40', PINK, 5);
  const heads: [number, number][] = [
    [18, 47],
    [46, 41]
  ];
  for (const [x, y] of heads) {
    g.save();
    g.translate(x, y);
    g.rotate(-0.32);
    blob(g, 'M-9.5 0a9.5 7.5 0 1 0 19 0a9.5 7.5 0 1 0-19 0Z', PINK);
    g.restore();
    face(g, x, y, 0.36, 'happy');
  }
};

const bang: Draw = (g) => {
  burstLines(g, 'M9 12l8 6M5 27h9M55 12l-8 6M59 27h-9');
  g.save();
  g.translate(32, 32);
  g.rotate(0.12);
  g.translate(-32, -32);
  blob(g, 'M23 3H41L37 41H27Z', RED, 4);
  blob(g, 'M32 46a7.5 7.5 0 1 0 .01 0Z', RED, 3.5);
  g.restore();
};

const bang2: Draw = (g) => {
  burstLines(g, 'M4 16l6 4M3 29h7M60 16l-6 4M61 29h-7');
  const bars: [number, number][] = [
    [20, -0.1],
    [44, 0.12]
  ];
  for (const [x, r] of bars) {
    g.save();
    g.translate(x, 32);
    g.rotate(r);
    blob(g, 'M-8-29H8L5 9H-5Z', RED, 3.5);
    blob(g, 'M0 14a6 6 0 1 0 .01 0Z', RED, 3);
    g.restore();
  }
};

const question: Draw = (g) => {
  burstLines(g, 'M50 8l4-5M55 16l6-2M9 12l-5-3');
  g.save();
  g.translate(32, 32);
  g.rotate(-0.14);
  g.translate(-32, -32);
  line(g, 'M20 20A12 12 0 1 1 38 30Q32 34 32 41', BLUE, 7, 3.5);
  blob(g, 'M32 47a6.5 6.5 0 1 0 .01 0Z', BLUE, 3.5);
  g.restore();
  // 갸우뚱 땀 한 방울
  blob(g, 'M52 30C54 34 56 36 56 39a4 4 0 0 1-8 0C48 36 50 34 52 30Z', '#a5d8ff', 2.5);
};

const steam: Draw = (g) => {
  // 부글부글 화난 김 덩이: 찌푸린 눈과 머리 위로 피어오르는 김
  line(g, 'M21 24c-5-5 5-8 0-14', WHITE, 4, 3);
  line(g, 'M33 20c-5-5 5-8 0-14', WHITE, 4, 3);
  line(g, 'M45 24c-5-5 5-8 0-14', WHITE, 4, 3);
  blob(g, 'M14 54a9 9 0 0 1 1-17a12 12 0 0 1 22-7a10 10 0 0 1 15 9a8 8 0 0 1-1 15Z', WHITE, 3.5);
  g.save();
  g.strokeStyle = INK;
  g.lineWidth = 2.8;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(23, 41);
  g.lineTo(29, 44);
  g.moveTo(41, 41);
  g.lineTo(35, 44);
  g.moveTo(28, 50);
  g.quadraticCurveTo(32, 47, 36, 50);
  g.stroke();
  g.restore();
};

const snow: Draw = (g) => {
  g.save();
  for (let i = 0; i < 3; i++) {
    g.translate(32, 32);
    g.rotate(Math.PI / 3);
    g.translate(-32, -32);
    line(g, 'M32 5V59M25 11l7 7 7-7M25 53l7-7 7 7', '#e7f5ff', 4, 3);
  }
  g.restore();
  blob(g, 'M32 21a11 11 0 1 0 .01 0Z', '#e7f5ff', 3);
  face(g, 32, 32, 0.55, 'smile');
};

const shield: Draw = (g) => {
  blob(g, 'M32 4L55 12V30C55 45 45 55 32 61C19 55 9 45 9 30V12Z', BLUE, 4);
  g.fillStyle = '#d0ebff';
  g.fill(new Path2D('M32 13L46 18V30C46 39 40 46 32 50Z'));
};

const finish: Draw = (g) => {
  blob(g, 'M10 5h6v56h-6z', WHITE, 3.5);
  blob(g, 'M16 7h40v28H16z', WHITE, 3.5);
  g.fillStyle = INK;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      if ((row + col) % 2 === 0) g.fillRect(16 + col * 10, 7 + row * 9.33, 10, 9.33);
    }
  }
};

/** 의성어 스티커: 남색 테두리를 두른 굵은 글자 (꺼억, 꼬르륵 등). 글자 수에 맞춰 크기를 줄인다 */
const sound =
  (text: string, color: string, rot = -0.12): Draw =>
  (g) => {
    const n = [...text].length;
    word(g, text, 32, 34, n >= 3 ? 19 : n === 2 ? 25 : 32, color, rot);
  };

/** 이모지 → 직접 그린 기호 */
const ART: Record<string, Draw> = {
  꺼억: sound('꺼억', '#a9e34b'),
  꼬르륵: sound('꼬르륵', '#b197fc', 0.1),
  '싫어!': sound('싫어!', '#ff6b6b'),
  '슉!': sound('슉!', '#ffffff', -0.2),
  쿵: sound('쿵', '#ced4da', 0.15),
  '💢': anger,
  '⚡': bolt,
  '✨': sparkle,
  '💤': zzz,
  '💫': dizzy,
  '⭐': star,
  '💥': boom,
  '🔥': flame,
  '🎵': note1,
  '🎶': note2,
  '❗': bang,
  '‼️': bang2,
  '❓': question,
  '♨️': steam,
  '❄️': snow,
  '🛡️': shield,
  '🏁': finish
};

const FORCE_EMOJI = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fx') === 'emoji';

/** 이 이모지를 직접 그린 기호로 바꾸는지 */
export function hasFxArt(emoji: string): boolean {
  return !FORCE_EMOJI && emoji in ART;
}

/**
 * 크기 size×size 캔버스에 기호를 그린다. 그린 기호가 없으면 false (호출한 쪽이 이모지를 그린다).
 * 외곽선이 잘리지 않게 사방에 조금 여백을 둔다.
 */
export function drawFxArt(g: CanvasRenderingContext2D, emoji: string, size: number): boolean {
  const draw = !FORCE_EMOJI ? ART[emoji] : undefined;
  if (!draw) return false;
  const s = (size / 64) * 0.86;
  g.save();
  g.translate((size - 64 * s) / 2, (size - 64 * s) / 2);
  g.scale(s, s);
  draw(g);
  g.restore();
  return true;
}

const urlCache = new Map<string, string>();

/** 이름표처럼 HTML에 넣을 그림 주소 (data:image/png). 그린 기호가 없으면 '' */
export function fxArtUrl(emoji: string): string {
  if (!hasFxArt(emoji)) return '';
  let url = urlCache.get(emoji);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    drawFxArt(c.getContext('2d')!, emoji, 64);
    url = c.toDataURL('image/png');
    urlCache.set(emoji, url);
  }
  return url;
}

/** 비교 화면용: 그린 기호가 있는 이모지 목록 */
export const FX_ART_EMOJIS: readonly string[] = Object.keys(ART);

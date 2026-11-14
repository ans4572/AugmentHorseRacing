// ============================================================
// 화면 글자 도우미 — HTML 이스케이프와 한국어 조사
// ============================================================

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/**
 * 다른 사람이 정한 이름(기수, 방, 말)을 innerHTML에 넣기 전에 바꾼다.
 * 따옴표도 바꾸므로 속성값(title, aria-label) 안에 넣어도 안전하다.
 */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** 낱말 끝 글자에 받침이 있으면 withFinal, 없으면 without. 한글로 끝나지 않으면 둘을 함께 적는다 */
export function particle(word: string, withFinal: string, without: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${withFinal}(${without})`;
  return code % 28 === 0 ? without : withFinal;
}

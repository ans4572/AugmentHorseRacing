import { describe, expect, it } from 'vitest';
import { TRACKS, noteToMidi, parseBar, parseChord, stepTime, type TrackName } from '../../client/src/music';

const NAMES: TrackName[] = ['menu', 'paddock', 'race'];

describe('배경음악 악보', () => {
  it('음 이름을 MIDI 번호로 바꾼다', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#5')).toBe(78);
    expect(noteToMidi('Bb5')).toBe(82);
    expect(() => noteToMidi('H4')).toThrow();
  });

  it('한 마디는 16칸이어야 한다', () => {
    expect(parseBar('C5:4 -:4 E5:8')).toEqual([
      { step: 0, len: 4, midi: 72 },
      { step: 8, len: 8, midi: 76 }
    ]);
    expect(() => parseBar('C5:4 E5:4')).toThrow();
    expect(() => parseBar('C5:20')).toThrow();
  });

  it('화음의 근음은 베이스 음역(G2~F#3) 안에 둔다', () => {
    for (const name of ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bb', 'Gm', 'D']) {
      const c = parseChord(name);
      expect(c.root).toBeGreaterThanOrEqual(43);
      expect(c.root).toBeLessThanOrEqual(54);
    }
    // 장조는 장3도, 단조는 단3도
    expect((parseChord('C').third - 60) % 12).toBe(4);
    expect((parseChord('Am').third - 60 + 12 - 9) % 12).toBe(3);
  });

  it.each(NAMES)('%s: 모든 사건이 곡 길이 안에 있고 칸 순서로 정렬된다', (name) => {
    const t = TRACKS[name];
    expect(t.steps % 16).toBe(0);
    expect(t.events.length).toBeGreaterThan(100);
    let prev = 0;
    for (const e of t.events) {
      expect(e.step).toBeGreaterThanOrEqual(prev);
      expect(e.step).toBeLessThan(t.steps);
      prev = e.step;
      if (e.kind === 'note') {
        expect(e.step + e.len).toBeLessThanOrEqual(t.steps);
        // 사각파가 귀를 찌르지 않는 음역 (E2 ~ G6)
        expect(e.midi).toBeGreaterThanOrEqual(40);
        expect(e.midi).toBeLessThanOrEqual(91);
      }
    }
  });

  it.each(NAMES)('%s: 가락·화음·베이스·북이 모두 들어 있다', (name) => {
    const t = TRACKS[name];
    const channels = new Set(t.events.flatMap((e) => (e.kind === 'note' ? [e.ch] : [])));
    expect([...channels].sort()).toEqual(['bass', 'harm', 'lead']);
    expect(t.events.some((e) => e.kind === 'drum')).toBe(true);
  });

  it('한 바퀴 길이가 15~40초라 금방 물리지 않는다', () => {
    for (const name of NAMES) {
      const t = TRACKS[name];
      const seconds = stepTime(t, t.steps);
      expect(seconds).toBeGreaterThan(15);
      expect(seconds).toBeLessThan(40);
    }
  });

  it('스윙은 뒷박만 늦춘다', () => {
    const t = TRACKS.paddock;
    const stepDur = 60 / t.bpm / 4;
    expect(stepTime(t, 0)).toBe(0);
    expect(stepTime(t, 4)).toBeCloseTo(4 * stepDur);
    expect(stepTime(t, 2)).toBeGreaterThan(2 * stepDur);
    expect(stepTime(t, 2)).toBeLessThan(3 * stepDur);
  });
});

// ============================================================
// 배경음악 악보 — 직접 지은 세 곡을 글자로 적어 두고 연주용 사건 목록으로 바꾼다.
// 브라우저 기능을 쓰지 않는 순수 계산이라 테스트에서 그대로 검사할 수 있다.
//
// 악보 적는 법
//   한 마디 = 16칸(16분음표 16개). 토큰은 공백으로 나누고 "|"는 눈으로 보기 위한 구분선이다.
//   "E5"   = E5를 1칸      "E5:3" = E5를 3칸
//   "-"    = 1칸 쉼        "-:2"  = 2칸 쉼
//   화음은 마디마다 "C" 또는 "F G"(반 마디씩)처럼 적는다. 단조는 "Am".
// ============================================================

export type TrackName = 'menu' | 'paddock' | 'race';
export type Channel = 'lead' | 'harm' | 'bass';
export type Drum = 'kick' | 'snare' | 'hat' | 'rim';

export type TrackEvent =
  | { kind: 'note'; step: number; len: number; midi: number; ch: Channel }
  | { kind: 'drum'; step: number; drum: Drum; vol: number };

export interface CompiledTrack {
  name: TrackName;
  bpm: number;
  /** 8분음표 뒷박을 늦추는 정도 (0이면 정박) */
  swing: number;
  /** 한 바퀴의 전체 칸 수 */
  steps: number;
  /** 칸 순서로 정렬된 사건 */
  events: TrackEvent[];
}

type Style = 'bounce' | 'tiptoe' | 'gallop';

interface Score {
  bpm: number;
  swing?: number;
  style: Style;
  /** 같은 악보를 몇 번 돌려 한 바퀴로 삼는가 (돌 때마다 반주가 조금 달라진다) */
  passes?: number;
  lead: string[];
  chords: string[];
}

const STEPS_PER_BAR = 16;
const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C#5" 같은 음 이름을 MIDI 번호로 (C4 = 60, A4 = 69) */
export function noteToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error(`음 이름을 읽을 수 없습니다: ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + SEMITONE[m[1]] + acc;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function hz(name: string): number {
  return midiToHz(noteToMidi(name));
}

/** 한 마디 악보를 [칸, 길이, 음] 목록으로. 16칸이 아니면 오류. */
export function parseBar(bar: string): { step: number; len: number; midi: number }[] {
  const out: { step: number; len: number; midi: number }[] = [];
  let step = 0;
  for (const tok of bar.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [head, lenText] = tok.split(':');
    const len = lenText ? Number(lenText) : 1;
    if (!Number.isInteger(len) || len < 1) throw new Error(`길이를 읽을 수 없습니다: ${tok}`);
    if (head !== '-') out.push({ step, len, midi: noteToMidi(head) });
    step += len;
  }
  if (step !== STEPS_PER_BAR) throw new Error(`마디 길이가 ${step}칸입니다 (16칸이어야 함): ${bar}`);
  return out;
}

interface Chord {
  /** 베이스가 짚는 근음 (G2~F#3) */
  root: number;
  third: number;
  fifth: number;
}

export function parseChord(name: string): Chord {
  const m = /^([A-G])([#b]?)(m?)$/.exec(name);
  if (!m) throw new Error(`화음을 읽을 수 없습니다: ${name}`);
  const pc = (SEMITONE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  let root = 36 + pc;
  while (root < 43) root += 12;
  const third = pc + (m[3] ? 3 : 4);
  const fifth = pc + 7;
  return { root, third: 60 + (third % 12), fifth: 60 + (fifth % 12) };
}

/** 근음 아래위 중 낮은 음역에 들어오는 5도 */
function bassFifth(root: number): number {
  return root + 7 <= 55 ? root + 7 : root - 5;
}

/** 한 마디의 반주(베이스·화음·북)를 스타일대로 만든다 */
function accompany(style: Style, chords: Chord[], bar: number, pass: number, lastOfPhrase: boolean): TrackEvent[] {
  const ev: TrackEvent[] = [];
  const note = (step: number, len: number, midi: number, ch: Channel): void => {
    ev.push({ kind: 'note', step, len, midi, ch });
  };
  const drum = (step: number, d: Drum, vol = 1): void => {
    ev.push({ kind: 'drum', step, drum: d, vol });
  };
  const stab = (step: number, c: Chord): void => {
    note(step, 1, c.third, 'harm');
    note(step, 1, c.fifth, 'harm');
  };
  const chordAt = (half: number): Chord => chords[Math.min(half, chords.length - 1)];

  if (style === 'bounce') {
    // 쿵-짝 쿵-짝: 베이스가 정박, 화음이 뒷박
    for (let half = 0; half < 2; half++) {
      const c = chordAt(half);
      const o = half * 8;
      note(o, 2, c.root, 'bass');
      note(o + 2, 1, c.root + 12, 'bass');
      note(o + 4, 2, bassFifth(c.root), 'bass');
      note(o + 6, 1, c.root + 12, 'bass');
      stab(o + 2, c);
      stab(o + 6, c);
    }
    drum(0, 'kick');
    drum(8, 'kick');
    if (bar % 2 === 1) drum(10, 'kick', 0.7);
    drum(4, 'snare');
    if (lastOfPhrase) {
      for (const s of [12, 14, 15]) drum(s, 'snare', s === 12 ? 1 : 0.7);
    } else {
      drum(12, 'snare');
    }
    for (let s = 0; s < 16; s += 2) drum(s, 'hat', s % 4 === 2 ? 0.8 : 0.45);
  } else if (style === 'tiptoe') {
    // 살금살금: 걷는 베이스에 가벼운 딱 소리만
    if (chords.length === 1) {
      const c = chords[0];
      note(0, 2, c.root, 'bass');
      note(4, 2, c.third - 12, 'bass');
      note(8, 2, bassFifth(c.root), 'bass');
      note(12, 2, c.third - 12, 'bass');
    } else {
      for (let half = 0; half < 2; half++) {
        const c = chordAt(half);
        note(half * 8, 2, c.root, 'bass');
        note(half * 8 + 4, 2, bassFifth(c.root), 'bass');
      }
    }
    drum(0, 'kick', 0.6);
    drum(8, 'kick', 0.4);
    drum(4, 'rim');
    drum(12, 'rim');
    if (pass === 0) {
      drum(6, 'hat', 0.35);
      drum(14, 'hat', 0.35);
    } else {
      stab(6, chordAt(0));
      stab(14, chordAt(1));
      for (const s of [2, 6, 10, 14]) drum(s, 'hat', 0.4);
    }
    if (lastOfPhrase) drum(15, 'rim', 0.7);
  } else {
    // 말발굽: 다-다닥 다-다닥
    for (let beat = 0; beat < 4; beat++) {
      const c = chordAt(beat < 2 ? 0 : 1);
      const fifthBeat = chords.length === 1 ? beat === 2 : beat % 2 === 1;
      const n = fifthBeat ? bassFifth(c.root) : c.root;
      const o = beat * 4;
      note(o, 2, n, 'bass');
      note(o + 2, 1, n, 'bass');
      note(o + 3, 1, n, 'bass');
      stab(o + 2, c);
      drum(o, 'kick', beat % 2 === 0 ? 1 : 0.7);
      drum(o, 'hat', 0.4);
      drum(o + 2, 'hat', 0.55);
      drum(o + 3, 'hat', 0.4);
    }
    if (lastOfPhrase) {
      for (const s of [4, 8, 10, 12, 13, 14, 15]) drum(s, 'snare', s >= 13 ? 0.75 : 1);
    } else {
      drum(4, 'snare');
      drum(12, 'snare');
    }
  }
  return ev;
}

function compile(name: TrackName, score: Score): CompiledTrack {
  if (score.lead.length !== score.chords.length) {
    throw new Error(`${name}: 가락과 화음의 마디 수가 다릅니다`);
  }
  const passes = score.passes ?? 1;
  const bars = score.lead.length;
  const events: TrackEvent[] = [];
  for (let pass = 0; pass < passes; pass++) {
    for (let bar = 0; bar < bars; bar++) {
      const base = (pass * bars + bar) * STEPS_PER_BAR;
      for (const n of parseBar(score.lead[bar])) {
        events.push({ kind: 'note', step: base + n.step, len: n.len, midi: n.midi, ch: 'lead' });
      }
      const chords = score.chords[bar].trim().split(/\s+/).map(parseChord);
      if (chords.length > 2) throw new Error(`${name}: 한 마디에 화음은 둘까지입니다`);
      for (const e of accompany(score.style, chords, bar, pass, bar % 8 === 7)) {
        events.push({ ...e, step: base + e.step });
      }
    }
  }
  events.sort((a, b) => a.step - b.step);
  return {
    name,
    bpm: score.bpm,
    swing: score.swing ?? 0,
    steps: passes * bars * STEPS_PER_BAR,
    events
  };
}

/** n번째 칸이 시작되는 시각(초). 스윙이 있으면 뒷박이 조금 늦게 온다. */
export function stepTime(track: CompiledTrack, absStep: number): number {
  const stepDur = 60 / track.bpm / 4;
  const phase = absStep % 4;
  const late = phase === 2 ? track.swing : phase === 3 ? track.swing / 2 : 0;
  return (absStep + late) * stepDur;
}

// ---------------- 악보 ----------------

/** 메뉴·대기실: 통통 튀는 다장조 행진 */
const MENU: Score = {
  bpm: 144,
  style: 'bounce',
  lead: [
    'C5:2 E5:2 G5:2 E5 G5 | A5:2 G5:2 E5:2 -:2',
    'C5:2 E5:2 G5:2 E5 G5 | C6:3 A5 G5:2 -:2',
    'A5:2 F5:2 A5:2 C6:2 | D6:2 C6:2 A5:2 -:2',
    'B5:2 G5:2 B5 D6 B5:2 | G5:2 A5:2 B5:2 D6:2',
    'E6:3 D6 C6:2 G5:2 | E5:2 G5:2 C6:2 -:2',
    'E6:3 D6 C6:2 A5:2 | E5:2 A5:2 C6:2 -:2',
    'A5 A5 - A5 C6:2 A5:2 | B5 B5 - B5 D6:2 B5:2',
    'C6:2 -:2 G5:2 -:2 | C6:2 - C6 C6:2 -:2',
    'A5:2 C6:2 E6:2 C6:2 | A5:2 C6 E6 -:2 E6:2',
    'G5:2 B5:2 E6:2 B5:2 | G5:2 B5 E6 -:2 D6:2',
    'C6:3 A5 F5:2 A5:2 | C6:2 F6:2 E6:2 C6:2',
    'G5:3 E5 C5:2 E5:2 | G5:2 C6:2 -:2 G5:2',
    'A5:2 C6:2 E6:2 C6:2 | A5:2 C6 E6 -:2 E6:2',
    'G5:2 B5:2 E6:2 B5:2 | G6:3 E6 D6:2 B5:2',
    'D6:2 F6:2 D6:2 A5:2 | F5:2 A5:2 D6:2 F6:2',
    'G6:2 -:2 D6:2 -:2 | G6 F6 E6 D6 C6 B5 A5 G5'
  ],
  chords: ['C', 'C', 'F', 'G', 'C', 'Am', 'F G', 'C', 'Am', 'Em', 'F', 'C', 'Am', 'Em', 'Dm', 'G']
};

/** 출마표·배팅: 살금살금 고민하는 바장조 */
const PADDOCK: Score = {
  bpm: 112,
  swing: 0.5,
  style: 'tiptoe',
  passes: 2,
  lead: [
    'F5 - A5 - C6 - A5 - | F5 - A5 C6 -:2 C6:2',
    'D5 - F5 - A5 - F5 - | D5 - F5 A5 -:2 A5:2',
    'D5 - F5 - Bb5 - F5 - | D6:2 C6:2 Bb5:2 G5:2',
    'E5 - G5 - C6 - G5 - | E6:2 -:2 C6 D6 E6 -',
    'F6:3 E6 D6:2 C6:2 | A5:2 C6:2 F5:2 -:2',
    'D6:3 C6 A5:2 F5:2 | D5:2 F5:2 A5:2 -:2',
    'G5:2 Bb5:2 D6:2 Bb5:2 | C6:2 E6:2 G6:2 E6:2',
    'F6:2 -:2 C6:2 -:2 | F5:2 - F5 F5:2 -:2'
  ],
  chords: ['F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'Gm C', 'F']
};

/** 경주: 말발굽 리듬으로 달리는 사장조 */
const RACE: Score = {
  bpm: 176,
  style: 'gallop',
  lead: [
    'D5:2 B4 D5 G5:2 D5:2 | B4:2 D5:2 G4:2 B4:2',
    'D5:2 B4 D5 G5:2 D5:2 | A5:2 G5:2 E5:2 D5:2',
    'E5:2 C5 E5 G5:2 E5:2 | C5:2 E5:2 G4:2 C5:2',
    'F#5:2 D5 F#5 A5:2 F#5:2 | D5 E5 F#5 G5 A5:2 -:2',
    'B5:3 A5 G5:2 D5:2 | B4:2 D5:2 G5:2 -:2',
    'G5:3 F#5 E5:2 B4:2 | G4:2 B4:2 E5:2 -:2',
    'E5 E5 E5:2 G5:2 E5:2 | F#5 F#5 F#5:2 A5:2 F#5:2',
    'G5:2 -:2 D5:2 -:2 | G5 G5 G5:2 -:4',
    'E5:2 G5:2 B5:2 G5:2 | E5 G5 B5:2 E6:2 B5:2',
    'C5:2 E5:2 G5:2 E5:2 | C5 E5 G5:2 C6:2 G5:2',
    'D5:2 G5:2 B5:2 G5:2 | D6:2 B5:2 G5:2 B5:2',
    'A5:2 F#5:2 D5:2 F#5:2 | A5 B5 C6 B5 A5:2 F#5:2',
    'E5:2 G5:2 B5:2 G5:2 | E6:3 D6 B5:2 G5:2',
    'C5:2 E5:2 G5:2 E5:2 | C6:3 B5 G5:2 E5:2',
    'A5:2 C6:2 E6:2 C6:2 | A5:2 C6:2 E6:2 C6:2',
    'D6:2 -:2 A5:2 -:2 | D5 E5 F#5 G5 A5 B5 C6 D6'
  ],
  chords: ['G', 'G', 'C', 'D', 'G', 'Em', 'C D', 'G', 'Em', 'C', 'G', 'D', 'Em', 'C', 'Am', 'D']
};

export const TRACKS: Record<TrackName, CompiledTrack> = {
  menu: compile('menu', MENU),
  paddock: compile('paddock', PADDOCK),
  race: compile('race', RACE)
};

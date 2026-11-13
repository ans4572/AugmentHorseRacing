// ============================================================
// 소리 — 배경음악과 효과음을 브라우저에서 바로 합성한다. 음원 파일은 없다.
// 옛 게임기처럼 사각파 가락 + 사각파 화음 + 삼각파 베이스 + 잡음 북으로만 연주한다.
//
// 브라우저는 사용자가 한 번 누르기 전에는 소리를 내지 못하게 막는다.
// 그래서 첫 클릭/키 입력 때 켜지고, 그 전에 요청된 음악은 기억해 두었다가 그때 시작한다.
// ============================================================

import { TRACKS, hz, midiToHz, stepTime, type CompiledTrack, type TrackEvent, type TrackName } from './music';
import { CARD_SFX, playCardSfx } from './cardSfx';
import { CARD_SAMPLE_IDS } from './cardSamples';

export type { TrackName };

export type SfxName =
  | 'click'
  | 'equip'
  | 'coin'
  | 'cancel'
  | 'error'
  | 'ready'
  | 'bell'
  | 'reveal'
  | 'tick'
  | 'warn'
  | 'go'
  | 'augment'
  | 'buff'
  | 'hex'
  | 'shield'
  | 'pop'
  | 'carrot'
  | 'buy'
  | 'finish'
  | 'win'
  | 'lose'
  | 'champion'
  | 'gameEnd';

interface Prefs {
  music: boolean;
  sfx: boolean;
}

const PREFS_KEY = 'augment-derby-sound-v1';
const MUSIC_VOL = 0.4;
const SFX_VOL = 1;
/** 이만큼 앞의 음까지 미리 예약한다. 탭이 뒤로 가 타이머가 느려져도 끊기지 않을 만큼 길게. */
const LOOKAHEAD = 1.2;
const PUMP_MS = 200;

type Ctx = BaseAudioContext;

// ---------------- 설정 ----------------

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return { music: raw.music !== false, sfx: raw.sfx !== false };
  } catch {
    return { music: true, sfx: true };
  }
}

const prefs = loadPrefs();

function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 저장이 막힌 브라우저에서는 이번 접속 동안만 유지된다
  }
}

export function soundPrefs(): Readonly<Prefs> {
  return prefs;
}

// ---------------- 소리 재료 ----------------

interface Kit {
  noise: AudioBuffer;
  /** 폭이 좁은 사각파 — 가락이 또렷하게 들린다 */
  pulse: PeriodicWave;
}

const kits = new WeakMap<Ctx, Kit>();

function kitOf(ac: Ctx): Kit {
  let kit = kits.get(ac);
  if (kit) return kit;
  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const harmonics = 32;
  const duty = 0.25;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let k = 1; k <= harmonics; k++) {
    real[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k);
    imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k);
  }
  kit = { noise, pulse: ac.createPeriodicWave(real, imag) };
  kits.set(ac, kit);
  return kit;
}

type Wave = OscillatorType | 'pulse';

/** 음 하나. hold가 참이면 끝까지 버티다 끊고, 아니면 퉁기듯 줄어든다. */
function blip(
  ac: Ctx,
  out: AudioNode,
  wave: Wave,
  f0: number,
  t: number,
  dur: number,
  vol: number,
  f1 = f0,
  hold = false
): void {
  const osc = ac.createOscillator();
  if (wave === 'pulse') osc.setPeriodicWave(kitOf(ac).pulse);
  else osc.type = wave;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  if (hold) {
    g.gain.setValueAtTime(vol, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

/** 잡음 한 번 (북, 쉭 소리) */
function hiss(
  ac: Ctx,
  out: AudioNode,
  t: number,
  dur: number,
  vol: number,
  freq: number,
  type: BiquadFilterType = 'highpass'
): void {
  const src = ac.createBufferSource();
  src.buffer = kitOf(ac).noise;
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.03);
}

/** 음 이름으로 적은 짧은 가락. 걸린 시간을 돌려준다. */
function tune(
  ac: Ctx,
  out: AudioNode,
  t: number,
  step: number,
  notes: [name: string, len: number][],
  vol: number,
  wave: Wave = 'pulse'
): number {
  let at = 0;
  notes.forEach(([name, len], i) => {
    if (name !== '-') {
      const last = i === notes.length - 1;
      blip(ac, out, wave, hz(name), t + at * step, len * step * (last ? 1 : 0.92), vol, undefined, last && len >= 3);
    }
    at += len;
  });
  return at * step;
}

// ---------------- 배경음악 연주 ----------------

interface Bus {
  out: GainNode;
  lead: GainNode;
  harm: GainNode;
  bass: GainNode;
  drums: GainNode;
}

function makeBus(ac: Ctx, dest: AudioNode, track: CompiledTrack): Bus {
  const out = ac.createGain();
  out.connect(dest);
  const ch = (vol: number): GainNode => {
    const g = ac.createGain();
    g.gain.value = vol;
    g.connect(out);
    return g;
  };
  const bus: Bus = { out, lead: ch(0.2), harm: ch(0.075), bass: ch(0.42), drums: ch(0.5) };
  // 가락에만 메아리를 살짝 — 음이 적어도 허전하지 않게
  const delay = ac.createDelay(1);
  delay.delayTime.value = (60 / track.bpm / 4) * 3;
  const wet = ac.createGain();
  wet.gain.value = 0.22;
  bus.lead.connect(delay).connect(wet).connect(out);
  return bus;
}

function playEvent(ac: Ctx, bus: Bus, track: CompiledTrack, ev: TrackEvent, t: number): void {
  const stepDur = 60 / track.bpm / 4;
  if (ev.kind === 'note') {
    const f = midiToHz(ev.midi);
    if (ev.ch === 'lead') {
      blip(ac, bus.lead, 'pulse', f, t, Math.max(0.09, ev.len * stepDur * 0.95), 1);
    } else if (ev.ch === 'harm') {
      blip(ac, bus.harm, 'square', f, t, stepDur * 0.9, 1);
    } else {
      blip(ac, bus.bass, 'triangle', f, t, ev.len * stepDur * 0.9, 1, undefined, true);
    }
    return;
  }
  if (ev.drum === 'kick') {
    blip(ac, bus.drums, 'sine', 165, t, 0.13, ev.vol, 45);
  } else if (ev.drum === 'snare') {
    hiss(ac, bus.drums, t, 0.11, ev.vol * 0.6, 1900, 'bandpass');
    blip(ac, bus.drums, 'triangle', 220, t, 0.06, ev.vol * 0.35, 150);
  } else if (ev.drum === 'hat') {
    hiss(ac, bus.drums, t, 0.03, ev.vol * 0.3, 7500);
  } else {
    blip(ac, bus.drums, 'square', 820, t, 0.02, ev.vol * 0.22);
    hiss(ac, bus.drums, t, 0.02, ev.vol * 0.25, 3000);
  }
}

interface Session {
  name: TrackName;
  track: CompiledTrack;
  bus: Bus;
  /** 첫 칸이 울리는 시각 */
  t0: number;
  loop: number;
  idx: number;
}

// ---------------- 효과음 ----------------

/** 효과음 하나를 t 시각에 예약한다. 배경음악이 비켜 줘야 하는 길이(초)를 돌려준다. */
type SfxFn = (ac: Ctx, out: AudioNode, t: number, arg: number) => number;

const SFX: Record<SfxName, SfxFn> = {
  click: (ac, out, t) => {
    blip(ac, out, 'square', 740, t, 0.035, 0.14);
    return 0;
  },
  equip: (ac, out, t) => {
    blip(ac, out, 'triangle', 520, t, 0.08, 0.3, 800);
    return 0;
  },
  coin: (ac, out, t) => {
    blip(ac, out, 'square', hz('B5'), t, 0.07, 0.22);
    blip(ac, out, 'square', hz('E6'), t + 0.07, 0.3, 0.22);
    return 0;
  },
  cancel: (ac, out, t) => {
    blip(ac, out, 'square', hz('E5'), t, 0.06, 0.2);
    blip(ac, out, 'square', hz('B4'), t + 0.07, 0.13, 0.2);
    return 0;
  },
  error: (ac, out, t) => {
    blip(ac, out, 'sawtooth', 155, t, 0.09, 0.24, 120);
    blip(ac, out, 'sawtooth', 155, t + 0.1, 0.14, 0.24, 105);
    return 0;
  },
  ready: (ac, out, t) => {
    tune(ac, out, t, 0.075, [['C5', 1], ['G5', 1], ['C6', 2]], 0.2);
    return 0;
  },
  bell: (ac, out, t) => {
    blip(ac, out, 'triangle', hz('E6'), t, 0.55, 0.3);
    blip(ac, out, 'sine', hz('E7'), t, 0.3, 0.08);
    return 0;
  },
  reveal: (ac, out, t) => {
    tune(ac, out, t, 0.05, [['G5', 1], ['B5', 1], ['D6', 1], ['G6', 2]], 0.2);
    return 0;
  },
  tick: (ac, out, t) => {
    blip(ac, out, 'square', hz('C5'), t, 0.11, 0.26);
    return 0;
  },
  warn: (ac, out, t) => {
    blip(ac, out, 'triangle', hz('C6'), t, 0.05, 0.32);
    return 0;
  },
  go: (ac, out, t) => {
    // 문이 철컥 열리고 나팔 한 번
    hiss(ac, out, t, 0.22, 0.28, 1200);
    blip(ac, out, 'pulse', hz('C6'), t, 0.5, 0.16, undefined, true);
    blip(ac, out, 'square', hz('G5'), t, 0.5, 0.07, undefined, true);
    return 0;
  },
  augment: (ac, out, t, tier) => {
    // 등급이 높을수록 반짝이는 음이 더 올라간다
    const notes = ['C6', 'E6', 'G6', 'C7', 'E7'].slice(0, 3 + Math.max(0, Math.min(2, tier)));
    notes.forEach((n, i) => {
      blip(ac, out, 'triangle', hz(n), t + i * 0.055, 0.22, 0.24);
      blip(ac, out, 'square', hz(n), t + i * 0.055, 0.06, 0.05);
    });
    return 0;
  },
  buff: (ac, out, t) => {
    blip(ac, out, 'square', 440, t, 0.22, 0.18, 1320);
    blip(ac, out, 'triangle', 1760, t + 0.2, 0.18, 0.2);
    return 0;
  },
  hex: (ac, out, t) => {
    blip(ac, out, 'sawtooth', 880, t, 0.32, 0.2, 110);
    hiss(ac, out, t, 0.2, 0.2, 800, 'bandpass');
    return 0;
  },
  shield: (ac, out, t) => {
    blip(ac, out, 'triangle', hz('G6'), t + 0.12, 0.25, 0.25);
    blip(ac, out, 'triangle', hz('C7'), t + 0.18, 0.3, 0.2);
    return 0;
  },
  pop: (ac, out, t) => {
    blip(ac, out, 'sine', 600, t, 0.07, 0.3, 1200);
    return 0;
  },
  carrot: (ac, out, t) => {
    tune(ac, out, t, 0.06, [['E6', 1], ['G6', 1], ['C7', 3]], 0.17, 'square');
    return 0;
  },
  buy: (ac, out, t) => {
    tune(ac, out, t, 0.07, [['B5', 1], ['E6', 1], ['G6', 1], ['B6', 4]], 0.18, 'square');
    return 0;
  },
  finish: (ac, out, t) => {
    hiss(ac, out, t, 0.12, 0.2, 2500);
    const d = tune(ac, out, t, 0.1, [['G5', 1], ['C6', 1], ['E6', 1], ['G6', 5]], 0.15);
    blip(ac, out, 'square', hz('E5'), t + 0.3, 0.5, 0.06, undefined, true);
    blip(ac, out, 'triangle', hz('C4'), t + 0.3, 0.5, 0.3, undefined, true);
    return d + 0.3;
  },
  win: (ac, out, t) => {
    const d = tune(
      ac,
      out,
      t,
      0.08,
      [['C5', 1], ['E5', 1], ['G5', 1], ['C6', 1], ['E6', 2], ['G6', 1], ['C7', 6]],
      0.14
    );
    blip(ac, out, 'square', hz('E6'), t + 0.56, 0.48, 0.05, undefined, true);
    blip(ac, out, 'triangle', hz('C4'), t + 0.56, 0.48, 0.3, undefined, true);
    return d + 0.3;
  },
  lose: (ac, out, t) => {
    // 뿜-뿜-뿜-뿌우웅
    const slides: [from: string, to: string, len: number][] = [
      ['Bb4', 'A4', 0.28],
      ['A4', 'Ab4', 0.28],
      ['Ab4', 'G4', 0.28],
      ['G4', 'D4', 0.85]
    ];
    let at = t;
    for (const [from, to, len] of slides) {
      blip(ac, out, 'sawtooth', hz(from), at, len * 0.95, 0.09, hz(to), true);
      blip(ac, out, 'triangle', hz(from) / 2, at, len * 0.95, 0.25, hz(to) / 2, true);
      at += len;
    }
    return at - t + 0.3;
  },
  champion: (ac, out, t) => {
    const step = 0.11;
    const d = tune(
      ac,
      out,
      t,
      step,
      [
        ['G4', 1], ['C5', 1], ['E5', 1], ['G5', 1],
        ['C6', 2], ['G5', 1], ['C6', 1],
        ['E6', 3], ['D6', 1], ['E6', 1], ['G6', 7]
      ],
      0.15
    );
    for (const [name, at, len] of [['C3', 4, 4], ['C3', 8, 5], ['G3', 13, 7]] as [string, number, number][]) {
      blip(ac, out, 'triangle', hz(name), t + at * step, len * step, 0.32, undefined, true);
    }
    blip(ac, out, 'square', hz('B5'), t + 13 * step, 7 * step, 0.05, undefined, true);
    blip(ac, out, 'square', hz('D6'), t + 13 * step, 7 * step, 0.05, undefined, true);
    for (const s of [0, 4, 8, 13]) hiss(ac, out, t + s * step, 0.1, 0.16, 1900, 'bandpass');
    return d + 0.4;
  },
  gameEnd: (ac, out, t) => {
    const d = tune(ac, out, t, 0.15, [['E5', 1], ['G5', 1], ['C6', 1], ['B5', 1], ['C6', 4]], 0.14);
    blip(ac, out, 'triangle', hz('C4'), t + 0.6, 0.6, 0.3, undefined, true);
    return d + 0.3;
  }
};

// ---------------- 실시간 재생 ----------------

let ac: AudioContext | null = null;
let musicOut: GainNode | null = null;
let sfxOut: GainNode | null = null;
let unlocked = false;
let wanted: TrackName | null = null;
let session: Session | null = null;
/** 이 시각(오디오 시계)까지는 징글이 울리므로 새 음악을 시작하지 않는다 */
let holdUntil = 0;
const listeners = new Set<() => void>();

function context(): AudioContext | null {
  if (!ac) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ac = new AC();
    } catch {
      return null;
    }
    // 여러 소리가 겹쳐도 찢어지지 않게 마지막에 한 번 눌러 준다
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    limiter.connect(ac.destination);
    musicOut = ac.createGain();
    musicOut.gain.value = MUSIC_VOL;
    musicOut.connect(limiter);
    sfxOut = ac.createGain();
    sfxOut.gain.value = SFX_VOL;
    sfxOut.connect(limiter);
  }
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

function stopSession(s: Session, c: AudioContext): void {
  s.bus.out.gain.setTargetAtTime(0, c.currentTime, 0.04);
  // 미리 예약해 둔 음이 다 지나간 뒤에 떼어 낸다
  window.setTimeout(() => s.bus.out.disconnect(), (LOOKAHEAD + 1) * 1000);
}

function pump(): void {
  const s = session;
  if (!s || !ac) return;
  const horizon = ac.currentTime + LOOKAHEAD;
  for (let guard = 0; guard < 2000; guard++) {
    const ev = s.track.events[s.idx];
    const t = s.t0 + stepTime(s.track, s.loop * s.track.steps + ev.step);
    if (t > horizon) return;
    // 탭이 오래 멈춰 있었다면 지나간 음은 건너뛴다
    if (t >= ac.currentTime - 0.02) playEvent(ac, s.bus, s.track, ev, Math.max(t, ac.currentTime));
    s.idx++;
    if (s.idx >= s.track.events.length) {
      s.idx = 0;
      s.loop++;
    }
  }
}

function applyMusic(): void {
  if (!unlocked) return;
  const target = prefs.music ? wanted : null;
  if ((session?.name ?? null) === target) return;
  const c = context();
  if (!c || !musicOut) return;
  if (session) stopSession(session, c);
  session = null;
  if (!target) return;
  const track = TRACKS[target];
  session = {
    name: target,
    track,
    bus: makeBus(c, musicOut, track),
    t0: Math.max(c.currentTime + 0.08, holdUntil),
    loop: 0,
    idx: 0
  };
  pump();
}

/** 지금 상황에 맞는 배경음악을 정한다. 같은 곡이면 이어서 연주하고, null이면 멈춘다. */
export function setMusic(name: TrackName | null): void {
  wanted = name;
  applyMusic();
}

/** 효과음. arg는 소리마다 뜻이 다르고(증강 등급 등), delay는 몇 초 뒤에 낼지. */
export function sfx(name: SfxName, arg = 0, delay = 0): void {
  if (!unlocked || !prefs.sfx) return;
  const c = context();
  if (!c || !sfxOut) return;
  const t = c.currentTime + 0.01 + delay;
  const hold = SFX[name](c, sfxOut, t, arg);
  if (hold > 0) holdUntil = Math.max(holdUntil, t + hold);
}

/** 지금 울리고 있는 카드 효과음이 끝나는 시각들 — 한꺼번에 너무 많이 겹치지 않게 센다 */
let cardVoices: number[] = [];
const CARD_VOICE_LIMIT = 3;
/** 녹음 효과음: 처음 필요할 때 받아서 풀어 두고 다시 쓴다 */
const sampleIds = new Set(CARD_SAMPLE_IDS);
const samples = new Map<string, AudioBuffer>();
const sampleLoading = new Set<string>();

function loadSample(id: string, c: AudioContext): void {
  if (samples.has(id) || sampleLoading.has(id)) return;
  sampleLoading.add(id);
  fetch(`/sfx/${id}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((data) => c.decodeAudioData(data))
    .then((buf) => samples.set(id, buf))
    .catch(() => sampleIds.delete(id)) // 받지 못한 소리는 합성음으로 대신한다
    .finally(() => sampleLoading.delete(id));
}

/** 경주가 시작될 때 불러 두면 첫 카드부터 녹음 효과음이 난다 */
export function warmCardSfx(): void {
  if (!unlocked || !prefs.sfx) return;
  const c = context();
  if (!c) return;
  for (const id of sampleIds) loadSample(id, c);
}

/**
 * 증강 카드 고유의 효과음을 낸다. 녹음 파일이 있으면 그것을, 아직 못 받았거나 없으면 합성음을 쓴다.
 * 어느 쪽도 없는 카드면 false를 돌려주므로 부르는 쪽에서 공통 소리(buff / hex)를 내면 된다.
 */
export function cardSfx(id: string): boolean {
  if (!sampleIds.has(id) && !CARD_SFX[id]) return false;
  if (!unlocked || !prefs.sfx) return true;
  const c = context();
  if (!c || !sfxOut) return true;
  cardVoices = cardVoices.filter((end) => end > c.currentTime);
  if (cardVoices.length >= CARD_VOICE_LIMIT) return true; // 이미 여러 장이 울리는 중이면 건너뛴다
  const t = c.currentTime + 0.01;
  const buf = samples.get(id);
  if (buf) {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(sfxOut);
    src.start(t);
    cardVoices.push(t + buf.duration);
    return true;
  }
  if (sampleIds.has(id)) loadSample(id, c); // 다음부터는 녹음 소리가 난다
  const len = playCardSfx(id, c, sfxOut, t);
  if (len == null) return false;
  cardVoices.push(t + len);
  return true;
}

export function toggleMusic(): void {
  prefs.music = !prefs.music;
  savePrefs();
  applyMusic();
  listeners.forEach((fn) => fn());
}

export function toggleSfx(): void {
  prefs.sfx = !prefs.sfx;
  savePrefs();
  if (prefs.sfx) sfx('pop');
  listeners.forEach((fn) => fn());
}

/** 켜기/끄기 상태가 바뀔 때마다 불린다 (버튼 모양 갱신용) */
export function onSoundPrefsChange(fn: () => void): void {
  listeners.add(fn);
}

/** 한 번만 부른다. 첫 클릭이나 키 입력에서 소리를 켠다. */
export function initAudio(): void {
  const unlock = (): void => {
    if (!unlocked) {
      unlocked = true;
      window.setInterval(pump, PUMP_MS);
    }
    context();
    applyMusic();
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('touchstart', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
  // 화면이 열리자마자 한 번 시도한다. 브라우저가 자동 재생을 허용하면 바로 음악이 나오고,
  // 막으면 소리 장치가 멈춘 채로 기다리다가 위의 첫 조작에서 이어서 켜진다
  unlock();
  // 버튼처럼 누를 수 있는 것은 모두 같은 딸깍 소리
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest?.('button, .horse-card, .horse-row');
    if (el && !(el as HTMLButtonElement).disabled) sfx('click');
  });
}

// ---------------- 확인용 ----------------

/**
 * 한 곡을 소리 없이 통째로 계산해 크기를 잰다 (개발 중 확인용).
 * peak가 1을 넘으면 찢어지고, rms가 0이면 아무 소리도 안 난 것이다.
 */
export async function measureTrack(name: TrackName, seconds = 8): Promise<{ peak: number; rms: number }> {
  const rate = 22050;
  const off = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  const track = TRACKS[name];
  const out = off.createGain();
  out.gain.value = MUSIC_VOL;
  out.connect(off.destination);
  const bus = makeBus(off, out, track);
  for (let loop = 0; ; loop++) {
    let done = false;
    for (const ev of track.events) {
      const t = stepTime(track, loop * track.steps + ev.step);
      if (t >= seconds) {
        done = true;
        break;
      }
      playEvent(off, bus, track, ev, t);
    }
    if (done) break;
  }
  return levels(await off.startRendering());
}

export async function measureSfx(name: SfxName, arg = 0): Promise<{ peak: number; rms: number }> {
  const rate = 22050;
  const off = new OfflineAudioContext(1, rate * 3, rate);
  const out = off.createGain();
  out.gain.value = SFX_VOL;
  out.connect(off.destination);
  SFX[name](off, out, 0.01, arg);
  return levels(await off.startRendering());
}

function levels(buf: AudioBuffer): { peak: number; rms: number } {
  const data = buf.getChannelData(0);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
    sum += v * v;
  }
  return { peak: Number(peak.toFixed(3)), rms: Number(Math.sqrt(sum / data.length).toFixed(4)) };
}

export const SFX_NAMES = Object.keys(SFX) as SfxName[];

if (import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__sound = {
    measureTrack,
    measureSfx,
    SFX_NAMES,
    state: () => ({ unlocked, wanted, playing: session?.name ?? null, ctx: ac?.state ?? null, prefs })
  };
}

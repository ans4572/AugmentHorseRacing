// ============================================================
// 증강 카드별 효과음 — 녹음 파일 없이 Web Audio로 합성한다.
// 사실적인 소리보다 만화 효과음처럼 과장된 소리를 낸다.
// 이 파일은 다른 모듈에 기대지 않는다 (소리 시안 페이지가 그대로 가져다 쓴다).
// ============================================================

type Ctx = BaseAudioContext;
/** 소리 하나: t 시각에 시작하도록 예약하고, 길이(초)를 돌려준다 */
export type CardSound = (ac: Ctx, out: AudioNode, t: number) => number;

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
function noiseBuffer(ac: Ctx): AudioBuffer {
  let buf = noiseCache.get(ac);
  if (!buf) {
    buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ac, buf);
  }
  return buf;
}

/** 음 하나. freq는 [시작, 끝] 또는 [[시각 비율 0~1, 주파수], ...] 로 꺾을 수 있다 */
function tone(
  ac: Ctx,
  out: AudioNode,
  t: number,
  dur: number,
  type: OscillatorType,
  freq: number | [number, number] | [number, number][],
  vol: number,
  opts: { attack?: number; hold?: boolean; vibrato?: [number, number]; tremolo?: [number, number] } = {}
): void {
  const osc = ac.createOscillator();
  osc.type = type;
  const pts: [number, number][] =
    typeof freq === 'number'
      ? [[0, freq]]
      : typeof freq[0] === 'number'
        ? [[0, (freq as [number, number])[0]], [1, (freq as [number, number])[1]]]
        : (freq as [number, number][]);
  osc.frequency.setValueAtTime(Math.max(1, pts[0][1]), t);
  for (const [k, f] of pts.slice(1)) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f), t + dur * k);
  if (opts.vibrato) {
    const lfo = ac.createOscillator();
    const depth = ac.createGain();
    lfo.frequency.value = opts.vibrato[0];
    depth.gain.value = opts.vibrato[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const g = ac.createGain();
  const attack = opts.attack ?? 0.006;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  if (opts.hold) {
    g.gain.setValueAtTime(vol, t + dur * 0.82);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  let node: AudioNode = osc.connect(g);
  if (opts.tremolo) {
    // 떨림(부르르): 음량을 빠르게 흔든다
    const trem = ac.createGain();
    trem.gain.value = 1 - opts.tremolo[1] / 2;
    const lfo = ac.createOscillator();
    const depth = ac.createGain();
    lfo.type = 'square';
    lfo.frequency.value = opts.tremolo[0];
    depth.gain.value = opts.tremolo[1] / 2;
    lfo.connect(depth).connect(trem.gain);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    node = node.connect(trem);
  }
  node.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** 걸러 낸 잡음. 바람·쉬익·바스락·쿵의 재료 */
function hiss(
  ac: Ctx,
  out: AudioNode,
  t: number,
  dur: number,
  vol: number,
  filter: BiquadFilterType,
  freq: number | [number, number],
  opts: { q?: number; attack?: number; hold?: boolean } = {}
): void {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = filter;
  f.Q.value = opts.q ?? 1;
  const [f0, f1] = typeof freq === 'number' ? [freq, freq] : freq;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + (opts.attack ?? 0.008));
  if (opts.hold) {
    g.gain.setValueAtTime(vol, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

// ---- 자주 쓰는 만화 효과음 조각 ----
const thud = (ac: Ctx, out: AudioNode, t: number, vol = 0.5): void => {
  tone(ac, out, t, 0.22, 'sine', [150, 42], vol);
  hiss(ac, out, t, 0.12, vol * 0.5, 'lowpass', 500);
};
const boing = (ac: Ctx, out: AudioNode, t: number, f = 220, vol = 0.3): void =>
  tone(ac, out, t, 0.32, 'sine', [[0, f], [0.25, f * 2.4], [1, f * 1.1]], vol, { vibrato: [26, f * 0.25] });
const click = (ac: Ctx, out: AudioNode, t: number, vol = 0.3, f = 2400): void =>
  hiss(ac, out, t, 0.035, vol, 'bandpass', f, { q: 2, attack: 0.001 });
const pop = (ac: Ctx, out: AudioNode, t: number, f = 700, vol = 0.3): void =>
  tone(ac, out, t, 0.07, 'sine', [f, f * 2.2], vol, { attack: 0.002 });
const ding = (ac: Ctx, out: AudioNode, t: number, f = 1568, vol = 0.22): void => {
  tone(ac, out, t, 0.5, 'triangle', f, vol);
  tone(ac, out, t, 0.3, 'sine', f * 2, vol * 0.3);
};
/** 카메라 셔터: 찰칵 */
const shutter = (ac: Ctx, out: AudioNode, t: number, vol = 0.3): void => {
  click(ac, out, t, vol, 3200);
  click(ac, out, t + 0.07, vol * 0.8, 1800);
};
/** 꿀꺽 */
const gulp = (ac: Ctx, out: AudioNode, t: number, vol = 0.32): void =>
  tone(ac, out, t, 0.16, 'sine', [[0, 420], [0.5, 180], [1, 520]], vol);

export const CARD_SFX: Record<string, CardSound> = {
  // ---- 넘어지고 꼬이는 것들 ----
  banana_peel: (ac, out, t) => {
    // 미끄러지는 휘이익 → 쿵 → 별이 보인다
    tone(ac, out, t, 0.28, 'sine', [[0, 500], [0.7, 1900], [1, 700]], 0.26);
    thud(ac, out, t + 0.34, 0.6);
    tone(ac, out, t + 0.5, 0.35, 'triangle', [1800, 2600], 0.1, { vibrato: [18, 300] });
    return 0.9;
  },
  leg_tangle: (ac, out, t) => {
    // 우당탕: 높이가 내려가는 통통통 + 미끄덩
    [520, 400, 300, 210].forEach((f, i) => tone(ac, out, t + i * 0.085, 0.09, 'square', [f, f * 0.7], 0.2));
    tone(ac, out, t + 0.36, 0.25, 'sawtooth', [300, 90], 0.2);
    return 0.65;
  },
  dizzy_spin: (ac, out, t) => {
    // 빙글빙글: 오르내리는 소리가 점점 빨라진다
    tone(ac, out, t, 0.9, 'sine', [500, 900], 0.24, { vibrato: [7, 260], hold: true });
    tone(ac, out, t, 0.9, 'triangle', [1000, 1800], 0.08, { vibrato: [11, 400], hold: true });
    return 0.95;
  },

  // ---- 부풀고 줄어드는 것들 ----
  balloon_horse: (ac, out, t) => {
    // 바람 넣는 쉬이익 + 고무 삑삑 + 두둥실
    hiss(ac, out, t, 0.5, 0.3, 'bandpass', [600, 3200], { q: 1.5, attack: 0.05, hold: true });
    tone(ac, out, t + 0.1, 0.4, 'sine', [300, 900], 0.14, { attack: 0.05 });
    tone(ac, out, t + 0.52, 0.09, 'sine', [1300, 1700], 0.22);
    tone(ac, out, t + 0.63, 0.09, 'sine', [1500, 1900], 0.2);
    boing(ac, out, t + 0.74, 330, 0.22);
    return 1.1;
  },
  light_feather: (ac, out, t) => {
    // 헬륨 마신 목소리: 높은 삐요삐요
    [1500, 1900, 1700, 2300].forEach((f, i) =>
      tone(ac, out, t + i * 0.1, 0.09, 'square', [f, f * 1.25], 0.13, { vibrato: [30, 80] })
    );
    hiss(ac, out, t, 0.18, 0.14, 'highpass', 4000, { attack: 0.02 });
    return 0.5;
  },
  giant_horse: (ac, out, t) => {
    // 쿠구궁: 낮게 깔리는 발소리 두 번
    tone(ac, out, t, 0.5, 'sawtooth', [[0, 300], [1, 60]], 0.2, { attack: 0.03 });
    thud(ac, out, t + 0.3, 0.7);
    thud(ac, out, t + 0.62, 0.8);
    hiss(ac, out, t + 0.3, 0.6, 0.25, 'lowpass', 180);
    return 1.05;
  },
  pony_morph: (ac, out, t) => {
    // 뾰로롱: 높아지며 작아지는 소리 + 뿅
    tone(ac, out, t, 0.3, 'triangle', [400, 2400], 0.2);
    pop(ac, out, t + 0.32, 1600, 0.26);
    return 0.45;
  },
  pony_party: (ac, out, t) => {
    [0, 0.12, 0.24].forEach((d, i) => {
      tone(ac, out, t + d, 0.22, 'triangle', [400 + i * 80, 2200 + i * 200], 0.16);
      pop(ac, out, t + d + 0.23, 1500 + i * 200, 0.2);
    });
    return 0.65;
  },
  giraffe_neck: (ac, out, t) => {
    // 쭈우욱: 고무줄 늘어나는 소리 + 팅
    tone(ac, out, t, 0.6, 'sawtooth', [160, 620], 0.14, { attack: 0.04, hold: true, vibrato: [14, 20] });
    tone(ac, out, t, 0.6, 'sine', [320, 1240], 0.14, { attack: 0.04, hold: true });
    tone(ac, out, t + 0.6, 0.25, 'triangle', [1500, 1400], 0.2, { vibrato: [35, 120] });
    return 0.9;
  },
  paper_horse: (ac, out, t) => {
    // 종이 구겨지는 바스락 + 펄럭
    [0, 0.07, 0.13, 0.22].forEach((d) => hiss(ac, out, t + d, 0.06, 0.3, 'highpass', 2500 + Math.random() * 2000, { attack: 0.002 }));
    hiss(ac, out, t + 0.3, 0.2, 0.2, 'bandpass', [900, 2400], { q: 0.8, attack: 0.03 });
    return 0.55;
  },
  bulk_up: (ac, out, t) => {
    // 꿀꺽꿀꺽 + 꺼억
    gulp(ac, out, t);
    gulp(ac, out, t + 0.18);
    gulp(ac, out, t + 0.36);
    tone(ac, out, t + 0.6, 0.35, 'sawtooth', [150, 85], 0.3, { tremolo: [38, 0.7], attack: 0.02 });
    return 1.0;
  },
  odd_bulk: (ac, out, t) => {
    // 회식: 잔 부딪히는 짠 + 꺼억
    ding(ac, out, t, 2093, 0.2);
    ding(ac, out, t + 0.03, 2637, 0.16);
    tone(ac, out, t + 0.35, 0.3, 'sawtooth', [140, 80], 0.26, { tremolo: [36, 0.7] });
    return 0.7;
  },
  feather_body: (ac, out, t) => {
    // 꼬르륵 + 가벼워지는 휘릭
    tone(ac, out, t, 0.3, 'sine', [90, 140], 0.3, { vibrato: [16, 30] });
    hiss(ac, out, t + 0.3, 0.22, 0.2, 'bandpass', [800, 4000], { attack: 0.04 });
    return 0.55;
  },
  even_diet: (ac, out, t) => {
    // 단체 PT: 호루라기 삑! 삑!
    tone(ac, out, t, 0.12, 'square', 2700, 0.14, { vibrato: [45, 200], hold: true });
    tone(ac, out, t + 0.18, 0.2, 'square', 2700, 0.14, { vibrato: [45, 200], hold: true });
    return 0.42;
  },

  // ---- 빨라지는 것들 ----
  rocket_booster: (ac, out, t) => {
    // 치이익 → 펑! → 슈우웅
    hiss(ac, out, t, 0.22, 0.25, 'highpass', 3000, { attack: 0.02, hold: true });
    thud(ac, out, t + 0.22, 0.7);
    hiss(ac, out, t + 0.22, 0.75, 0.4, 'bandpass', [300, 2600], { q: 0.7 });
    tone(ac, out, t + 0.22, 0.7, 'sawtooth', [90, 520], 0.18);
    return 1.0;
  },
  fart_boost: (ac, out, t) => {
    // 뿌우욱
    tone(ac, out, t, 0.5, 'sawtooth', [[0, 120], [0.3, 82], [0.8, 96], [1, 60]], 0.36, { tremolo: [31, 0.85], attack: 0.01 });
    tone(ac, out, t + 0.5, 0.12, 'sawtooth', [70, 140], 0.22, { tremolo: [44, 0.8] });
    hiss(ac, out, t, 0.5, 0.08, 'lowpass', 400);
    return 0.7;
  },
  angel_wings: (ac, out, t) => {
    // 두두두두: 헬리콥터 날개
    for (let i = 0; i < 11; i++) {
      const d = i * (0.11 - i * 0.004);
      hiss(ac, out, t + d, 0.07, 0.34, 'lowpass', 260, { attack: 0.004 });
      tone(ac, out, t + d, 0.06, 'sine', [110, 70], 0.2);
    }
    hiss(ac, out, t, 0.95, 0.07, 'bandpass', [500, 1400], { hold: true, attack: 0.1 });
    return 1.0;
  },
  teleport: (ac, out, t) => {
    // 퇴근! 슈웅 + 문 닫히는 탁
    tone(ac, out, t, 0.22, 'sine', [240, 3400], 0.2);
    hiss(ac, out, t, 0.26, 0.26, 'bandpass', [500, 6000], { q: 1.2, attack: 0.03 });
    click(ac, out, t + 0.3, 0.4, 900);
    return 0.42;
  },
  last_spurt: (ac, out, t) => {
    // 째깍째깍이 점점 빨라지다 땡
    let d = 0;
    for (let i = 0; i < 8; i++) {
      click(ac, out, t + d, 0.26, i % 2 ? 1500 : 2100);
      d += 0.13 - i * 0.012;
    }
    ding(ac, out, t + d, 1760, 0.24);
    return d + 0.5;
  },
  energy_drink: (ac, out, t) => {
    // 캔 따는 칙! + 탄산 쏴아 + 정신 번쩍
    click(ac, out, t, 0.4, 3000);
    hiss(ac, out, t + 0.02, 0.12, 0.3, 'highpass', 5000, { attack: 0.002 });
    hiss(ac, out, t + 0.15, 0.4, 0.14, 'highpass', 6500, { attack: 0.05 });
    tone(ac, out, t + 0.3, 0.3, 'square', [600, 2400], 0.12);
    return 0.65;
  },
  infinite_stamina: (ac, out, t) => {
    // 얼음 달그락 + 빨대로 쭈우욱 + 캬
    ding(ac, out, t, 3136, 0.12);
    ding(ac, out, t + 0.06, 2637, 0.1);
    hiss(ac, out, t + 0.14, 0.45, 0.24, 'bandpass', [500, 1900], { q: 3, attack: 0.05, hold: true });
    hiss(ac, out, t + 0.62, 0.22, 0.16, 'highpass', 3500, { attack: 0.03 });
    return 0.9;
  },
  muscle_awakening: (ac, out, t) => {
    // 으라차차: 힘주는 소리 + 반짝
    tone(ac, out, t, 0.4, 'sawtooth', [90, 160], 0.26, { tremolo: [22, 0.5], attack: 0.04 });
    [523, 659, 784, 1047].forEach((f, i) => tone(ac, out, t + 0.38 + i * 0.06, 0.12, 'square', f, 0.14));
    ding(ac, out, t + 0.64, 2093, 0.16);
    return 1.1;
  },
  cool_shades: (ac, out, t) => {
    // 챙! 간지 나는 반짝 + 낮은 베이스
    ding(ac, out, t, 2637, 0.2);
    ding(ac, out, t + 0.05, 3520, 0.14);
    tone(ac, out, t + 0.1, 0.4, 'sawtooth', [98, 82], 0.22, { attack: 0.02 });
    return 0.6;
  },

  // ---- 멈추고 느려지는 것들 ----
  sudden_sleep: (ac, out, t) => {
    // 드르렁 … 퓨우
    hiss(ac, out, t, 0.5, 0.34, 'bandpass', [180, 420], { q: 4, attack: 0.12, hold: true });
    tone(ac, out, t, 0.5, 'sawtooth', [60, 75], 0.16, { tremolo: [27, 0.8], attack: 0.12, hold: true });
    tone(ac, out, t + 0.6, 0.45, 'sine', [1400, 700], 0.12, { attack: 0.08 });
    return 1.1;
  },
  mukbang: (ac, out, t) => {
    // 아삭아삭 + 꿀꺽
    [0, 0.14, 0.28, 0.42].forEach((d) => {
      hiss(ac, out, t + d, 0.06, 0.34, 'bandpass', 1800 + Math.random() * 900, { q: 1.2, attack: 0.002 });
      hiss(ac, out, t + d + 0.03, 0.04, 0.2, 'highpass', 4000, { attack: 0.002 });
    });
    gulp(ac, out, t + 0.6);
    return 0.8;
  },
  first_suffering: (ac, out, t) => {
    // 인터뷰: 플래시 찰칵찰칵 + 마이크 삐이
    [0, 0.16, 0.27, 0.45].forEach((d) => shutter(ac, out, t + d, 0.3));
    tone(ac, out, t + 0.55, 0.3, 'sine', 2900, 0.07, { attack: 0.05 });
    return 0.9;
  },
  popular_tragedy: (ac, out, t) => {
    // 연예인 병: 찰칵 + 반짝반짝
    shutter(ac, out, t, 0.3);
    shutter(ac, out, t + 0.14, 0.26);
    [2093, 2637, 3136, 4186].forEach((f, i) => ding(ac, out, t + 0.3 + i * 0.07, f, 0.11));
    return 0.95;
  },
  popularity_crash: (ac, out, t) => {
    // 악플: 키보드 다다다닥 + 뚜우웅
    for (let i = 0; i < 9; i++) click(ac, out, t + i * 0.045 + Math.random() * 0.012, 0.24, 1400 + Math.random() * 1600);
    tone(ac, out, t + 0.45, 0.4, 'sawtooth', [220, 70], 0.24);
    return 0.9;
  },
  stamina_steal: (ac, out, t) => {
    // 월요병: 슬픈 트롬본 와 와 와 와아아
    [[0, 370, 0.26], [0.28, 349, 0.26], [0.56, 330, 0.26], [0.84, 311, 0.7]].forEach(([d, f, len]) =>
      tone(ac, out, t + d, len, 'sawtooth', [f, f * (len > 0.5 ? 0.86 : 0.97)], 0.17, {
        attack: 0.03,
        hold: true,
        vibrato: len > 0.5 ? [6, 9] : undefined
      })
    );
    return 1.6;
  },
  stamina_sap: (ac, out, t) => {
    // 배터리 1%: 띠링 경고음 + 꺼지는 소리
    tone(ac, out, t, 0.09, 'square', 1760, 0.14, { hold: true });
    tone(ac, out, t + 0.14, 0.09, 'square', 1760, 0.14, { hold: true });
    tone(ac, out, t + 0.34, 0.6, 'square', [[0, 880], [1, 55]], 0.16);
    return 1.0;
  },
  front_fatigue: (ac, out, t) => {
    // 선두는 외로워: 쓸쓸한 바람 + 한숨
    hiss(ac, out, t, 0.9, 0.2, 'bandpass', [400, 900], { q: 5, attack: 0.25, hold: true });
    tone(ac, out, t + 0.2, 0.7, 'sine', [700, 420], 0.1, { attack: 0.15, vibrato: [5, 14] });
    return 1.0;
  },
  catch_fast: (ac, out, t) => {
    // 삐뽀삐뽀 + 호루라기
    for (let i = 0; i < 4; i++) tone(ac, out, t + i * 0.16, 0.16, 'square', i % 2 ? 660 : 880, 0.15, { hold: true });
    tone(ac, out, t + 0.68, 0.22, 'square', 2800, 0.12, { vibrato: [48, 220], hold: true });
    return 0.95;
  },
  front_check: (ac, out, t) => {
    // 사촌이 땅을 샀다: 배 아픈 꾸르륵
    tone(ac, out, t, 0.55, 'sine', [[0, 110], [0.4, 70], [0.7, 130], [1, 60]], 0.34, { vibrato: [19, 22] });
    tone(ac, out, t + 0.5, 0.2, 'triangle', [500, 300], 0.14);
    return 0.75;
  },
  back_swamp: (ac, out, t) => {
    // 안될안: 늪에 빠지는 꾸울럭
    tone(ac, out, t, 0.3, 'sine', [[0, 200], [0.5, 90], [1, 150]], 0.3);
    tone(ac, out, t + 0.28, 0.3, 'sine', [[0, 160], [0.5, 70], [1, 110]], 0.3);
    hiss(ac, out, t, 0.6, 0.12, 'lowpass', 300);
    return 0.65;
  },
  poop_signal: (ac, out, t) => {
    // 꾸르르륵 … 삐빅!(비상)
    tone(ac, out, t, 0.6, 'sine', [[0, 80], [0.3, 130], [0.6, 70], [1, 150]], 0.36, { vibrato: [23, 26] });
    tone(ac, out, t + 0.66, 0.07, 'square', 1900, 0.13, { hold: true });
    tone(ac, out, t + 0.76, 0.07, 'square', 1900, 0.13, { hold: true });
    return 0.9;
  },
  reverse_instinct: (ac, out, t) => {
    // 헉! + 테이프 되감기
    tone(ac, out, t, 0.14, 'triangle', [500, 1500], 0.24);
    tone(ac, out, t + 0.2, 0.5, 'sawtooth', [300, 1500], 0.12, { vibrato: [32, 160], hold: true });
    hiss(ac, out, t + 0.2, 0.5, 0.14, 'bandpass', [700, 4000], { q: 2, hold: true });
    return 0.75;
  },

  // ---- 뛰고 걷는 것들 ----
  bunny_hop: (ac, out, t) => {
    boing(ac, out, t, 300, 0.26);
    boing(ac, out, t + 0.24, 380, 0.26);
    return 0.6;
  },
  bipedal: (ac, out, t) => {
    // 저벅 저벅: 구두 소리 두 번 + 삐끗
    [0, 0.22, 0.44].forEach((d, i) => {
      click(ac, out, t + d, 0.4, 900 - i * 80);
      tone(ac, out, t + d, 0.08, 'sine', [200, 110], 0.26);
    });
    tone(ac, out, t + 0.6, 0.14, 'sine', [700, 1300], 0.14);
    return 0.8;
  },
  moonwalk: (ac, out, t) => {
    // 히힛! + 스윽 스윽 + 딱
    tone(ac, out, t, 0.14, 'triangle', [1300, 2100], 0.18, { vibrato: [24, 90] });
    hiss(ac, out, t + 0.2, 0.16, 0.2, 'bandpass', [3000, 900], { q: 1.5, attack: 0.03 });
    hiss(ac, out, t + 0.4, 0.16, 0.2, 'bandpass', [3000, 900], { q: 1.5, attack: 0.03 });
    click(ac, out, t + 0.6, 0.45, 2600);
    return 0.7;
  },
  disco_time: (ac, out, t) => {
    // 쿵 치 쿵 치 + 베이스
    for (let i = 0; i < 4; i++) {
      const d = i * 0.24;
      tone(ac, out, t + d, 0.14, 'sine', [160, 50], 0.5);
      hiss(ac, out, t + d + 0.12, 0.05, 0.16, 'highpass', 7000, { attack: 0.002 });
      tone(ac, out, t + d + 0.12, 0.1, 'sawtooth', i % 2 ? 147 : 110, 0.16, { hold: true });
    }
    [784, 988, 1175].forEach((f, i) => tone(ac, out, t + 0.72 + i * 0.05, 0.2, 'square', f, 0.08));
    return 1.15;
  },

  // ---- 판을 뒤집는 것들 ----
  extreme_swap: (ac, out, t) => {
    // 잭팟: 차르르르 + 딩딩딩
    for (let i = 0; i < 10; i++) tone(ac, out, t + i * 0.04, 0.05, 'square', 700 + i * 130, 0.1);
    [1568, 1976, 2349].forEach((f, i) => ding(ac, out, t + 0.45 + i * 0.1, f, 0.18));
    for (let i = 0; i < 6; i++) click(ac, out, t + 0.5 + i * 0.07, 0.16, 5000);
    return 1.3;
  },
  last_miracle: (ac, out, t) => {
    // 꼴찌의 분노: 으르렁 + 콧김
    tone(ac, out, t, 0.6, 'sawtooth', [70, 130], 0.3, { tremolo: [34, 0.8], attack: 0.05, hold: true });
    hiss(ac, out, t + 0.5, 0.25, 0.3, 'bandpass', [900, 2400], { q: 1, attack: 0.02 });
    return 0.8;
  },
  back_rebellion: (ac, out, t) => {
    // 반란: 북 둥둥둥 + 함성 같은 잡음
    [0, 0.14, 0.28].forEach((d) => tone(ac, out, t + d, 0.16, 'sine', [130, 60], 0.44));
    hiss(ac, out, t + 0.36, 0.5, 0.2, 'bandpass', [700, 1500], { q: 1.5, attack: 0.1 });
    return 0.9;
  },
  shield: (ac, out, t) => {
    // 뽁 뽁 뽁뽁
    [0, 0.09, 0.2, 0.26, 0.37].forEach((d, i) => pop(ac, out, t + d, 600 + ((i * 370) % 700), 0.26));
    return 0.5;
  },
  back_recover: (ac, out, t) => {
    // 삼계탕: 후루룩 + 캬아
    hiss(ac, out, t, 0.35, 0.26, 'bandpass', [700, 2600], { q: 3, attack: 0.04, hold: true });
    hiss(ac, out, t + 0.42, 0.3, 0.16, 'highpass', 3000, { attack: 0.05 });
    ding(ac, out, t + 0.5, 1319, 0.12);
    return 0.85;
  }
};

/** 카드에 고유 효과음이 있으면 예약하고 길이를 돌려준다. 없으면 null */
export function playCardSfx(id: string, ac: Ctx, out: AudioNode, t: number): number | null {
  const fn = CARD_SFX[id];
  return fn ? fn(ac, out, t) : null;
}

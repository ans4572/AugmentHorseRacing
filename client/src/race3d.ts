import * as THREE from 'three';
import type {
  AugmentVisual,
  HorseAnim,
  HorseInfo,
  HorseSnapshot,
  RankingEntry
} from '../../shared/src/types';
import { COURSE_LENGTH } from '../../shared/src/constants';
import { AUGMENT_BY_ID } from '../../shared/src/augments';
import { COSMETIC_BY_ID } from '../../shared/src/stable';
import { inkOn } from './icons';

// ============================================================
// 3D 경주 뷰 (Three.js)
// 서버 스냅샷(1차원 위치)을 3D 트랙 위에 보간해 그린다.
// 말은 외부 모델 없이 도형을 조립한 치비 스타일이다.
// ============================================================

/** 코스 거리 1단위 → 월드 길이 */
const UNIT = 0.4;
const TRACK_LEN = COURSE_LENGTH * UNIT;
const LANE_W = 2.6;
const HALF_W = (6 * LANE_W) / 2;
const laneZ = (id: number): number => (id - 3.5) * LANE_W;

/** 카메라가 따라갈 대상: 선두 또는 말 번호 */
export type CameraTarget = 'leader' | number;

export type ViewMode = 'broadcast' | 'side' | 'chase' | 'top';
const VIEW_ORDER: ViewMode[] = ['broadcast', 'side', 'chase', 'top'];
export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  broadcast: '중계',
  side: '측면',
  chase: '추격',
  top: '공중'
};

const OUTLINE_COLOR = 0x3a2a1e;

const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  cone: new THREE.ConeGeometry(1, 1, 12),
  disc: new THREE.CircleGeometry(1, 24),
  box: new THREE.BoxGeometry(1, 1, 1),
};

/** 엉덩이 관절 높이 = 다리 전체 길이 */
const HIP_Y = 1.42;

/**
 * 다리 모양 — 망아지 다리: 가늘고 곧은 정강이에 큼직한 발굽,
 * 허벅지는 몸통 쪽이 굵은 원뿔이고 윗부분이 몸통 안으로 들어가 있다.
 */
const LEG = {
  /** 허벅지 몸통 쪽 굵기 (앞다리 / 뒷다리) */
  thighF: 0.27,
  thighH: 0.31,
  /** 허벅지 길이. 아래 끝은 무릎에 고정되고 남는 길이는 몸통 안으로 들어간다 */
  thighLen: 0.98,
  shin: 0.09,
  knee: 0.105,
  hoof: 0.17,
  hoofH: 0.24
};
/** 무릎 쪽이 몸통 쪽의 1/3 굵기인 원뿔 허벅지 */
const THIGH_GEO = new THREE.CylinderGeometry(1, 0.33, 1, 14);
/** 다리 관절이 예전 엉덩이 높이(HIP_Y)보다 몸통 안쪽으로 올라간 높이 */
const HIP_UP = LEG.thighLen - 0.7;
/** 목: 어깨에서 앞으로 기울어 뻗는다. NECK_HALF는 목 길이의 절반 */
const NECK_BASE_X = 0.55;
const NECK_BASE_Y = 1.02;
const NECK_TILT = 0.32;
const NECK_HALF = 0.85;
/** 긴 다리만큼 상체를 올리는 높이 */
const TORSO_RAISE = 0.64;

interface Rig {
  info: HorseInfo;
  root: THREE.Group;
  inner: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  legs: THREE.Group[];
  knees: THREE.Group[];
  neck: THREE.Mesh;
  /** 목 전체(목·갈기·목 장식)를 묶은 그룹 — 프로펠러 비행 때 통째로 돌린다 */
  neckGroup: THREE.Group;
  /** 목 뒤 갈기 — 목 길이에 맞춰 위치를 옮긴다 */
  mane: { mesh: THREE.Mesh; frac: number }[];
  body: THREE.Mesh;
  shades: THREE.Group;
  /** 꾸미기: 안경을 항상 쓰고 있는지 */
  alwaysShades: boolean;
  /** 꾸미기: 프로펠러 모자의 날개 (없으면 null) */
  propeller: THREE.Object3D | null;
  /** 꾸미기: 발자국(먼지) 종류 */
  trail: string;
  coat: THREE.MeshToonMaterial;
  coatBase: THREE.Color;
  discoOn: boolean;
  /** 변신 연출 수치 (0~1 또는 배율) */
  rear: number;
  legScale: number;
  neckStretch: number;
  inflate: number;
  flat: number;
  spin: number;
  bobY: number;
  headScale: number;
  /** 목 프로펠러 비행: 진행도(0~1)와 회전각 */
  heli: number;
  heliAng: number;
  /** 코믹 연출 진행도 (0~1): 엉덩이 로켓 / 뒤돌아보기 / 목 늘어짐 */
  dive: number;
  lookBack: number;
  droop: number;
  /** 다리 꼬기(급똥) / 앞다리 알통(득근) 진행도 */
  cross: number;
  buff: number;
  /** 한 번 재생하는 연출(공중제비·워프·자리 바꾸기)의 시작 시각 */
  fxStart: Record<string, number>;
  bubbles: THREE.Group;
  siren: THREE.Mesh;
  eyes: THREE.Object3D[];
  wings: THREE.Mesh[];
  flame: THREE.Mesh;
  shield: THREE.Mesh;
  shadow: THREE.Mesh;
  label: HTMLDivElement;
  /** 머리 위에 잠깐 붙는 증강 안내 (무엇을 / 누가) */
  note: { text: string; by: string; hostile: boolean; until: number } | null;
  labelText: string;
  labelW: number;
  labelH: number;
  dot: HTMLDivElement;
  displayPos: number;
  targetPos: number;
  speed: number;
  phase: number;
  bodyScale: number;
  facing: number;
  snap: HorseSnapshot | null;
}

interface Particle {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  rig: Rig;
}

/** 결정적 난수 (장식 배치용) */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  return canvasTexture(256, 128, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 128);
    g.lineWidth = 10;
    g.strokeStyle = '#3a2a1e';
    g.strokeRect(5, 5, 246, 118);
    g.fillStyle = fg;
    g.font = 'bold 72px Jua, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 68);
  });
}

// ---------------- 말 종류별 무늬 ----------------

let zebraTexU: THREE.CanvasTexture | null = null;
let zebraTexV: THREE.CanvasTexture | null = null;
let cowTex: THREE.CanvasTexture | null = null;

/** 얼룩말 줄무늬. 몸통·머리는 세로 줄(u 방향), 다리는 가로 고리(v 방향) */
function zebraTexture(rings: boolean): THREE.CanvasTexture {
  const cached = rings ? zebraTexV : zebraTexU;
  if (cached) return cached;
  const tex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#26262b';
    for (let i = 0; i < 10; i++) {
      const at = i * 25.6 + 6;
      if (rings) g.fillRect(0, at, 256, 12);
      else g.fillRect(at, 0, 12, 256);
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (rings) zebraTexV = tex;
  else zebraTexU = tex;
  return tex;
}

/** 젖소 얼룩 */
function cowTexture(): THREE.CanvasTexture {
  if (cowTex) return cowTex;
  cowTex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#fffaf2';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#26262b';
    const blobs: [number, number, number, number][] = [
      [40, 70, 34, 26], [120, 110, 30, 38], [200, 60, 28, 22], [230, 150, 26, 30],
      [70, 170, 36, 24], [150, 200, 24, 20], [10, 140, 18, 26], [180, 120, 16, 14]
    ];
    for (const [x, y, rx, ry] of blobs) {
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0.4, 0, Math.PI * 2);
      g.fill();
    }
  });
  cowTex.wrapS = THREE.RepeatWrapping;
  cowTex.wrapT = THREE.RepeatWrapping;
  return cowTex;
}

export class Race3DView {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 600);
  private overlay: HTMLDivElement;
  private minimap: HTMLDivElement;
  private banner: HTMLDivElement | null = null;

  private rigs: Rig[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  /** 마구간 미리보기: 말 한 마리를 가까이서 비추고 이름표·미니맵을 숨긴다 */
  private preview: boolean;
  /** 타이틀 배경: 컨테이너를 가득 채우고 이름표·미니맵을 숨긴다 */
  private backdrop: boolean;
  private trailMats = new Map<string, THREE.MeshBasicMaterial[]>();
  private dustMat = new THREE.MeshBasicMaterial({ color: 0xe8c9a0, transparent: true, opacity: 0.6 });
  private fartMat = new THREE.MeshBasicMaterial({ color: 0x94d82d, transparent: true, opacity: 0.65 });

  private cameraTarget: CameraTarget = 'leader';
  private viewMode: ViewMode = 'broadcast';
  private camPos = new THREE.Vector3(15, 6.5, 17);
  private camLook = new THREE.Vector3(-5, 1.2, 0);
  private shake = 0;
  private winnerId: number | null = null;
  private orbit = 0;
  /** 하단 UI(증강 카드)에 가려지는 동안 1, 아니면 0 — 부드럽게 보간 */
  private insetTarget = 0;
  private inset = 0;

  private raf = 0;
  private lastTime = performance.now();
  private elapsed = 0;
  private resizeObs: ResizeObserver;
  private disposed = false;

  constructor(container: HTMLElement, opts: { preview?: boolean; backdrop?: boolean } = {}) {
    this.container = container;
    this.preview = !!opts.preview;
    this.backdrop = !!opts.backdrop;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.backdrop ? 1.5 : 2));
    if (!this.backdrop) container.style.position = 'relative';
    container.appendChild(this.renderer.domElement);

    this.overlay = document.createElement('div');
    this.overlay.className = 'r3d-overlay';
    container.appendChild(this.overlay);

    this.minimap = document.createElement('div');
    this.minimap.className = 'r3d-minimap';
    this.minimap.innerHTML = '<span class="r3d-minimap-flag"></span>';
    this.overlay.appendChild(this.minimap);
    if (this.preview || this.backdrop) this.overlay.style.display = 'none';

    this.scene.background = new THREE.Color(0x8fd3ff);
    this.scene.fog = new THREE.Fog(0xc4e9ff, 70, 260);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8fbf7a, 1.25));
    const sun = new THREE.DirectionalLight(0xfff4d6, 1.5);
    sun.position.set(30, 60, 40);
    this.scene.add(sun);

    this.buildWorld();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    window.addEventListener('resize', this.onWindowResize);
    this.resize();

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------- 월드 구성 ----------------

  private buildWorld(): void {
    const totalLen = TRACK_LEN + 120;
    const midX = TRACK_LEN / 2;

    // 잔디
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(totalLen + 400, 500),
      new THREE.MeshToonMaterial({ color: 0x6fca7a })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(midX, -0.02, 0);
    this.scene.add(grass);

    // 트랙 (모래 + 가로 줄무늬 + 레인 구분선) — 줄무늬가 속도감을 만든다
    const trackTex = canvasTexture(128, 128, (g) => {
      g.fillStyle = '#dcaa66';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#d19a55';
      g.fillRect(0, 0, 64, 128);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(0, 0, 128, 5);
    });
    trackTex.wrapS = THREE.RepeatWrapping;
    trackTex.wrapT = THREE.RepeatWrapping;
    trackTex.repeat.set(totalLen / 8, 6);
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(totalLen, 6 * LANE_W),
      new THREE.MeshToonMaterial({ map: trackTex })
    );
    track.rotation.x = -Math.PI / 2;
    track.position.set(midX, 0, 0);
    this.scene.add(track);

    // 출발선
    this.addStripe(0, 0xffffff, 0.5, 1);

    // 결승선 (체크무늬) + 게이트
    const checker = canvasTexture(64, 64, (g) => {
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) {
          g.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#2b2c34';
          g.fillRect(x * 32, y * 32, 32, 32);
        }
      }
    });
    checker.wrapS = THREE.RepeatWrapping;
    checker.wrapT = THREE.RepeatWrapping;
    checker.repeat.set(2, 12);
    const finish = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 6 * LANE_W),
      new THREE.MeshBasicMaterial({ map: checker })
    );
    finish.rotation.x = -Math.PI / 2;
    finish.position.set(TRACK_LEN + 0.8, 0.02, 0);
    this.scene.add(finish);
    this.buildGate(TRACK_LEN + 0.8);

    // 증강이 열리는 10/30/50/70/90% 표지판과 바닥선, 그 사이 10% 단위 작은 표지
    for (let pct = 10; pct < 100; pct += 10) {
      const major = pct % 20 === 10;
      const x = (pct / 100) * TRACK_LEN;
      if (major) this.addStripe(x, 0xffffff, 0.35, 0.75);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(major ? 4.4 : 2.4, major ? 2.2 : 1.2),
        new THREE.MeshBasicMaterial({
          map: signTexture(`${pct}%`, major ? '#ffd803' : '#ffffff', '#2b2c34')
        })
      );
      board.position.set(x, major ? 4.2 : 2.6, -(HALF_W + 2.4));
      this.scene.add(board);
      const post = new THREE.Mesh(GEO.cyl, new THREE.MeshToonMaterial({ color: 0x8d6e4a }));
      post.scale.set(0.14, major ? 3.2 : 2.0, 0.14);
      post.position.set(x, major ? 1.6 : 1.0, -(HALF_W + 2.45));
      this.scene.add(post);
    }

    this.buildFences(totalLen, midX);
    this.buildScenery(totalLen);
  }

  private addStripe(x: number, color: number, width: number, opacity: number): void {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 6 * LANE_W),
      new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, 0);
    this.scene.add(m);
  }

  private buildGate(x: number): void {
    const postMat = new THREE.MeshToonMaterial({ color: 0xe8453c });
    for (const z of [-(HALF_W + 1), HALF_W + 1]) {
      const post = new THREE.Mesh(GEO.cyl, postMat);
      post.scale.set(0.3, 7, 0.3);
      post.position.set(x, 3.5, z);
      this.scene.add(post);
    }
    const tex = canvasTexture(1024, 128, (g) => {
      g.fillStyle = '#2b2c34';
      g.fillRect(0, 0, 1024, 128);
      g.fillStyle = '#ffd803';
      g.font = 'bold 92px Jua, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('🏁 FINISH 🏁', 512, 70);
    });
    const width = 2 * (HALF_W + 1);
    for (const dir of [1, -1]) {
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(width, 1.9),
        new THREE.MeshBasicMaterial({ map: tex })
      );
      banner.position.set(x + dir * 0.05, 6.4, 0);
      banner.rotation.y = (dir * Math.PI) / 2;
      this.scene.add(banner);
    }
  }

  private buildFences(totalLen: number, midX: number): void {
    const white = new THREE.MeshToonMaterial({ color: 0xffffff });
    const spacing = 4;
    const count = Math.floor(totalLen / spacing);
    const posts = new THREE.InstancedMesh(GEO.cyl, white, count * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let i = 0;
    for (const z of [-(HALF_W + 0.7), HALF_W + 0.7]) {
      const rail = new THREE.Mesh(GEO.box, white);
      rail.scale.set(totalLen, 0.16, 0.16);
      rail.position.set(midX, 1.15, z);
      this.scene.add(rail);
      for (let k = 0; k < count; k++) {
        m.compose(
          new THREE.Vector3(midX - totalLen / 2 + k * spacing, 0.6, z),
          q,
          new THREE.Vector3(0.09, 1.2, 0.09)
        );
        posts.setMatrixAt(i++, m);
      }
    }
    this.scene.add(posts);
  }

  private buildScenery(totalLen: number): void {
    const rnd = seeded(7);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();

    // 나무 (먼 쪽) — 지나가는 나무들이 속도감을 더한다
    const treeCount = 90;
    const trunks = new THREE.InstancedMesh(GEO.cyl, new THREE.MeshToonMaterial({ color: 0x8d6e4a }), treeCount);
    const leavesA = new THREE.InstancedMesh(GEO.cone, new THREE.MeshToonMaterial({ color: 0x2f9e44 }), treeCount);
    const leavesB = new THREE.InstancedMesh(GEO.cone, new THREE.MeshToonMaterial({ color: 0x40c057 }), treeCount);
    for (let i = 0; i < treeCount; i++) {
      const x = -50 + rnd() * (totalLen + 40);
      const z = -(HALF_W + 6) - rnd() * 34;
      const s = 0.8 + rnd() * 0.9;
      m.compose(new THREE.Vector3(x, 1.1 * s, z), q, new THREE.Vector3(0.28 * s, 2.2 * s, 0.28 * s));
      trunks.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 3.4 * s, z), q, new THREE.Vector3(1.7 * s, 3.2 * s, 1.7 * s));
      leavesA.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 5.0 * s, z), q, new THREE.Vector3(1.2 * s, 2.4 * s, 1.2 * s));
      leavesB.setMatrixAt(i, m);
    }
    this.scene.add(trunks, leavesA, leavesB);

    // 덤불 (양쪽, 낮게)
    const bushCount = 140;
    const bushes = new THREE.InstancedMesh(GEO.sphere, new THREE.MeshToonMaterial({ color: 0x37b24d }), bushCount);
    for (let i = 0; i < bushCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = -50 + rnd() * (totalLen + 40);
      const z = side * (HALF_W + 2.2 + rnd() * 2.2);
      const s = 0.45 + rnd() * 0.5;
      m.compose(new THREE.Vector3(x, s * 0.5, z), q, new THREE.Vector3(s * 1.3, s * 0.8, s));
      bushes.setMatrixAt(i, m);
    }
    this.scene.add(bushes);

    // 결승선 근처 관중석 + 관중
    const standX = TRACK_LEN - 14;
    const standZ = -(HALF_W + 9);
    const standMat = new THREE.MeshToonMaterial({ color: 0xf1f3f5 });
    for (let step = 0; step < 4; step++) {
      const s = new THREE.Mesh(GEO.box, standMat);
      s.scale.set(46, 1.2, 2.4);
      s.position.set(standX, 0.6 + step * 1.2, standZ - step * 2.4);
      this.scene.add(s);
    }
    const roof = new THREE.Mesh(GEO.box, new THREE.MeshToonMaterial({ color: 0xe8453c }));
    roof.scale.set(48, 0.4, 11);
    roof.position.set(standX, 8.6, standZ - 3.6);
    this.scene.add(roof);

    const crowdCount = 180;
    const crowd = new THREE.InstancedMesh(GEO.sphere, new THREE.MeshToonMaterial({ color: 0xffffff }), crowdCount);
    const palette = [0xff6b6b, 0xffd43b, 0x4dabf7, 0x69db7c, 0xda77f2, 0xffa94d, 0xffffff];
    const col = new THREE.Color();
    for (let i = 0; i < crowdCount; i++) {
      const step = i % 4;
      const x = standX - 22 + rnd() * 44;
      m.compose(
        new THREE.Vector3(x, 1.75 + step * 1.2, standZ - step * 2.4 + 0.3),
        q,
        new THREE.Vector3(0.42, 0.55, 0.42)
      );
      crowd.setMatrixAt(i, m);
      crowd.setColorAt(i, col.setHex(palette[Math.floor(rnd() * palette.length)]));
    }
    this.scene.add(crowd);

    // 먼 언덕
    const hillMat = new THREE.MeshToonMaterial({ color: 0x5fb86a });
    for (let i = 0; i < 9; i++) {
      const hill = new THREE.Mesh(GEO.sphere, hillMat);
      const r = 28 + rnd() * 22;
      hill.scale.set(r * 1.6, r * 0.55, r);
      hill.position.set(-40 + i * (totalLen / 8), -4, -95 - rnd() * 25);
      this.scene.add(hill);
    }

    // 구름
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 16; i++) {
      const cx = -60 + rnd() * (totalLen + 120);
      const cy = 34 + rnd() * 16;
      const cz = -70 - rnd() * 70;
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(GEO.sphere, cloudMat);
        const s = 4 + rnd() * 3;
        c.scale.set(s * 1.5, s * 0.7, s);
        c.position.set(cx + (k - 1) * 6, cy + (k === 1 ? 1.5 : 0), cz);
        this.scene.add(c);
      }
    }
  }

  // ---------------- 치비 말 조립 ----------------

  private buildRig(info: HorseInfo): Rig {
    // 레인 색은 구분용, 털 색은 꾸미기에서 따로 고를 수 있다
    const lane = new THREE.Color(info.color);
    const look = info.look;
    const coatHex = look ? COSMETIC_BY_ID[look.coat]?.color : undefined;
    const customCoat = coatHex ? new THREE.Color(coatHex) : null;
    const base = customCoat ?? lane;
    const neckItem = look && look.neck !== 'neck_none' ? COSMETIC_BY_ID[look.neck] : undefined;
    const faceItem = look && look.face !== 'face_none' ? COSMETIC_BY_ID[look.face] : undefined;
    const hatId = look?.hat ?? 'hat_none';
    const tint = (c: number): THREE.Color =>
      customCoat ? customCoat.clone().lerp(new THREE.Color(0xffffff), 0.25) : new THREE.Color(c);
    const breed = info.breed ?? 'horse';
    const white = new THREE.MeshToonMaterial({ color: 0xfff8ee });

    // 종류별 털·다리·갈기 재질. 흰 털 종류는 레인 색을 안장과 목도리로 보여 준다
    let coat = new THREE.MeshToonMaterial({ color: base });
    let legMat = coat;
    let dark = new THREE.MeshToonMaterial({ color: base.clone().multiplyScalar(0.62) });
    let muzzleMat = white;
    let saddleColor = new THREE.Color(0xe8453c);
    if (breed === 'zebra') {
      coat = new THREE.MeshToonMaterial({ color: tint(0xffffff), map: zebraTexture(false) });
      legMat = new THREE.MeshToonMaterial({ color: tint(0xffffff), map: zebraTexture(true) });
      dark = new THREE.MeshToonMaterial({ color: 0x26262b });
      saddleColor = lane.clone();
    } else if (breed === 'cow') {
      coat = new THREE.MeshToonMaterial({ color: tint(0xffffff), map: cowTexture() });
      legMat = customCoat ? new THREE.MeshToonMaterial({ color: tint(0xffffff) }) : white;
      dark = new THREE.MeshToonMaterial({ color: 0x26262b });
      muzzleMat = new THREE.MeshToonMaterial({ color: 0xffc9d6 });
      saddleColor = lane.clone();
    } else if (breed === 'unicorn') {
      coat = new THREE.MeshToonMaterial({ color: base.clone().lerp(new THREE.Color(0xffffff), customCoat ? 0.2 : 0.5) });
      legMat = coat;
      dark = new THREE.MeshToonMaterial({ color: 0xffc9de });
      saddleColor = new THREE.Color(0xffd43b);
    } else if (breed === 'donkey') {
      coat = new THREE.MeshToonMaterial({ color: base.clone().lerp(new THREE.Color(0x8a8a8a), customCoat ? 0.2 : 0.5) });
      legMat = coat;
      dark = new THREE.MeshToonMaterial({ color: 0x4a4a4f });
      muzzleMat = new THREE.MeshToonMaterial({ color: 0xdcdcdc });
    }
    // 털 색이나 목 장식을 바꾼 말은 안장으로 레인 색을 보여 준다
    if (customCoat || neckItem) saddleColor = lane.clone();
    const earH = breed === 'donkey' ? 0.74 : 0.34;
    const hoofMat = new THREE.MeshToonMaterial({ color: 0x3a2a1e });
    const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });

    const part = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      parent: THREE.Object3D,
      pos: [number, number, number],
      scale: [number, number, number],
      outline = 0.07
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      parent.add(mesh);
      if (outline > 0) {
        const o = new THREE.Mesh(geo, outlineMat);
        o.scale.setScalar(1 + outline);
        mesh.add(o);
      }
      return mesh;
    };

    const root = new THREE.Group();
    const inner = new THREE.Group();
    root.add(inner);

    // 상체는 긴 다리 위에 올린다
    const torso = new THREE.Group();
    torso.position.y = TORSO_RAISE;
    inner.add(torso);

    // 몸통 + 배 (날씬하게)
    const body = part(GEO.sphere, coat, torso, [0, 1.15, 0], [1.0, 0.56, 0.5]);
    part(GEO.sphere, white, torso, [0.02, 0.98, 0], [0.74, 0.32, 0.38], 0);
    // 목 (가늘고 길게)
    const neckGroup = new THREE.Group();
    neckGroup.position.set(NECK_BASE_X, NECK_BASE_Y, 0);
    // 기울인 뒤 세로축으로 돌릴 수 있게 회전 순서를 바꿔 둔다 (프로펠러 비행용)
    neckGroup.rotation.order = 'YZX';
    neckGroup.rotation.z = -NECK_TILT;
    torso.add(neckGroup);
    const neck = part(GEO.sphere, coat, neckGroup, [0, NECK_HALF, 0], [0.3, NECK_HALF, 0.28]);

    // 안장 + 번호판
    part(GEO.sphere, new THREE.MeshToonMaterial({ color: saddleColor }), torso, [-0.08, 1.7, 0], [0.42, 0.12, 0.44]);
    const neckBand = (color: THREE.ColorRepresentation, tube: number): void => {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.33, tube, 8, 18),
        new THREE.MeshToonMaterial({ color })
      );
      band.rotation.x = Math.PI / 2;
      band.position.set(0, 0.5, 0);
      neckGroup.add(band);
    };
    if (neckItem?.id === 'neck_scarf') {
      // 목도리: 띠 + 앞으로 늘어진 자락
      const scarfMat = new THREE.MeshToonMaterial({ color: neckItem.color });
      neckBand(neckItem.color!, 0.11);
      part(GEO.box, scarfMat, neckGroup, [0.34, 0.26, 0.14], [0.1, 0.46, 0.18], 0.1);
    } else if (neckItem?.id === 'neck_bowtie') {
      const bowMat = new THREE.MeshToonMaterial({ color: neckItem.color });
      neckBand(0xffffff, 0.05);
      for (const side of [1, -1]) {
        const wing = part(GEO.cone, bowMat, neckGroup, [0.4, 0.5, side * 0.19], [0.14, 0.3, 0.1], 0.1);
        wing.rotation.x = -side * (Math.PI / 2);
      }
      part(GEO.sphere, bowMat, neckGroup, [0.4, 0.5, 0], [0.08, 0.08, 0.08], 0.14);
    } else if (neckItem?.id === 'neck_medal') {
      neckBand(0x1c7ed6, 0.06);
      const medal = part(GEO.cyl, new THREE.MeshToonMaterial({ color: 0xffd43b }), neckGroup, [0.42, 0.3, 0], [0.18, 0.05, 0.18], 0.1);
      medal.rotation.z = Math.PI / 2;
    } else if (breed !== 'horse' || customCoat) {
      // 레인 색 목도리 — 털 색이 레인 색과 다른 말도 한눈에 구분된다
      neckBand(lane, 0.1);
    }
    const numTex = canvasTexture(128, 128, (g) => {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(64, 64, 58, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 9;
      g.strokeStyle = '#3a2a1e';
      g.stroke();
      g.fillStyle = '#2b2c34';
      g.font = 'bold 84px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(info.id), 64, 70);
    });
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true });
    for (const side of [1, -1]) {
      const plate = new THREE.Mesh(GEO.disc, numMat);
      plate.scale.setScalar(0.26);
      plate.position.set(-0.08, 1.2, side * 0.53);
      if (side < 0) plate.rotation.y = Math.PI;
      torso.add(plate);
    }

    // 머리 (몸통만큼 큰 치비 머리)
    const head = new THREE.Group();
    head.position.set(
      NECK_BASE_X + Math.sin(NECK_TILT) * 2 * NECK_HALF + 0.12,
      NECK_BASE_Y + Math.cos(NECK_TILT) * 2 * NECK_HALF - 0.18,
      0
    );
    head.scale.setScalar(0.9);
    torso.add(head);
    part(GEO.sphere, coat, head, [0, 0, 0], [0.64, 0.6, 0.58]);
    part(GEO.sphere, muzzleMat, head, [0.5, -0.17, 0], [0.38, 0.3, 0.36]);
    const eyes: THREE.Object3D[] = [];
    const cheekMat = new THREE.MeshToonMaterial({ color: 0xff8fa3 });
    for (const side of [1, -1]) {
      const eye = new THREE.Group();
      eye.position.set(0.26, 0.1, side * 0.46);
      head.add(eye);
      part(GEO.sphere, white, eye, [0, 0, 0], [0.17, 0.19, 0.12], 0.12);
      part(GEO.sphere, hoofMat, eye, [0.05, 0, side * 0.07], [0.09, 0.1, 0.07], 0);
      part(GEO.sphere, white, eye, [0.09, 0.05, side * 0.12], [0.035, 0.035, 0.03], 0);
      eyes.push(eye);
      // 콧구멍, 볼터치, 귀
      part(GEO.sphere, hoofMat, head, [0.83, -0.12, side * 0.13], [0.04, 0.05, 0.04], 0);
      part(GEO.sphere, cheekMat, head, [0.3, -0.16, side * 0.5], [0.1, 0.07, 0.05], 0);
      const ear = part(GEO.cone, coat, head, [-0.14, 0.45 + earH / 2, side * 0.27], [0.13, earH, 0.13], 0.12);
      ear.rotation.x = side * 0.25;
    }
    // 앞머리 + 갈기
    part(GEO.sphere, dark, head, [0.14, 0.56, 0], [0.26, 0.2, 0.24], 0.1);
    part(GEO.sphere, dark, head, [0.34, 0.48, 0], [0.18, 0.14, 0.18], 0.1);
    if (breed === 'unicorn') {
      const horn = part(GEO.cone, new THREE.MeshToonMaterial({ color: 0xffd43b }), head, [0.42, 0.78, 0], [0.09, 0.62, 0.09], 0.14);
      horn.rotation.z = -0.45;
    }
    // 꾸미기: 모자
    let propeller: THREE.Object3D | null = null;
    if (hatId !== 'hat_none') {
      const hat = new THREE.Group();
      hat.position.set(-0.04, 0.56, 0);
      hat.rotation.z = 0.14;
      head.add(hat);
      const m = (c: number): THREE.MeshToonMaterial => new THREE.MeshToonMaterial({ color: c });
      if (hatId === 'hat_party') {
        part(GEO.cyl, m(0xffd43b), hat, [0, 0.03, 0], [0.29, 0.06, 0.29], 0);
        part(GEO.cone, m(0xff6b9d), hat, [0, 0.4, 0], [0.26, 0.72, 0.26], 0.1);
        part(GEO.sphere, m(0xffd43b), hat, [0, 0.78, 0], [0.1, 0.1, 0.1], 0.14);
      } else if (hatId === 'hat_straw') {
        part(GEO.cyl, m(0xe9c46a), hat, [0, 0.03, 0], [0.64, 0.05, 0.64], 0.06);
        part(GEO.cyl, m(0xe9c46a), hat, [0, 0.17, 0], [0.32, 0.24, 0.32], 0.08);
        part(GEO.cyl, m(0xe03131), hat, [0, 0.1, 0], [0.335, 0.08, 0.335], 0);
      } else if (hatId === 'hat_tophat') {
        part(GEO.cyl, m(0x26262b), hat, [0, 0.03, 0], [0.48, 0.05, 0.48], 0.06);
        part(GEO.cyl, m(0x26262b), hat, [0, 0.33, 0], [0.3, 0.56, 0.3], 0.07);
        part(GEO.cyl, m(0xe03131), hat, [0, 0.12, 0], [0.31, 0.1, 0.31], 0);
      } else if (hatId === 'hat_crown') {
        const gold = m(0xffd43b);
        part(GEO.cyl, gold, hat, [0, 0.1, 0], [0.32, 0.2, 0.32], 0.08);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          part(GEO.cone, gold, hat, [Math.cos(a) * 0.27, 0.3, Math.sin(a) * 0.27], [0.08, 0.24, 0.08], 0.12);
        }
        for (const side of [1, -1]) {
          part(GEO.sphere, m(0xe03131), hat, [0, 0.1, side * 0.32], [0.06, 0.06, 0.05], 0);
        }
        part(GEO.sphere, m(0x339af0), hat, [0.32, 0.1, 0], [0.05, 0.06, 0.06], 0);
      } else if (hatId === 'hat_propeller') {
        part(GEO.sphere, m(0x339af0), hat, [0, 0.02, 0], [0.36, 0.3, 0.36], 0.08);
        part(GEO.cyl, m(0xffd43b), hat, [0.3, 0.02, 0], [0.22, 0.04, 0.26], 0.06);
        part(GEO.cyl, m(0x495057), hat, [0, 0.38, 0], [0.025, 0.16, 0.025], 0);
        propeller = new THREE.Group();
        propeller.position.set(0, 0.47, 0);
        hat.add(propeller);
        part(GEO.box, m(0xe03131), propeller, [0, 0, 0], [0.66, 0.03, 0.11], 0);
        part(GEO.box, m(0xffd43b), propeller, [0, 0, 0], [0.11, 0.03, 0.66], 0);
      }
    }
    // 선글라스 (간지 폭발 증강 때 보인다. 꾸미기로 안경을 고르면 항상 쓴다)
    const shades = new THREE.Group();
    const shadeMat = new THREE.MeshBasicMaterial({ color: faceItem?.color ?? 0x111114 });
    for (const side of [1, -1]) {
      const lens = new THREE.Mesh(GEO.sphere, shadeMat);
      lens.scale.set(0.24, 0.17, 0.08);
      lens.position.set(0.3, 0.12, side * 0.53);
      shades.add(lens);
    }
    const bridge = new THREE.Mesh(GEO.box, shadeMat);
    bridge.scale.set(0.07, 0.06, 1.0);
    bridge.position.set(0.52, 0.16, 0);
    shades.add(bridge);
    shades.visible = false;
    head.add(shades);
    // 갈기: 목 뒤쪽을 따라 붙인다 (목이 늘어나면 함께 벌어진다)
    const mane = [0.28, 0.46, 0.64, 0.82, 1.0].map((frac) => ({
      frac,
      mesh: part(GEO.sphere, dark, neckGroup, [-0.24, frac * 2 * NECK_HALF, 0], [0.2, 0.22, 0.19], 0.1)
    }));

    // 꼬리
    const tail = new THREE.Group();
    tail.position.set(-0.95, 1.3, 0);
    torso.add(tail);
    part(GEO.sphere, dark, tail, [-0.15, -0.05, 0], [0.26, 0.24, 0.22], 0.1);
    part(GEO.sphere, dark, tail, [-0.42, -0.2, 0], [0.22, 0.2, 0.19], 0.1);
    part(GEO.sphere, dark, tail, [-0.62, -0.4, 0], [0.16, 0.16, 0.14], 0.1);

    // 다리 4개 (앞왼, 앞오, 뒤왼, 뒤오) — 길고 가는 다리 + 무릎 관절
    const legs: THREE.Group[] = [];
    const knees: THREE.Group[] = [];
    const hips: [number, number][] = [
      [0.6, 0.22],
      [0.6, -0.22],
      [-0.58, 0.22],
      [-0.58, -0.22]
    ];
    for (const [hx, hz] of hips) {
      const leg = new THREE.Group();
      // 다리가 흔들리는 축은 몸통 안쪽에 있는 허벅지 꼭대기다.
      // 축이 허벅지 중간에 있으면 달릴 때 윗부분이 반대로 흔들려 몸 밖으로 튀어나온다.
      leg.position.set(hx, HIP_Y + HIP_UP, hz);
      inner.add(leg);
      // 허벅지: 뒷다리는 엉덩이 근육까지 두껍게, 앞다리는 어깨 쪽이 굵게
      const hind = hx < 0;
      const tw = hind ? LEG.thighH : LEG.thighF;
      part(THIGH_GEO, legMat, leg, [0, -LEG.thighLen / 2, 0], [tw, LEG.thighLen, tw * 0.86], 0.1);
      // 몸통과 자연스럽게 이어지는 둥근 어깨·엉덩이
      part(GEO.sphere, legMat, leg, [0, -0.04, 0], [tw, tw, tw * 0.9], 0.08);
      const knee = new THREE.Group();
      knee.position.set(0, -0.66 - HIP_UP, 0);
      leg.add(knee);
      part(GEO.sphere, legMat, knee, [0, 0, 0], [LEG.knee, LEG.knee, LEG.knee], 0.14);
      part(GEO.cyl, legMat, knee, [0, -0.3, 0], [LEG.shin, 0.62, LEG.shin], 0.16);
      part(GEO.cyl, hoofMat, knee, [0, -0.57 - LEG.hoofH / 2, 0], [LEG.hoof, LEG.hoofH, LEG.hoof], 0);
      legs.push(leg);
      knees.push(knee);
    }

    // 날개 (비행 시에만 표시)
    const wings: THREE.Mesh[] = [];
    for (const side of [1, -1]) {
      const wing = part(GEO.sphere, white, torso, [-0.05, 1.68, side * 0.55], [0.5, 0.07, 0.42], 0.1);
      wing.visible = false;
      wings.push(wing);
    }

    // 부스터 불꽃
    const flame = new THREE.Mesh(GEO.cone, new THREE.MeshBasicMaterial({ color: 0xff922b }));
    flame.rotation.z = Math.PI / 2;
    flame.position.set(-1.8, 1.2, 0);
    flame.scale.set(0.28, 1.3, 0.28);
    flame.visible = false;
    torso.add(flame);

    // 방어막
    // 뽁뽁이 갑옷: 몸에 동글동글한 공기 방울이 덕지덕지 붙는다
    const bubbles = new THREE.Group();
    const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xd0ebff, transparent: true, opacity: 0.62 });
    const brand = seeded(info.id * 31 + 7);
    for (let i = 0; i < 26; i++) {
      const a = brand() * Math.PI * 2;
      const u = brand() * 2 - 1;
      const rr = Math.sqrt(1 - u * u);
      const bub = new THREE.Mesh(GEO.sphere, bubbleMat);
      bub.position.set(Math.cos(a) * rr * 1.02, 1.15 + u * 0.58, Math.sin(a) * rr * 0.52);
      bub.scale.setScalar(0.13 + brand() * 0.07);
      bubbles.add(bub);
    }
    bubbles.visible = false;
    torso.add(bubbles);
    // 과속 단속: 머리 위 경광등
    const siren = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: 0xff2d2d }));
    siren.scale.set(0.17, 0.2, 0.17);
    siren.position.set(-0.02, 0.74, 0);
    siren.visible = false;
    head.add(siren);

    const shield = new THREE.Mesh(
      GEO.sphere,
      new THREE.MeshBasicMaterial({ color: 0x74c0fc, transparent: true, opacity: 0.28 })
    );
    shield.scale.setScalar(2.35);
    shield.position.set(0.3, 2.2, 0);
    shield.visible = false;
    root.add(shield);

    // 바닥 그림자
    const shadow = new THREE.Mesh(
      GEO.disc,
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.25, 0.8, 1);
    shadow.position.set(0.1, 0.03, 0);
    root.add(shadow);

    root.position.set(0, 0, laneZ(info.id));
    this.scene.add(root);

    const label = document.createElement('div');
    label.className = 'r3d-label';
    this.overlay.appendChild(label);

    const dot = document.createElement('div');
    dot.className = 'r3d-dot';
    dot.style.background = info.color;
    dot.textContent = String(info.id);
    if (info.ownerId) dot.classList.add('mine');
    if (inkOn(info.color)) dot.classList.add('dk');
    this.minimap.appendChild(dot);

    return {
      info,
      root,
      inner,
      head,
      tail,
      legs,
      knees,
      neck,
      neckGroup,
      mane,
      body,
      shades,
      alwaysShades: !!faceItem,
      propeller,
      trail: look?.trail ?? 'trail_dust',
      coat,
      coatBase: coat.color.clone(),
      discoOn: false,
      rear: 0,
      legScale: 1,
      neckStretch: 0,
      inflate: 0,
      flat: 0,
      spin: 0,
      bobY: 0,
      headScale: 1,
      heli: 0,
      heliAng: 0,
      dive: 0,
      lookBack: 0,
      droop: 0,
      cross: 0,
      buff: 0,
      fxStart: {},
      note: null,
      bubbles,
      siren,
      eyes,
      wings,
      flame,
      shield,
      shadow,
      label,
      labelText: '',
      labelW: 0,
      labelH: 0,
      dot,
      displayPos: 0,
      targetPos: 0,
      speed: 0,
      phase: Math.random() * Math.PI * 2,
      bodyScale: 1,
      facing: 0,
      snap: null
    };
  }

  // ---------------- RaceView 구현 ----------------

  setupRace(infos: HorseInfo[]): void {
    for (const r of this.rigs) {
      this.scene.remove(r.root);
      r.label.remove();
      r.dot.remove();
    }
    this.rigs = infos.map((info) => this.buildRig(info));
    this.clearBanner();
    this.cameraTarget = 'leader';
    this.winnerId = null;
    this.shake = 0;
    this.camPos.set(15, 6.5, 17);
    this.camLook.set(-5, 1.2, 0);
  }

  pushState(snaps: HorseSnapshot[]): void {
    for (const snap of snaps) {
      const r = this.rigs.find((v) => v.info.id === snap.id);
      if (!r) continue;
      r.targetPos = snap.pos;
      r.speed = snap.speed;
      r.snap = snap;
    }
  }

  setCameraTarget(target: CameraTarget): void {
    this.cameraTarget = target;
    this.winnerId = null; // 직접 고르면 결승 연출 카메라를 끈다
  }

  cycleViewMode(): string {
    const i = VIEW_ORDER.indexOf(this.viewMode);
    this.viewMode = VIEW_ORDER[(i + 1) % VIEW_ORDER.length];
    this.winnerId = null;
    return VIEW_MODE_LABELS[this.viewMode];
  }

  viewModeLabel(): string {
    return VIEW_MODE_LABELS[this.viewMode];
  }

  setBottomInset(active: boolean): void {
    this.insetTarget = active ? 1 : 0;
  }

  announce(text: string, color = '#ffd803'): void {
    const el = document.createElement('div');
    el.className = 'r3d-announce';
    el.style.color = color;
    el.textContent = text;
    this.overlay.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  showEmote(name: string, emoji: string): void {
    const el = document.createElement('div');
    el.className = 'r3d-emote';
    el.style.left = `${12 + Math.random() * 76}%`;
    const e = document.createElement('span');
    e.className = 'r3d-emote-emoji';
    e.textContent = emoji;
    const n = document.createElement('span');
    n.className = 'r3d-emote-name';
    n.textContent = name;
    el.append(e, n);
    this.overlay.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  /** 증강을 맞은 말 머리 위에 카드 이름과 쓴 사람을 몇 초간 붙여 둔다 */
  showAugmentNote(ids: number[], text: string, by: string, hostile: boolean, seconds = 4.5): void {
    for (const id of ids) {
      const rig = this.rigs.find((v) => v.info.id === id);
      if (rig) rig.note = { text, by, hostile, until: this.elapsed + seconds };
    }
  }

  flashHorses(ids: number[], good: boolean): void {
    for (const id of ids) {
      const rig = this.rigs.find((v) => v.info.id === id);
      if (!rig) continue;
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(1.3, 0.13, 8, 32),
        new THREE.MeshBasicMaterial({ color: good ? 0x2cb67d : 0xef4565, transparent: true })
      );
      mesh.rotation.x = Math.PI / 2;
      this.scene.add(mesh);
      this.rings.push({ mesh, life: 0.8, rig });
    }
    if (!good) this.shake = Math.max(this.shake, 0.35);
  }

  showFinish(rankings: RankingEntry[]): void {
    this.clearBanner();
    const el = document.createElement('div');
    el.className = 'r3d-banner';
    const title = document.createElement('div');
    title.className = 'r3d-banner-title';
    title.textContent = '경주 종료';
    const sub = document.createElement('div');
    sub.className = 'r3d-banner-sub';
    for (const r of rankings.slice(0, 3)) {
      const info = this.rigs.find((v) => v.info.id === r.horseId)?.info;
      const item = document.createElement('span');
      const badge = document.createElement('span');
      badge.className = `rank-badge r${r.rank}`;
      badge.textContent = String(r.rank);
      item.append(badge, document.createTextNode(`${r.horseId}번 ${info?.name ?? ''}`));
      sub.appendChild(item);
    }
    el.append(title, sub);
    this.overlay.appendChild(el);
    this.banner = el;
    // 우승마를 도는 결승 연출 카메라
    this.winnerId = rankings.find((r) => r.rank === 1)?.horseId ?? null;
    this.orbit = 0.6;
  }

  clearBanner(): void {
    this.banner?.remove();
    this.banner = null;
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }

  // ---------------- 프레임 루프 ----------------

  private resize(): void {
    if (this.backdrop) {
      const bw = Math.max(1, this.container.clientWidth);
      const bh = Math.max(1, this.container.clientHeight);
      this.renderer.setSize(bw, bh, false);
      this.camera.aspect = bw / bh;
      // 넓은 화면에서는 말들이 오른쪽에 오도록 시야를 옮겨 왼쪽의 제목과 겹치지 않게 한다
      if (bw >= 900) this.camera.setViewOffset(bw * 1.45, bh, 0, 0, bw, bh);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      return;
    }
    if (this.preview) {
      const pw = Math.max(160, this.container.clientWidth);
      const ph = Math.round((pw * 3) / 4);
      this.renderer.setSize(pw, ph, false);
      this.camera.aspect = pw / ph;
      this.camera.updateProjectionMatrix();
      return;
    }
    const w = Math.max(280, this.container.clientWidth);
    // 세로로 든 폰에서는 화면이 좁으므로 경주 화면을 조금 더 높게 잡는다
    const portraitPhone = w < 640 && window.innerHeight > window.innerWidth;
    let h = Math.round(portraitPhone ? w * 0.72 : (w * 9) / 16);
    // 모바일 가로처럼 화면이 낮으면 상단 바를 뺀 높이에 맞춘다 (잘리지 않게)
    if (window.innerHeight < 560) h = Math.max(180, Math.min(h, window.innerHeight - 58));
    // 넓은 화면에서도 상단 바와 기록 칸이 함께 보이도록 높이를 화면에 맞춘다
    else if (!portraitPhone) h = Math.min(h, Math.max(260, window.innerHeight - 190));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private onWindowResize = (): void => this.resize();

  private loop = (now: number): void => {
    if (this.disposed) return;
    // rawDt: 실제 경과 시간(위치·카메라 추적용) / dt: 애니메이션용으로 상한을 둔 값
    const rawDt = Math.min(1, (now - this.lastTime) / 1000);
    const dt = Math.min(0.05, rawDt);
    this.lastTime = now;
    this.elapsed += dt;
    this.update(dt, rawDt);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number, rawDt: number): void {
    for (const r of this.rigs) this.updateRig(r, dt, rawDt);
    this.updateParticles(dt);
    this.updateEmojis(dt);
    this.updateRings(dt);
    this.updateCamera(rawDt);
  }

  private updateRig(r: Rig, dt: number, rawDt: number): void {
    // 프레임이 낮아도 서버 위치를 놓치지 않도록 지수 보간을 쓴다
    r.displayPos += (r.targetPos - r.displayPos) * (1 - Math.exp(-rawDt * 9));
    r.root.position.x = r.displayPos * UNIT;

    const snap = r.snap;
    const anim: HorseAnim = snap?.anim ?? 'idle';
    const t = this.elapsed;
    const ease = (cur: number, target: number, rate: number): number =>
      cur + (target - cur) * Math.min(1, dt * rate);

    // 지금 걸려 있는 증강들의 연출 종류
    const vis = new Set<AugmentVisual>();
    if (snap) {
      for (const e of snap.effects) {
        const v = AUGMENT_BY_ID[e.defId]?.visual;
        if (v) vis.add(v);
      }
    }
    // 한 번 재생하는 연출의 진행도(0~1). 서버 상태는 0.1초 단위라 시작 시각만 받아 직접 센다.
    const oneShot = (v: AugmentVisual): number | null => {
      const e = snap?.effects.find((x) => AUGMENT_BY_ID[x.defId]?.visual === v);
      if (!e) {
        delete r.fxStart[v];
        return null;
      }
      const def = AUGMENT_BY_ID[e.defId];
      const total = (def.visualMs || def.durationMs || 1000) / 1000;
      if (r.fxStart[v] === undefined) r.fxStart[v] = t - Math.max(0, total - e.remainMs / 1000);
      return Math.min(1, Math.max(0, (t - r.fxStart[v]) / total));
    };
    const flipK = oneShot('flip'); // 바나나 껍질: 앞 35%는 공중제비, 나머지는 엉덩방아
    const FLIP_PART = 0.35;
    const flipping = flipK != null && flipK < FLIP_PART;
    const sitting = flipK != null && !flipping;
    const warpK = oneShot('warp');
    const swapK = oneShot('swap');
    const lowbat = vis.has('lowbat');
    const siren = vis.has('siren');
    r.cross = ease(r.cross, vis.has('poop') ? 1 : 0, 8);
    r.buff = ease(r.buff, vis.has('muscle') ? 1 : 0, 5);
    // 득근 각성: 가끔 한쪽 앞다리를 들어 알통을 자랑한다
    const flexing = r.buff > 0.5 && Math.sin(t * 2.4) > 0.55;
    const disco = vis.has('disco');
    const hop = vis.has('hop');
    const pose = vis.has('pose');
    const eat = vis.has('eat');
    // 멈춰 있어도 잠든 모습이 아닌 연출들 (춤, 포즈, 먹방)
    const awake = disco || pose || eat;
    const flying = anim === 'flying';

    const speedNorm = Math.min(1.6, Math.abs(r.speed) / 20);
    const frozen = (anim === 'stunned' && !disco) || anim === 'fallen' || anim === 'idle';
    const runAmt = frozen || disco ? 0 : Math.min(1, Math.abs(r.speed) / 12);
    r.phase += dt * (2.5 + speedNorm * 13);
    const rocket = vis.has('rocket') && anim !== 'fallen' && anim !== 'stunned';
    const nap = vis.has('nap') && anim === 'stunned';
    const backpedal = vis.has('backpedal');
    const jitter = vis.has('jitter');
    // 에너지 드링크: 다리가 두 배로 빨리 돈다
    if (jitter) r.phase += dt * (2.5 + speedNorm * 13);
    r.dive = ease(r.dive, rocket ? 1 : 0, 7);
    r.lookBack = ease(r.lookBack, backpedal ? 1 : 0, 9);
    r.droop = ease(r.droop, vis.has('droop') && !flying ? 1 : 0, 5);
    const diveAng = -0.52 * r.dive; // 엉덩이를 들어 올린 각도

    // 변신 수치 (부드럽게 변하도록 보간)
    r.rear = ease(r.rear, vis.has('bipedal') ? 1 : 0, 7);
    r.legScale = ease(r.legScale, vis.has('pony') ? 0.55 : 1, 7);
    r.neckStretch = ease(r.neckStretch, vis.has('giraffe') ? 1 : 0, 6);
    r.inflate = ease(r.inflate, vis.has('balloon') ? 1 : 0, 5);
    r.flat = ease(r.flat, vis.has('paper') ? 1 : 0, 8);
    const theta = r.rear * 1.1; // 이족보행으로 몸을 세운 각도

    // 다리
    const offsets = [0, 0.55, Math.PI + 0.35, Math.PI + 0.9];
    r.legs.forEach((leg, i) => {
      const knee = r.knees[i];
      const front = i < 2;
      leg.scale.y = r.legScale;
      // 급똥: 다리를 안쪽으로 꼰다 / 득근: 앞다리만 굵어진다
      leg.rotation.x = (i % 2 === 0 ? 1 : -1) * 0.34 * r.cross;
      leg.scale.x = leg.scale.z = front ? 1 + 0.85 * r.buff : 1;
      if (flipping) {
        // 공중제비: 다리를 몸 쪽으로 접는다
        leg.rotation.z = 0.6;
        knee.rotation.z = -1.5;
      } else if (sitting) {
        // 엉덩방아: 뒷다리를 앞으로 뻗고 주저앉는다
        leg.rotation.z = front ? 0.35 + Math.sin(t * 9 + i) * 0.12 : 1.35;
        knee.rotation.z = front ? -0.5 : -0.08;
      } else if (nap) {
        // 벌렁 누워 하늘로 뻗은 다리가 가끔 움찔한다
        leg.rotation.z = Math.sin(t * 2.2 + i * 1.7) * 0.14;
        knee.rotation.z = -0.12 - Math.max(0, Math.sin(t * 1.3 + i * 2.1)) * 0.5;
      } else if (rocket && !front) {
        // 엉덩이 로켓: 뒷다리는 공중에서 허우적거린다
        leg.rotation.z = -0.85 - diveAng + Math.sin(t * 19 + i * 2.4) * 0.3;
        knee.rotation.z = -0.5 - Math.sin(t * 17 + i) * 0.35;
      } else if (anim === 'fallen') {
        leg.rotation.z = Math.sin(t * 11 + i * 1.3) * 0.5;
        knee.rotation.z = -0.6 - Math.sin(t * 9 + i) * 0.4;
      } else if (flying) {
        leg.rotation.z = front ? 0.8 : -0.6;
        knee.rotation.z = -1.1;
      } else if (disco) {
        // 춤: 다리를 번갈아 흔든다
        leg.rotation.z = Math.sin(t * 12 + i * 1.6) * 0.5;
        knee.rotation.z = -0.4 - Math.sin(t * 12 + i) * 0.3;
      } else if (r.inflate > 0.5) {
        // 풍선: 다리가 힘없이 흔들린다
        leg.rotation.z = Math.sin(t * 2 + i) * 0.15;
        knee.rotation.z = -0.2;
      } else if (hop) {
        // 토끼뜀: 앞다리와 뒷다리를 각각 모아 뛴다
        const s = Math.sin(r.phase * 0.5);
        leg.rotation.z = (front ? 0.55 : -0.55) * s * runAmt;
        knee.rotation.z = -Math.max(0, -s) * 0.9 * runAmt;
      } else {
        // 갤럽: 다리를 앞으로 가져올 때 무릎을 접는다
        // 배터리 1%: 동작이 뚝뚝 끊긴다 / 급똥: 보폭이 줄어 종종걸음이 된다
        const ph = lowbat ? Math.floor(r.phase / 0.9) * 0.9 : r.phase;
        const stride = 1 - 0.6 * r.cross;
        let swing = Math.sin(ph + offsets[i]) * 0.75 * runAmt * stride;
        let bend = -Math.max(0, Math.sin(ph + offsets[i] + 1.1)) * 1.05 * runAmt * stride;
        if (theta > 0.01) {
          if (front) {
            // 이족보행: 앞다리는 팔처럼 허우적거린다
            swing = swing * (1 - r.rear) + (0.4 + Math.sin(t * 9 + i * 2.2) * 0.7) * r.rear;
            bend = bend * (1 - r.rear) + (-0.5 - Math.sin(t * 7 + i) * 0.4) * r.rear;
          } else {
            // 뒷다리는 몸이 서도 땅을 딛도록 되돌린다
            swing -= theta;
          }
        }
        // 엉덩이 로켓: 몸이 앞으로 쏠려도 앞다리는 땅을 딛는다
        if (front && r.dive > 0.01) swing -= diveAng;
        if (i === 0 && flexing) {
          swing = 1.25;
          bend = -1.75;
        }
        leg.rotation.z = swing;
        knee.rotation.z = bend;
      }
    });

    // 몸통 출렁임과 기울기
    let y = Math.abs(Math.sin(r.phase)) * 0.16 * runAmt;
    let pitch = Math.sin(r.phase) * 0.07 * runAmt;
    let roll = 0;
    if (flying) {
      y = 1.7 + Math.sin(t * 3) * 0.25;
      pitch = 0.12;
    } else if (anim === 'fallen') {
      y = 0.5;
      pitch = 0;
      roll = Math.PI / 2;
    } else if (anim === 'boost') {
      pitch += 0.1;
    }
    if (hop && runAmt > 0) y = Math.abs(Math.sin(r.phase * 0.5)) * 1.0 * runAmt;
    if (disco) y = Math.abs(Math.sin(t * 10)) * 0.35;
    if (r.inflate > 0.01) {
      y += r.inflate * (1.3 + Math.sin(t * 2.5) * 0.2);
      roll += Math.sin(t * 1.8) * 0.12 * r.inflate;
    }
    if (nap) {
      // 식곤증: 배를 하늘로 하고 드러눕는다
      y = 2.25;
      pitch = 0;
      roll = Math.PI;
    }
    if (jitter) {
      // 에너지 드링크: 온몸이 덜덜 떨린다
      y += Math.sin(t * 61) * 0.05;
      pitch += Math.sin(t * 47) * 0.05;
      roll += Math.sin(t * 53) * 0.06;
    }
    let flipAng = 0;
    if (flipK != null) {
      roll = 0;
      if (flipping) {
        // 바나나 껍질: 제자리에서 한 바퀴 돈다
        const k = flipK / FLIP_PART;
        y = Math.sin(Math.PI * k) * 1.5;
        pitch = 0;
        flipAng = -k * Math.PI * 2;
      } else {
        // 엉덩방아
        y = -0.58;
        pitch = 0.5;
      }
    }
    if (swapK != null) {
      // 인생 역전: 하늘로 솟아 한 바퀴 구르고 떨어진다
      y += Math.sin(Math.PI * swapK) * 3.2;
      flipAng = swapK * Math.PI * 2;
    }
    if (lowbat) y = 0;
    // 비틀비틀: 몸이 좌우로 기우뚱거린다
    if (vis.has('wobble') && anim !== 'fallen') roll += Math.sin(t * 9) * 0.26;
    r.bobY = ease(r.bobY, y, 12);

    // 몸집 변화 (거대화 > 벌크업 > 조랑말 > 다이어트 > 근육)
    let scaleTarget = 1;
    if (vis.has('giant')) scaleTarget = 1.9;
    else if (vis.has('bulk')) scaleTarget = 1.38;
    else if (vis.has('pony')) scaleTarget = 0.62;
    else if (vis.has('slim')) scaleTarget = 0.78;
    else if (vis.has('muscle')) scaleTarget = 1.12;
    r.bodyScale = ease(r.bodyScale, scaleTarget, 6);
    const s = r.bodyScale;
    // 칼퇴 워프: 납작하게 눌렸다가 앞뒤로 길게 늘어난다
    const warp = warpK != null ? Math.sin(Math.PI * warpK) : 0;
    r.inner.scale.set(s * (1 + 1.3 * warp), s * (1 - 0.5 * warp), s * (1 - 0.88 * r.flat)); // 종이 말은 옆으로 납작해진다

    // 조랑말: 다리가 짧아진 만큼 몸을 내린다
    const legDrop = (1 - r.legScale) * (HIP_Y + HIP_UP) * s;
    // 이족보행: 뒷다리 엉덩이 관절을 축으로 몸 전체를 세운다
    const px = -0.58;
    const py = HIP_Y;
    const rotX = px * Math.cos(theta) - py * Math.sin(theta);
    const rotY = px * Math.sin(theta) + py * Math.cos(theta);
    // 엉덩이 로켓: 앞다리 어깨 관절을 축으로 엉덩이를 들어 올린다
    const fx = 0.6;
    const diveX = fx - (fx * Math.cos(diveAng) - py * Math.sin(diveAng));
    const diveY = py - (fx * Math.sin(diveAng) + py * Math.cos(diveAng));
    // 공중제비는 몸 한가운데를 축으로 돈다
    const cy = 1.8;
    r.inner.position.x = (px - rotX + diveX + cy * Math.sin(flipAng)) * s + (jitter ? Math.sin(t * 71) * 0.04 : 0);
    r.inner.position.y = r.bobY - legDrop + (py - rotY + diveY + cy * (1 - Math.cos(flipAng))) * s;
    r.inner.rotation.z = pitch + theta + diveAng + flipAng;
    r.inner.rotation.x = ease(r.inner.rotation.x, roll, 10);
    // 옆으로 누울 때 몸이 옆 레인으로 넘어가지 않게 당겨 준다
    r.inner.position.z = -Math.sin(r.inner.rotation.x) * 1.6;

    // 방향: 역주행·문워크는 뒤돌고, 빙글빙글은 계속 돈다
    // 뒷걸음질(가스불 안 껐다)은 몸은 앞을 본 채 머리만 뒤로 돌린다
    const backwards = (anim === 'reverse' && !backpedal) || vis.has('moonwalk');
    // 포즈: 옆(카메라 쪽)을 보고 선다
    r.facing = ease(r.facing, pose ? -Math.PI / 2 : backwards ? Math.PI : 0, 12);
    if (vis.has('spin')) {
      r.spin += dt * 13;
    } else if (r.spin !== 0) {
      r.spin %= Math.PI * 2;
      r.spin = ease(r.spin, r.spin > Math.PI ? Math.PI * 2 : 0, 10);
      if (r.spin < 0.02 || Math.PI * 2 - r.spin < 0.02) r.spin = 0;
    }
    r.root.rotation.y = r.facing + r.spin + (disco ? Math.sin(t * 6) * 0.7 : 0);

    // 머리 끄덕임 / 처짐 (몸을 세워도 앞을 보도록 되돌린다)
    let droop = 0;
    if (anim === 'tired' || anim === 'slow') droop = -0.32;
    if (anim === 'stunned') droop = -0.6;
    if (anim === 'boost') droop = 0.12;
    if (siren) droop = -0.55; // 딱지 끊기고 풀이 죽었다
    if (lowbat) droop = -0.8;
    let headTarget = droop + Math.sin(r.phase + 0.8) * 0.08 * runAmt - theta * 0.75;
    if (disco) headTarget = Math.sin(t * 10) * 0.25;
    if (pose) headTarget = 0.22; // 턱을 든다
    if (eat) headTarget = -0.55 + Math.sin(t * 14) * 0.18; // 고개를 숙이고 우물우물
    r.head.rotation.z = ease(r.head.rotation.z, headTarget, 10);

    // 기린 목: 목을 늘리고 머리를 그만큼 올린다
    const neckH = NECK_HALF * (1 + 1.5 * r.neckStretch);
    r.neck.scale.y = neckH;
    r.neck.position.y = neckH;
    for (const m of r.mane) m.mesh.position.y = m.frac * 2 * neckH;
    // 목 프로펠러 비행: 목을 옆으로 눕히고 어깨를 축으로 헬리콥터 날개처럼 돌린다.
    // 머리는 목 끝에 매달려 함께 돈다.
    r.heli = ease(r.heli, flying ? 1 : 0, 6);
    if (flying) {
      r.heliAng += dt * 24;
    } else if (r.heliAng !== 0) {
      // 끝나면 가까운 쪽으로 돌아 제자리에 선다
      r.heliAng %= Math.PI * 2;
      r.heliAng = ease(r.heliAng, r.heliAng > Math.PI ? Math.PI * 2 : 0, 10);
      if (r.heliAng < 0.02 || Math.PI * 2 - r.heliAng < 0.02) r.heliAng = 0;
    }
    // 목 늘어짐(월요병): 목이 앞으로 꺾여 머리가 땅에 끌린다
    const tilt = NECK_TILT + (1.12 - NECK_TILT) * r.heli + (2.2 - NECK_TILT) * r.droop * (1 - r.heli);
    const reach = Math.sin(tilt) * 2 * neckH + 0.12;
    r.neckGroup.rotation.z = -tilt;
    r.neckGroup.rotation.y = r.heliAng;
    r.head.position.x = NECK_BASE_X + Math.cos(r.heliAng) * reach;
    r.head.position.z = -Math.sin(r.heliAng) * reach;
    r.head.position.y = NECK_BASE_Y + Math.cos(tilt) * 2 * neckH - 0.18 * (1 - r.heli);
    r.head.rotation.y = r.heliAng + r.lookBack * 2.75;

    // 풍선: 몸통이 둥글게 부푼다
    r.body.scale.set(1.0 + 0.15 * r.inflate, 0.56 + 0.5 * r.inflate, 0.5 + 0.5 * r.inflate);

    // 꼬리는 속도가 붙을수록 뒤로 날린다
    r.tail.rotation.z = -runAmt * 0.65 + Math.sin(r.phase * 1.2) * 0.18;

    // 눈 (기절·졸림이면 감는다. 춤출 때는 뜬다)
    let eyeScale = 1;
    if (anim === 'stunned' && !awake) eyeScale = 0.12;
    else if (anim === 'tired' || anim === 'slow') eyeScale = 0.55;
    if (jitter) eyeScale = 1.55; // 카페인으로 눈이 번쩍
    if (lowbat) eyeScale = 0.28;
    for (const eye of r.eyes) eye.scale.y = ease(eye.scale.y, eyeScale, 14);

    // 날개, 선글라스
    r.wings.forEach((w, i) => {
      // 날개는 쓰지 않는다 — 비행은 목 프로펠러로 한다
      w.visible = false;
      void i;
    });
    r.shades.visible = vis.has('shades') || pose || r.alwaysShades;
    if (r.propeller) r.propeller.rotation.y += dt * (6 + speedNorm * 22);
    // 대두: 머리가 부풀어 오른다
    r.headScale = ease(r.headScale, vis.has('bighead') ? 1.75 : 1, 6);
    r.head.scale.setScalar(0.9 * r.headScale);

    // 디스코: 털 색이 무지개로 바뀐다
    if (disco) {
      r.coat.color.setHSL((t * 0.9 + r.info.id * 0.13) % 1, 0.85, 0.6);
      r.discoOn = true;
    } else if (r.discoOn) {
      r.coat.color.copy(r.coatBase);
      r.discoOn = false;
    }

    // 부스터 불꽃(방귀 부스터는 불꽃 대신 초록 연기), 방어막, 그림자
    const boosting = anim === 'boost';
    const fart = vis.has('fart');
    r.flame.visible = boosting && !fart;
    if (r.flame.visible) r.flame.scale.set(0.3, 1.2 + Math.sin(t * 40) * 0.35, 0.3);
    // 방어막은 큰 구 대신 뽁뽁이로 보여 준다
    r.shield.visible = false;
    r.bubbles.visible = (snap?.shield ?? 0) > 0;
    r.siren.visible = false; // 예전 '과속 단속'의 경광등 — 지금은 쓰지 않는다
    const airborne = flying || r.inflate > 0.5;
    const shadowScale = (airborne ? 0.7 : 1) * s;
    r.shadow.scale.set(1.25 * shadowScale, 0.8 * shadowScale, 1);

    // 증강별 이펙트 — 색 연기 대신 그림 스티커(이모지)를 뿌린다
    {
      const X = r.root.position.x;
      const Z = r.root.position.z;
      const rearX = X - 0.9 * Math.cos(r.root.rotation.y);
      const rnd = (a: number): number => (Math.random() - 0.5) * a;
      const pop = (rate: number, emojis: string[], x: number, y: number, size = 0.9, vy = 1.6): void => {
        if (Math.random() < dt * rate) {
          this.spawnEmoji(emojis[Math.floor(Math.random() * emojis.length)], x + rnd(0.6), y + rnd(0.4), Z + rnd(0.8), size, vy);
        }
      };
      const headX = X + r.head.position.x * s;
      const headY = (r.head.position.y + TORSO_RAISE) * s + r.inner.position.y;
      if (rocket) pop(16, ['🔥', '💥', '💨'], rearX - 0.4, 2.3 * s, 1.1); // 엉덩이 로켓: 꽁무니 폭발
      if (jitter) pop(9, ['⚡', '☕', '‼️'], X + rnd(1.8), 2.6, 0.8); // 에너지 드링크: 카페인 과다
      if (vis.has('droop')) pop(4, ['🥱', '💤'], headX + 0.4, headY + 1.1, 0.9, 0.5); // 하품 전염
      if (flying) pop(8, ['🌀', '🍃'], X + rnd(1.6), r.inner.position.y + 0.6, 0.8, -1.2); // 목 프로펠러: 아래로 내리꽂는 바람
      if (vis.has('poop')) pop(5, ['💩', '💦', '🧻'], rearX - 0.1, 1.7 * s, 0.75); // 급똥: 설명 생략
      if (warpK != null) pop(26, ['💨', '✨', '🧭'], X - 0.5 - Math.random() * 2.5, 1.6 + Math.random(), 0.8, 0.4); // 지름길 발견
      if (swapK != null) pop(18, ['🔀', '✨', '💫'], X + rnd(1.5), r.inner.position.y + 1.6 + rnd(1.5), 0.9); // 말생 역전
      if (sitting) pop(6, ['⭐', '💫', '🍌'], headX + rnd(0.8), headY + 0.9, 0.7, 0.6); // 엉덩방아: 별이 보인다
      if (r.buff > 0.5) pop(4, ['💪', '🥕', '💦'], X + rnd(1.2), 3.2 * s, 0.85); // 득근: 당근 단백질의 힘
      if (lowbat) pop(4, ['💦', '😮‍💨'], headX, headY + 0.9, 0.8, 0.7); // 헉헉 방전
      if (nap) pop(3, ['💤', '🍚'], X + 0.6, 2.4, 0.9, 0.9); // 식곤증: 밥 먹고 꿀잠
      if (siren) pop(4, ['🪢', '✋'], headX, headY + 1.0, 0.8, 0.8); // 고삐 당기기
      if (vis.has('eat')) pop(5, ['🥕', '😋'], headX + 0.5, headY - 0.2, 0.7, 0.9); // 당근 먹방
      if (disco) pop(7, ['🎵', '🎶', '🪩'], X + rnd(2), 3.2, 0.8); // 디스코 타임
      if (vis.has('bighead')) pop(3, ['👑', '✨'], headX + rnd(1.5), headY + rnd(1.2), 0.8, 0.3); // 우승 후보 병: 벌써 왕관
      if (vis.has('giant')) pop(3, ['🦖', '💢'], X + rnd(2), 5.2, 1.2, 0.8); // 거대화
      if (fart) pop(4, ['💨', '🤢'], rearX - 0.6, 1.8 * s, 0.9); // 방귀 부스터: 뒤따르는 말의 심정
    }

    // 발굽 먼지 / 방귀 연기
    const backX = r.root.position.x - 0.9 * Math.cos(r.root.rotation.y);
    if (fart && Math.random() < dt * 40) {
      this.spawnDust(backX, 1.6 * s, r.root.position.z + (Math.random() - 0.5) * 0.5, true, this.fartMat);
    } else if (runAmt > 0.35 && !airborne && Math.random() < dt * (boosting ? 26 : 11)) {
      this.spawnDust(backX, 0.15, r.root.position.z + (Math.random() - 0.5) * 0.6, boosting, this.trailMaterial(r.trail));
    }
  }

  // ---------- 이모지 스티커 이펙트 ----------
  private emojiTex = new Map<string, THREE.CanvasTexture>();
  private emojiPool: { sprite: THREE.Sprite; life: number; maxLife: number; vx: number; vy: number; size: number; spin: number }[] = [];

  private spawnEmoji(emoji: string, x: number, y: number, z: number, size: number, vy: number): void {
    let p = this.emojiPool.find((q) => q.life <= 0);
    if (!p) {
      if (this.emojiPool.length >= 70) return;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      this.scene.add(sprite);
      p = { sprite, life: 0, maxLife: 1, vx: 0, vy: 0, size: 1, spin: 0 };
      this.emojiPool.push(p);
    }
    let tex = this.emojiTex.get(emoji);
    if (!tex) {
      tex = canvasTexture(96, 96, (g) => {
        g.font = '72px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(emoji, 48, 54);
      });
      this.emojiTex.set(emoji, tex);
    }
    const mat = p.sprite.material as THREE.SpriteMaterial;
    mat.map = tex;
    mat.needsUpdate = true;
    p.maxLife = 0.9 + Math.random() * 0.5;
    p.life = p.maxLife;
    p.size = size;
    p.vx = -1.2 - Math.random() * 1.2;
    p.vy = vy * (0.7 + Math.random() * 0.6);
    p.spin = (Math.random() - 0.5) * 2.4;
    p.sprite.position.set(x, y, z);
    p.sprite.visible = true;
  }

  private updateEmojis(dt: number): void {
    for (const p of this.emojiPool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      const k = p.life / p.maxLife;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      // 통 튀어나왔다가 서서히 사라진다
      const pop = Math.min(1, (1 - k) * 6);
      p.sprite.scale.setScalar(p.size * (0.4 + 0.6 * pop));
      const mat = p.sprite.material as THREE.SpriteMaterial;
      mat.opacity = Math.min(1, k * 2.2);
      mat.rotation += p.spin * dt;
    }
  }

  private fxMats = new Map<number, THREE.MeshBasicMaterial>();
  private fxMat(color: number): THREE.MeshBasicMaterial {
    let m = this.fxMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
      this.fxMats.set(color, m);
    }
    return m;
  }

  /** 꾸미기로 고른 발자국 색의 재질 (무지개는 낱알마다 색이 다르다) */
  private trailMaterial(id: string): THREE.Material {
    if (id === 'trail_dust') return this.dustMat;
    let mats = this.trailMats.get(id);
    if (!mats) {
      const colors =
        id === 'trail_rainbow'
          ? ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#b197fc']
          : [COSMETIC_BY_ID[id]?.color ?? '#e8c9a0'];
      mats = colors.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8 }));
      this.trailMats.set(id, mats);
    }
    return mats[Math.floor(Math.random() * mats.length)];
  }

  private spawnDust(x: number, y: number, z: number, big: boolean, mat: THREE.Material): void {
    let p = this.particles.find((q) => q.life <= 0);
    if (!p) {
      if (this.particles.length >= 110) return;
      const mesh = new THREE.Mesh(GEO.sphere, this.dustMat);
      this.scene.add(mesh);
      p = { mesh, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, size: 0.2 };
      this.particles.push(p);
    }
    p.mesh.material = mat;
    p.maxLife = 0.55 + Math.random() * 0.3;
    p.life = p.maxLife;
    p.size = (big ? 0.34 : 0.22) + Math.random() * 0.12;
    p.vx = -1.5 - Math.random() * 1.5;
    p.vy = 0.9 + Math.random() * 0.8;
    p.vz = (Math.random() - 0.5) * 1.2;
    p.mesh.position.set(x, y, z);
    p.mesh.visible = true;
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const k = p.life / p.maxLife;
      p.mesh.scale.setScalar(p.size * (0.4 + (1 - k) * 1.1) * Math.min(1, k * 3));
    }
  }

  private updateRings(dt: number): void {
    this.rings = this.rings.filter((ring) => {
      ring.life -= dt;
      if (ring.life <= 0) {
        this.scene.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        (ring.mesh.material as THREE.Material).dispose();
        return false;
      }
      const k = 1 - ring.life / 0.8;
      ring.mesh.position.set(ring.rig.root.position.x, 0.15 + k * 1.6, ring.rig.root.position.z);
      ring.mesh.scale.setScalar(0.6 + k * 1.3);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      return true;
    });
  }

  private leaderRig(): Rig | undefined {
    if (this.rigs.length === 0) return undefined;
    return this.rigs.reduce((a, b) => (b.displayPos > a.displayPos ? b : a));
  }

  private followedRig(): Rig | undefined {
    if (this.cameraTarget === 'leader') return this.leaderRig();
    return this.rigs.find((r) => r.info.id === this.cameraTarget) ?? this.leaderRig();
  }

  private updateCamera(dt: number): void {
    const target = this.followedRig();
    if (!target) return;
    const tx = target.root.position.x;
    const tz = target.root.position.z;
    if (this.preview) {
      // 말 주위를 좌우로 천천히 오가며 비춘다
      const a = 0.5 + Math.sin(this.elapsed * 0.45) * 0.75;
      this.camera.position.set(tx + Math.sin(a) * 8.6 + 0.3, 3.5, tz + Math.cos(a) * 8.6);
      this.camera.lookAt(tx + 0.35, 2.15, tz);
      return;
    }
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();

    const winner =
      this.winnerId != null ? this.rigs.find((r) => r.info.id === this.winnerId) : undefined;
    if (winner) {
      // 결승 연출: 우승마 주위를 천천히 돈다
      this.orbit += dt * 0.45;
      const wx = winner.root.position.x;
      const wz = winner.root.position.z;
      pos.set(wx + Math.cos(this.orbit) * 9, 4.6, wz + Math.sin(this.orbit) * 9);
      look.set(wx, 1.4, wz);
    } else {
      switch (this.viewMode) {
        case 'broadcast':
          // 앞쪽 대각선에서 뒤따르는 말들까지 한 화면에 담는다
          pos.set(tx + 15, 6.5, 17);
          look.set(tx - 5, 1.2, 0);
          break;
        case 'side':
          pos.set(tx + 1, 6, 27);
          look.set(tx + 1, 1.5, 0);
          break;
        case 'chase':
          pos.set(tx - 14, 6.5, tz * 0.4);
          look.set(tx + 10, 1.0, tz * 0.5);
          break;
        case 'top':
          // 뒤따르는 말들이 더 보이도록 선두보다 약간 뒤를 내려다본다
          pos.set(tx - 10, 38, 14);
          look.set(tx - 8, 0, 0);
          break;
      }
    }

    // 하단 UI가 떠 있으면 시선을 낮춰 말이 화면 위쪽에 오게 한다
    this.inset += (this.insetTarget - this.inset) * (1 - Math.exp(-dt * 5));
    if (!winner && this.inset > 0.001) {
      if (this.viewMode === 'top') look.z += 9 * this.inset;
      else if (this.viewMode === 'chase') {
        look.y -= 6.5 * this.inset;
        pos.y += 2.5 * this.inset;
      }
      else look.y -= 4.6 * this.inset;
    }

    const k = 1 - Math.exp(-dt * 4);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const a = this.shake * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }
    this.camera.lookAt(this.camLook);
  }

  // ---------------- DOM 라벨 / 미니맵 ----------------

  private updateLabels(): void {
    const w = this.container.clientWidth;
    const h = this.renderer.domElement.clientHeight || (w * 9) / 16;
    const v = new THREE.Vector3();
    const followed = this.followedRig();
    const placements: { rig: Rig; sx: number; sy: number; scale: number; dist: number }[] = [];

    for (const r of this.rigs) {
      const snap = r.snap;
      const anim = snap?.anim ?? 'idle';

      // 라벨 내용 (바뀔 때만 DOM 갱신)
      const fx: string[] = [];
      if (snap) {
        if (snap.shield > 0) fx.push('🛡️');
        const awake = snap.effects.some((e) => {
          const v = AUGMENT_BY_ID[e.defId]?.visual;
          return v === 'disco' || v === 'pose' || v === 'eat';
        });
        if (anim === 'stunned' && !awake) fx.push('💤');
        if (anim === 'tired') fx.push('💦');
        if (anim === 'fallen') fx.push('💫');
        if (anim === 'finished') fx.push('🏁');
        fx.push(...snap.effects.map((e) => e.emoji));
      }
      const fxText = [...new Set(fx)].slice(0, 5).join('');
      const rankText = snap ? `${snap.rank}위` : '';
      if (r.note && this.elapsed > r.note.until) r.note = null;
      const text = `${rankText}|${fxText}|${r.note ? r.note.text + r.note.by : ''}`;
      if (text !== r.labelText) {
        r.labelText = text;
        r.label.innerHTML = '';
        if (r.note) {
          const nt = document.createElement('div');
          nt.className = `r3d-label-note${r.note.hostile ? ' hostile' : ''}`;
          nt.textContent = r.note.text;
          const who = document.createElement('small');
          who.textContent = r.note.by;
          nt.appendChild(who);
          r.label.appendChild(nt);
        }
        if (fxText) {
          const f = document.createElement('div');
          f.className = 'r3d-label-fx';
          f.textContent = fxText;
          r.label.appendChild(f);
        }
        const n = document.createElement('div');
        n.className = 'r3d-label-name';
        n.style.borderColor = r.info.color;
        n.textContent = `${rankText ? rankText + ' ' : ''}${r.info.id}번 ${r.info.name}`;
        n.classList.toggle('mine', !!r.info.ownerId);
        r.label.appendChild(n);
        r.labelW = 0; // 다음 표시 때 크기를 다시 잰다
      }

      // 3D 위치 → 화면 좌표
      v.set(r.root.position.x + 0.3, (4.2 + 2.4 * r.neckStretch - 1.2 * r.rear) * r.bodyScale + r.inner.position.y, r.root.position.z);
      const dist = this.camera.position.distanceTo(v);
      v.project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      const visible = v.z < 1 && v.z > -1 && sx > -60 && sx < w + 60 && sy > -20 && sy < h + 40;
      r.label.style.display = visible ? '' : 'none';
      if (visible) {
        if (r.labelW === 0) {
          r.labelW = r.label.offsetWidth || 110;
          r.labelH = r.label.offsetHeight || 24;
        }
        placements.push({ rig: r, sx, sy, scale: Math.max(0.55, Math.min(1.1, 24 / dist)), dist });
      }

      // 미니맵 점
      r.dot.style.left = `${(r.displayPos / COURSE_LENGTH) * 100}%`;
      r.dot.classList.toggle('followed', r === followed);
    }

    // 겹침 해소: 카메라에 가까운 말의 이름표를 먼저 놓고, 겹치는 것은 위로 밀어 올린다
    placements.sort((a, b) => a.dist - b.dist);
    const placed: { cx: number; bottom: number; w: number; h: number }[] = [];
    for (const p of placements) {
      const lw = p.rig.labelW * p.scale;
      const lh = p.rig.labelH * p.scale;
      let bottom = p.sy;
      for (let pass = 0; pass < 6; pass++) {
        const hit = placed.find(
          (o) =>
            Math.abs(o.cx - p.sx) < (o.w + lw) / 2 + 4 &&
            bottom > o.bottom - o.h - 2 &&
            bottom - lh < o.bottom + 2
        );
        if (!hit) break;
        bottom = hit.bottom - hit.h - 3;
      }
      placed.push({ cx: p.sx, bottom, w: lw, h: lh });
      p.rig.label.style.transform = `translate(${p.sx.toFixed(1)}px, ${bottom.toFixed(1)}px) translate(-50%, -100%) scale(${p.scale.toFixed(2)})`;
    }
  }
}

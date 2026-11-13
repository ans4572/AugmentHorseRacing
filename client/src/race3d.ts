import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  // 멀리 수백 개씩 깔리는 배경(관중·덤불·나무·울타리 기둥)과 먼지 알갱이는 면 수가 적은 도형을 쓴다.
  // 배경은 트랙 전체가 한 묶음으로 그려지므로 여기서 줄인 면 수가 그대로 매 프레임 절약된다
  sphereLo: new THREE.SphereGeometry(1, 10, 7),
  cylLo: new THREE.CylinderGeometry(1, 1, 1, 7),
  coneLo: new THREE.ConeGeometry(1, 1, 7),
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
  /** 강조할 때 빛을 얹는 재질들 (몸, 다리, 갈기). 얼룩말처럼 다리 재질이 따로인 말도 함께 빛난다 */
  glowMats: THREE.MeshToonMaterial[];
  /** 내가 이 말에 건 배팅 (이름표 위 표시). 없으면 빈 글자 */
  betMark: string;
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
  note: { text: string; by: string; byColor: string; hostile: boolean; until: number } | null;
  labelText: string;
  labelW: number;
  labelH: number;
  /** 아래 값들은 서버 상태가 올 때(pushState) 한 번 계산하고, 프레임에서는 읽기만 한다 */
  vis: Set<AugmentVisual>;
  fxText: string;
  /** 화면에 마지막으로 쓴 값 — 같으면 DOM을 건드리지 않는다 */
  labelShown: boolean;
  labelTf: string;
  dotPct: number;
  dotFollowed: boolean;
  /** 이름표 배치 계산용 (프레임마다 객체를 새로 만들지 않기 위해 여기에 둔다) */
  lsx: number;
  lsy: number;
  lscale: number;
  ldist: number;
  lbottom: number;
  dot: HTMLDivElement;
  displayPos: number;
  /** 당근 낚싯대: 머리에 단 낚싯대와 줄 끝의 당근 (처음 쓸 때 만든다) */
  rod: THREE.Group | null;
  rodLine: THREE.Group | null;
  /** 나란히 달리기: 짝 쪽으로 몸을 튼 각도 */
  pairTurn: number;
  /** 자석: 앞뒤로 늘어난 정도 */
  stretch: number;
  /** 어부바: 앞 말 등에 올라탄 정도(0~1)와 그 말의 레인 위치 */
  ride: number;
  rideZ: number;
  /** 결승선을 지난 뒤 멈출 때까지 더 달려 나간 거리 */
  coast: number;
  targetPos: number;
  speed: number;
  phase: number;
  bodyScale: number;
  facing: number;
  snap: HorseSnapshot | null;
}

interface Particle {
  x: number;
  y: number;
  z: number;
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
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.backdrop ? 1.5 : 2);
    this.renderer.setPixelRatio(this.pixelRatio);
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
    this.finishParts.push(finish);
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

    // 배경은 한 번 놓으면 움직이지 않는다. 위치 행렬을 지금 한 번만 계산해 두고 프레임마다 다시 계산하지 않게 한다
    this.scene.traverse((o) => {
      if (o === this.scene) return;
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    this.scene.updateMatrixWorld(true);
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
      this.finishParts.push(post);
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
      this.finishParts.push(banner);
    }
  }

  private buildFences(totalLen: number, midX: number): void {
    const white = new THREE.MeshToonMaterial({ color: 0xffffff });
    const spacing = 4;
    const count = Math.floor(totalLen / spacing);
    const posts = new THREE.InstancedMesh(GEO.cylLo, white, count * 2);
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
    const trunks = new THREE.InstancedMesh(GEO.cylLo, new THREE.MeshToonMaterial({ color: 0x8d6e4a }), treeCount);
    const leavesA = new THREE.InstancedMesh(GEO.coneLo, new THREE.MeshToonMaterial({ color: 0x2f9e44 }), treeCount);
    const leavesB = new THREE.InstancedMesh(GEO.coneLo, new THREE.MeshToonMaterial({ color: 0x40c057 }), treeCount);
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
    const bushes = new THREE.InstancedMesh(GEO.sphereLo, new THREE.MeshToonMaterial({ color: 0x37b24d }), bushCount);
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
    const crowd = new THREE.InstancedMesh(GEO.sphereLo, new THREE.MeshToonMaterial({ color: 0xffffff }), crowdCount);
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
    // 얼룩말과 젖소는 흰 바탕에 레인 색을 옅게 입혀, 같은 종류가 여럿 나와도 색으로 구분된다
    const tint = (c: number): THREE.Color =>
      customCoat
        ? customCoat.clone().lerp(new THREE.Color(0xffffff), 0.25)
        : c === 0xffffff
          ? lane.clone().lerp(new THREE.Color(0xffffff), 0.42)
          : new THREE.Color(c);
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
      legMat = new THREE.MeshToonMaterial({ color: tint(0xffffff) });
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
      const bub = new THREE.Mesh(GEO.sphereLo, bubbleMat);
      bub.position.set(Math.cos(a) * rr * 1.02, 1.15 + u * 0.58, Math.sin(a) * rr * 0.52);
      bub.scale.setScalar(0.13 + brand() * 0.07);
      // 방울은 몸에 붙은 자리에서 움직이지 않으므로 자리 계산은 한 번만 한다
      bub.updateMatrix();
      bub.matrixAutoUpdate = false;
      bubbles.add(bub);
    }
    // 방울 26개는 방어막이 있을 때만 몸에 붙인다. 숨겨 두기만 하면 보이지 않아도 매 프레임 위치를 계산한다
    bubbles.userData.home = torso;
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

    const rig: Rig = {
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
      glowMats: [...new Set([coat, legMat, dark])],
      betMark: '',
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
      labelText: LABEL_UNDRAWN, // 아직 한 번도 그리지 않았다는 표시 (빈 문자열은 '아이콘 없음'과 구분되지 않는다)
      labelW: 0,
      labelH: 0,
      vis: new Set(),
      fxText: '',
      labelShown: true,
      labelTf: '',
      dotPct: -1,
      dotFollowed: false,
      lsx: 0,
      lsy: 0,
      lscale: 1,
      ldist: 0,
      lbottom: 0,
      dot,
      displayPos: 0,
      rod: null,
      rodLine: null,
      pairTurn: 0,
      stretch: 0,
      ride: 0,
      rideZ: laneZ(info.id),
      coast: 0,
      targetPos: 0,
      speed: 0,
      phase: Math.random() * Math.PI * 2,
      bodyScale: 1,
      facing: 0,
      snap: null
    };
    mergeStaticParts(rig);
    return rig;
  }

  // ---------------- RaceView 구현 ----------------

  setupRace(infos: HorseInfo[]): void {
    this.clearHighlightRings();
    this.setFinishLine();
    for (const r of this.rigs) {
      this.scene.remove(r.root);
      disposeMerged(r);
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
      // 완주한 말은 서버가 마지막 속도를 그대로 보내므로 받지 않고, 화면에서 천천히 세운다
      if (!snap.finished) r.speed = snap.speed;
      r.snap = snap;
      // 걸려 있는 증강의 연출 종류와 이름표 아이콘은 상태가 바뀔 때만 다시 계산한다 (1초에 10번)
      r.vis.clear();
      for (const e of snap.effects) {
        const v = AUGMENT_BY_ID[e.defId]?.visual;
        if (e.quiet) {
          // 수치만 걸린 효과는 카드의 주인공이 아니라 "당하는 쪽"의 모습을 한다
          const side = v ? QUIET_VISUAL[v] : undefined;
          if (side) r.vis.add(side);
          continue;
        }
        if (v) r.vis.add(v);
      }
      r.fxText = labelFxText(snap, r.vis);
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
  showAugmentNote(ids: number[], text: string, by: string, hostile: boolean, byColor = '', seconds = 4.5): void {
    for (const id of ids) {
      const rig = this.rigs.find((v) => v.info.id === id);
      if (rig) rig.note = { text, by, byColor, hostile, until: this.elapsed + seconds };
    }
  }

  /** 결승선(바닥 체크무늬, 기둥, 현수막)과 지금 결승선 위치(코스 단위) */
  private finishParts: THREE.Object3D[] = [];
  private finishAt = COURSE_LENGTH;

  /**
   * 결승선을 옮긴다 ('결승선 당기기' 카드). 값이 없으면 원래 자리.
   * @returns 이번에 위치가 바뀌었으면 true
   */
  setFinishLine(units?: number): boolean {
    const next = units ?? COURSE_LENGTH;
    if (next === this.finishAt) return false;
    this.finishAt = next;
    // 결승문은 한 번에 옮기지 않고 스르륵 끌려오게 한다 (update에서 조금씩 옮긴다). 원래 자리로는 바로 돌린다
    this.finishShiftTarget = (next - COURSE_LENGTH) * UNIT;
    if (next === COURSE_LENGTH) this.slideFinish(1);
    const flag = this.minimap.querySelector<HTMLElement>('.r3d-minimap-flag');
    if (flag) {
      flag.style.right = 'auto';
      flag.style.left = next === COURSE_LENGTH ? 'calc(100% + 4px)' : `${(next / COURSE_LENGTH) * 100}%`;
    }
    return next !== COURSE_LENGTH;
  }

  /** 머리에 다는 낚싯대: 머리 위에서 앞으로 뻗은 장대, 그 끝에 늘어진 줄과 당근 */
  private buildCarrotRod(r: Rig): void {
    const rod = new THREE.Group();
    const wood = new THREE.MeshToonMaterial({ color: 0x9c6b3f });
    const tip: [number, number] = [3.0, 1.0];
    const base: [number, number] = [-0.1, 0.5];
    const len = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
    const stick = new THREE.Mesh(GEO.cylLo, wood);
    stick.scale.set(0.055, len, 0.055);
    stick.position.set((tip[0] + base[0]) / 2, (tip[1] + base[1]) / 2, 0);
    stick.rotation.z = Math.atan2(tip[1] - base[1], tip[0] - base[0]) - Math.PI / 2;
    rod.add(stick);
    // 머리띠: 낚싯대를 머리에 묶은 끈
    const band = new THREE.Mesh(GEO.cylLo, new THREE.MeshToonMaterial({ color: 0xe8453c }));
    band.scale.set(0.16, 0.16, 0.16);
    band.position.set(base[0], base[1], 0);
    rod.add(band);
    const line = new THREE.Group();
    line.position.set(tip[0], tip[1], 0);
    const string = new THREE.Mesh(GEO.cylLo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    string.scale.set(0.02, 0.85, 0.02);
    string.position.y = -0.425;
    line.add(string);
    const carrot = new THREE.Mesh(GEO.coneLo, new THREE.MeshToonMaterial({ color: 0xff8a1f }));
    carrot.scale.set(0.32, 1.05, 0.32);
    carrot.rotation.z = Math.PI; // 뾰족한 쪽이 아래로
    carrot.position.y = -0.85 - 0.525;
    line.add(carrot);
    const leaf = new THREE.Mesh(GEO.coneLo, new THREE.MeshToonMaterial({ color: 0x2f9e44 }));
    leaf.scale.set(0.26, 0.42, 0.26);
    leaf.position.y = -0.8;
    line.add(leaf);
    rod.add(line);
    r.head.add(rod);
    r.rod = rod;
    r.rodLine = line;
  }

  /** 결승문이 원래 자리에서 옮겨진 거리: 지금 값과 가야 할 값 */
  private finishShift = 0;
  private finishShiftTarget = 0;

  private slideFinish(k: number): void {
    const step = (this.finishShiftTarget - this.finishShift) * k;
    if (Math.abs(step) < 0.0005) return;
    this.finishShift += step;
    for (const o of this.finishParts) {
      o.position.x += step;
      // 배경은 행렬을 한 번만 계산해 두므로 옮긴 뒤 다시 계산한다
      o.updateMatrix();
      o.updateMatrixWorld(true);
    }
  }

  /** 내가 건 말의 이름표 위에 배팅 표시를 붙인다. marks: 말 번호 → 표시할 글자 */
  setBetMarks(marks: Record<number, string>): void {
    for (const r of this.rigs) {
      const mark = marks[r.info.id] ?? '';
      if (mark === r.betMark) continue;
      r.betMark = mark;
      r.dot.classList.toggle('mybet', mark !== '');
    }
  }

  /** 증강 카드에 마우스를 올렸을 때 그 카드가 맞힐 말들을 띄워 보인다 (몸이 옅은 노란빛으로 깜빡 + 이름표 강조) */
  private hlIds = new Set<number>();
  private hlKey = '';

  setHighlight(ids: number[], good = true): void {
    const key = ids.join(',') + (good ? 'g' : 'b');
    if (key === this.hlKey) return;
    this.hlKey = key;
    this.hlIds = new Set(ids);
    for (const r of this.rigs) {
      const on = this.hlIds.has(r.info.id);
      r.label.classList.toggle('hl', on);
      r.label.classList.toggle('hl-bad', on && !good);
      r.label.classList.toggle('dim', ids.length > 0 && !on);
      for (const m of r.glowMats) {
        m.emissive.setHex(on ? HIGHLIGHT_GLOW : 0x000000);
        if (!on) m.emissiveIntensity = 1;
      }
    }
  }

  private clearHighlightRings(): void {
    this.hlIds.clear();
    this.hlKey = '';
  }

  flashHorses(ids: number[], good: boolean): void {
    for (const id of ids) {
      const rig = this.rigs.find((v) => v.info.id === id);
      if (!rig) continue;
      const mesh = new THREE.Mesh(
        RING_GEO,
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

  /** 경주 화면의 CSS 크기. 크기가 바뀔 때만 다시 재고, 프레임에서는 이 값을 쓴다 (프레임마다 재면 강제 레이아웃이 생긴다) */
  private viewW = 1;
  private viewH = 1;
  /** 지금 쓰는 화소 배율. 프레임이 계속 낮으면 단계적으로 낮춘다 */
  private pixelRatio = 1;
  private perfFrames = 0;
  private perfTime = 0;
  private perfSlow = 0;

  /** 2초마다 프레임 수를 보고, 두 번 연속 40fps에 못 미치면 화소 배율을 한 단계 낮춘다 */
  private watchPerformance(rawDt: number): void {
    if (this.preview || this.pixelRatio <= 1) return;
    if (rawDt > 0.25) {
      // 탭이 가려졌다 돌아온 것이므로 이번 구간은 버린다
      this.perfFrames = 0;
      this.perfTime = 0;
      return;
    }
    this.perfFrames++;
    this.perfTime += rawDt;
    if (this.perfTime < 2) return;
    const fps = this.perfFrames / this.perfTime;
    this.perfFrames = 0;
    this.perfTime = 0;
    this.perfSlow = fps < 40 ? this.perfSlow + 1 : 0;
    if (this.perfSlow >= 2) {
      this.perfSlow = 0;
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.5);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }

  private resize(): void {
    if (this.backdrop) {
      const bw = Math.max(1, this.container.clientWidth);
      const bh = Math.max(1, this.container.clientHeight);
      this.viewW = bw;
      this.viewH = bh;
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
      this.viewW = pw;
      this.viewH = ph;
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
    else if (!portraitPhone) h = Math.min(h, Math.max(260, window.innerHeight - 236));
    this.viewW = w;
    this.viewH = h;
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
    this.watchPerformance(rawDt);
    this.update(dt, rawDt);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number, rawDt: number): void {
    if (this.finishShift !== this.finishShiftTarget) this.slideFinish(1 - Math.exp(-rawDt * 2.2));
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
    // 결승선을 지난 말은 조금 더 달려 나가며 속도를 줄여 멈춘다.
    // 먼저 들어온 말일수록 멀리 가서 서므로, 결승선 한 점에 몰려 서로 가리지 않는다
    if (snap?.finished) {
      const stopAt = 34 - (snap.rank - 1) * 5;
      const left = stopAt - r.coast;
      if (left > 0.05) {
        const step = left * (1 - Math.exp(-rawDt * 1.7));
        r.coast += step;
        r.speed = rawDt > 0 ? Math.min(22, step / rawDt) : 0;
      } else {
        r.speed = 0;
      }
      r.root.position.x = (r.displayPos + r.coast) * UNIT;
    }
    const anim: HorseAnim = snap?.anim ?? 'idle';
    const t = this.elapsed;
    const ease = (cur: number, target: number, rate: number): number =>
      cur + (target - cur) * Math.min(1, dt * rate);

    // 지금 걸려 있는 증강들의 연출 종류
    const vis = r.vis;
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
    // ---- 판을 흔드는 카드들의 연출 ----
    const whistle = vis.has('whistle'); // 한눈팔기
    const magnet = vis.has('magnet'); // 자석
    const pairing = vis.has('pair'); // 나란히 달리기
    const carrying = vis.has('carry'); // 어부바: 업은 쪽
    const cheering = vis.has('cheer'); // 치어리더 등장: 응원받는 꼴찌
    const annoyed = vis.has('annoyed'); // 치어리더 등장: 시끄러운 선두
    const carrot = vis.has('carrot'); // 당근 낚싯대
    const sulk = vis.has('sulk'); // 당근을 놓치고 허탈
    const sneezing = vis.has('sneeze'); // 재채기 릴레이
    const surpriseK = oneShot('surprise'); // 결승선 당기기: 다 같이 펄쩍
    // 재채기 한 번(0.95초): 고개를 천천히 젖혔다가(에… 에…) 확 숙이며 온몸이 튄다(취!)
    const sneezeK = sneezing ? (t * 1.05 + r.info.id * 0.37) % 1 : 0;
    const sneezeSnap = sneezing && sneezeK > 0.62 && sneezeK < 0.8 ? Math.sin(((sneezeK - 0.62) / 0.18) * Math.PI) : 0;
    // 한눈팔다 발을 헛디딘다 (1.4초에 한 번)
    const tripK = whistle ? (t * 0.72 + r.info.id * 0.2) % 1 : 0;
    const trip = whistle && tripK > 0.82 ? Math.sin(((tripK - 0.82) / 0.18) * Math.PI) : 0;
    // 에너지 드링크: 다리가 두 배로 빨리 돈다
    if (jitter) r.phase += dt * (2.5 + speedNorm * 13);
    r.dive = ease(r.dive, rocket ? 1 : 0, 7);
    // 한눈팔기: 고개를 옆(관중석 쪽)으로 돌린다
    r.lookBack = ease(r.lookBack, backpedal ? 1 : vis.has('whistle') ? 0.5 : 0, 9);
    r.droop = ease(r.droop, vis.has('droop') && !flying ? 1 : sulk ? 0.7 : 0, 5);
    const diveAng = -0.52 * r.dive; // 엉덩이를 들어 올린 각도

    // 변신 수치 (부드럽게 변하도록 보간)
    r.rear = ease(r.rear, vis.has('bipedal') ? 1 : 0, 7);
    r.legScale = ease(r.legScale, vis.has('pony') ? 0.55 : 1, 7);
    // 당근 낚싯대: 당근을 향해 목을 뺀다 / 자석: 코부터 끌려가느라 목이 늘어난다
    r.neckStretch = ease(r.neckStretch, vis.has('giraffe') ? 1 : carrot ? 0.5 + Math.sin(t * 9) * 0.08 : magnet ? 0.35 : 0, 6);
    r.inflate = ease(r.inflate, vis.has('balloon') ? 1 : 0, 5);
    r.flat = ease(r.flat, vis.has('paper') ? 1 : 0, 8);
    const theta = r.rear * 1.1; // 이족보행으로 몸을 세운 각도

    // 다리
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
        // 한 걸음(0~1) 안에서 이 다리의 위치. 뒷다리 둘 → 앞다리 둘 순서로 땅을 딛고, 마지막에 네 발이 다 뜬다
        const u = (((ph / TAU - GALLOP_OFFSETS[i]) % 1) + 1) % 1;
        // 다리가 움직이는 범위: 앞다리는 앞으로 더 뻗고, 뒷다리는 뒤로 더 민다
        // 앞다리를 너무 뻗으면 발이 가슴 앞으로 튀어나와 보이므로 앞쪽 범위는 작게 둔다
        const reach = front ? 0.46 : 0.58;
        const push = front ? -0.62 : -0.74;
        let swing: number;
        let bend: number;
        if (u < GALLOP_STANCE) {
          // 딛는 동안: 발이 땅에 붙은 채 일정한 속도로 뒤로 밀린다 (무릎은 거의 편다)
          const k = u / GALLOP_STANCE;
          swing = reach + (push - reach) * k;
          bend = -0.12 * Math.sin(Math.PI * k);
        } else {
          // 가져오는 동안: 발을 떼자마자 무릎을 접어 올렸다가 앞으로 뻗으며 편다
          const k = (u - GALLOP_STANCE) / (1 - GALLOP_STANCE);
          const e = k * k * (3 - 2 * k);
          swing = push + (reach - push) * e;
          bend = -1.25 * Math.sin(Math.PI * Math.pow(k, 0.72));
        }
        swing *= runAmt * stride;
        bend *= runAmt * stride;
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

    // 새 카드의 다리 동작 (기본 달리기 위에 덮어쓴다)
    if (!flipping && !sitting && !nap && anim !== 'fallen') {
      r.legs.forEach((leg, i) => {
        const knee = r.knees[i];
        const front = i < 2;
        if (surpriseK != null) {
          // 깜짝: 네 다리를 쫙 벌리고 뛴다
          leg.rotation.z = front ? 1.0 : -1.0;
          knee.rotation.z = -0.15;
        } else if (magnet) {
          // 자석: 다리가 뒤로 쓸려 질질 끌린다
          leg.rotation.z = -1.15 + Math.sin(t * 22 + i * 1.9) * 0.14;
          knee.rotation.z = -0.2 - Math.max(0, Math.sin(t * 17 + i)) * 0.25;
        } else if (r.ride > 0.4) {
          // 어부바(업힌 쪽): 다리를 축 늘어뜨리고, 앞다리 하나로 손을 흔든다
          // 다리로 업은 말의 몸통을 감싸듯 양옆으로 벌려 늘어뜨린다
          leg.rotation.z = (front ? 0.3 : -0.25) + Math.sin(t * 3 + i * 1.3) * 0.12;
          leg.rotation.x = (i % 2 === 0 ? 1 : -1) * -0.5;
          knee.rotation.z = -0.55;
          if (i === 0) {
            leg.rotation.z = 1.7 + Math.sin(t * 10) * 0.35;
            knee.rotation.z = -0.5;
          }
        } else if (carrying) {
          // 어부바(업은 쪽): 무릎이 굽은 채 후들거린다
          knee.rotation.z -= 0.45 + Math.sin(t * 31 + i * 2) * 0.08;
        } else if (pairing) {
          // 나란히 달리기: 하나 둘, 하나 둘 — 무릎을 높이 드는 발맞춤 행진
          const beat = Math.sin(t * 10 + (i === 0 || i === 3 ? 0 : Math.PI));
          leg.rotation.z = beat * 0.45 + (front ? 0.25 : -0.1);
          knee.rotation.z = -Math.max(0, beat) * 1.45;
        } else if (cheering && front) {
          // 치어리더 등장: 앞다리로 번갈아 주먹을 치켜든다
          leg.rotation.z = 1.25 + Math.sin(t * 15 + i * Math.PI) * 0.55;
          knee.rotation.z = -1.1 + Math.sin(t * 15 + i * Math.PI) * 0.4;
        } else if (sulk) {
          // 허탈: 다리에 힘이 풀린다
          leg.rotation.z = front ? 0.12 : -0.12;
          knee.rotation.z = -0.3;
        }
      });
    }

    // 몸통 출렁임과 기울기
    // 한 걸음에 한 번: 네 발이 뜨는 순간에 몸이 가장 높고, 뒷다리로 밀 때 앞이 들리고 앞다리로 디딜 때 숙여진다
    const stridePos = r.phase / TAU;
    let y = (0.5 + 0.5 * Math.cos(TAU * (stridePos - 0.86))) * 0.2 * runAmt;
    let pitch = Math.cos(TAU * (stridePos - 0.15)) * 0.075 * runAmt;
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
    // ---- 새 카드의 몸 동작 ----
    if (whistle) {
      // 한눈팔기: 어깨를 흔들며 걷다가 발을 헛디뎌 앞으로 고꾸라질 뻔한다
      roll += Math.sin(t * 5) * 0.09;
      pitch -= trip * 0.32;
      y -= trip * 0.12;
    }
    if (magnet) {
      // 자석: 코부터 끌려가느라 몸이 떠서 앞으로 쏠린다
      y = 0.75 + Math.sin(t * 26) * 0.05;
      pitch = -0.2 + Math.sin(t * 19) * 0.04;
    }
    if (pairing) {
      y = Math.abs(Math.sin(t * 10)) * 0.3;
      pitch = 0.06;
    }
    if (carrying) {
      // 업은 말: 등이 눌려 주저앉고 부들부들 떤다
      y = -0.42 + Math.sin(t * 29) * 0.03;
      pitch = -0.07;
      roll += Math.sin(t * 23) * 0.03;
    }
    if (r.ride > 0.4) {
      // 업힌 말: 등에 찰싹 엎드려 업은 말의 걸음에 맞춰 흔들린다
      y = Math.sin(t * 6) * 0.03;
      pitch = 0.1;
      roll += Math.sin(t * 3) * 0.05;
    }
    if (cheering) {
      y = Math.abs(Math.sin(t * 7.5)) * 0.75;
      pitch += 0.16;
    }
    if (sneezing) {
      // 에… 에… 하며 몸을 젖혔다가, 취! 하고 튀어 오르며 숙인다
      pitch += sneezeK < 0.62 ? (sneezeK / 0.62) * 0.16 : 0;
      pitch -= sneezeSnap * 0.4;
      y += sneezeSnap * 0.55;
    }
    if (carrot) {
      // 당근을 쫓아 몸을 앞으로 내던지듯 달린다
      pitch -= 0.1 + Math.abs(Math.sin(t * 8)) * 0.06;
    }
    if (sulk) {
      y = -0.2;
      pitch = -0.12;
    }
    if (surpriseK != null) {
      // 결승선 당기기: 다 같이 펄쩍
      y = Math.sin(Math.PI * surpriseK) * 1.6;
      pitch = 0.12;
    }
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
    // 자석에 끌려갈 때도 앞뒤로 쭉 늘어난다
    r.stretch = ease(r.stretch, magnet ? 0.28 : 0, 8);
    r.inner.scale.set(s * (1 + 1.3 * warp + r.stretch), s * (1 - 0.5 * warp - r.stretch * 0.35), s * (1 - 0.88 * r.flat)); // 종이 말은 옆으로 납작해진다

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
    // 어부바: 앞 말의 레인으로 건너가 등 위에 올라탄다
    const rideFx = vis.has('ride') ? snap?.effects.find((e) => e.link != null && !e.quiet && AUGMENT_BY_ID[e.defId]?.visual === 'ride') : undefined;
    const carrier = rideFx ? this.rigs.find((v) => v.info.id === rideFx.link) : undefined;
    r.ride = ease(r.ride, carrier ? 1 : 0, 6);
    if (carrier) r.rideZ = carrier.root.position.z;
    r.root.position.z = laneZ(r.info.id) + (r.rideZ - laneZ(r.info.id)) * r.ride;
    // 업은 말의 등 높이에 맞춘다: 업은 말이 주저앉은 만큼 같이 내려가고, 배가 등에 닿게 낮춘다
    const rideLift = r.ride * (1.42 * (carrier?.bodyScale ?? 1) + (carrier ? carrier.bobY : 0));
    r.inner.position.y = r.bobY - legDrop + rideLift + (py - rotY + diveY + cy * (1 - Math.cos(flipAng))) * s;
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
    // 나란히 달리기: 짝을 향해 몸을 살짝 틀고 눈을 맞춘다
    const mate = pairing ? snap?.effects.find((e) => e.link != null && AUGMENT_BY_ID[e.defId]?.visual === 'pair')?.link : undefined;
    const towardMate = mate != null ? Math.sign(r.info.id - mate) * 0.32 : 0;
    r.pairTurn = ease(r.pairTurn, towardMate, 6);
    r.root.rotation.y = r.facing + r.spin + r.pairTurn + (disco ? Math.sin(t * 6) * 0.7 : 0);

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
    if (whistle) headTarget = 0.18 + Math.sin(t * 5) * 0.1; // 턱을 들고 건들건들
    if (carrot) headTarget = -0.05 + Math.abs(Math.sin(t * 8 + 0.6)) * 0.42; // 흔들리는 당근을 향해 덥석덥석
    if (magnet) headTarget = 0.35; // 코가 앞으로 들린다
    if (pairing) headTarget = Math.sin(t * 10) * 0.16; // 박자에 맞춰 끄덕
    if (carrying) headTarget = -0.5 + Math.sin(t * 27) * 0.04;
    if (r.ride > 0.4) headTarget = 0.3;
    if (cheering) headTarget = 0.3 + Math.sin(t * 15) * 0.12;
    if (sneezing) headTarget = (sneezeK < 0.62 ? (sneezeK / 0.62) * 0.55 : 0) - sneezeSnap * 0.95;
    if (surpriseK != null) headTarget = 0.4;
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
    // 당근 낚싯대: 머리에 낚싯대가 달려 있어, 아무리 달려도 당근은 늘 코앞에서 달랑거린다
    if (carrot && !r.rod) this.buildCarrotRod(r);
    if (r.rod && r.rodLine) {
      r.rod.visible = carrot;
      if (carrot) {
        // 줄은 머리가 끄덕여도 아래로 늘어지고, 달리는 박자에 맞춰 앞뒤로 흔들린다
        r.rodLine.rotation.z = -r.head.rotation.z - 0.25 + Math.sin(t * 8) * 0.38;
        r.rodLine.rotation.x = Math.sin(t * 5.3) * 0.15;
      }
    }
    // 시끄러운 응원에 선두가 고개를 세차게 젓는다
    r.head.rotation.y = r.heliAng + r.lookBack * 2.75 + (annoyed ? Math.sin(t * 17) * 0.55 : 0);

    // 풍선: 몸통이 둥글게 부푼다
    r.body.scale.set(1.0 + 0.15 * r.inflate, 0.56 + 0.5 * r.inflate, 0.5 + 0.5 * r.inflate);

    // 꼬리는 속도가 붙을수록 뒤로 날린다
    r.tail.rotation.z = -runAmt * 0.65 + Math.sin(r.phase * 1.2) * 0.18 + (whistle || cheering ? Math.sin(t * 22) * 0.5 : 0); // 신나면 꼬리를 흔든다

    // 눈 (기절·졸림이면 감는다. 춤출 때는 뜬다)
    let eyeScale = 1;
    if (anim === 'stunned' && !awake) eyeScale = 0.12;
    else if (anim === 'tired' || anim === 'slow') eyeScale = 0.55;
    if (jitter) eyeScale = 1.55; // 카페인으로 눈이 번쩍
    if (lowbat) eyeScale = 0.28;
    if (whistle || carrot || cheering || surpriseK != null) eyeScale = 1.5; // 눈이 휘둥그레
    if (carrying || annoyed || sulk) eyeScale = 0.4; // 찡그린다
    if (sneezing) eyeScale = sneezeK > 0.5 && sneezeK < 0.85 ? 0.1 : 0.8; // 재채기 순간 질끈
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
    const shielded = (snap?.shield ?? 0) > 0;
    if (shielded !== (r.bubbles.parent !== null)) {
      if (shielded) (r.bubbles.userData.home as THREE.Object3D).add(r.bubbles);
      else r.bubbles.removeFromParent();
    }
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
      if (whistle) {
        // 한눈팔기: 눈과 얼굴 둘레에 하트가 다닥다닥 붙고, 휘파람 음표가 흘러나온다
        for (let n = 0; n < 2; n++) {
          if (Math.random() < dt * 16) {
            this.spawnEmoji(['❤️', '💕', '💗', '💘', '😍'][Math.floor(Math.random() * 5)], headX + 0.15 + rnd(0.75), headY + 0.25 + rnd(0.7), Z + 0.55 + rnd(0.5), 0.55 + Math.random() * 0.35, 0.35);
          }
        }
        pop(4, ['🎵', '🎶'], headX + 0.9, headY + 0.2, 0.7, 1.0);
      }
      if (magnet) pop(9, ['🧲', '⚡'], headX + 1.2 + rnd(0.5), headY + rnd(0.5), 0.85, 0.2); // 자석: 코앞에서 당긴다
      if (vis.has('pair')) pop(3, ['🤝', '👣'], X + rnd(0.8), 3.4 * s, 0.8, 0.6); // 나란히 달리기
      if (vis.has('ride')) pop(3, ['🙌', '😌'], headX, headY + 0.9, 0.75, 0.6); // 어부바
      if (vis.has('cheer')) pop(7, ['📣', '🎉', '👏'], X + rnd(2.2), 3.4 * s + rnd(1), 0.85); // 치어리더 등장
      if (vis.has('carrot')) pop(4, ['🤤', '💦'], headX + 0.2, headY + 0.5, 0.7, 0.7); // 당근 낚싯대: 군침
      if (sneezeSnap > 0.5) pop(40, ['💦', '💨', '🤧'], headX + 1.0 + Math.random() * 0.8, headY - 0.2 + rnd(0.5), 0.8, 0.2); // 취! 하는 순간에만 튄다
      if (carrying) pop(6, ['💦', '😵'], headX, headY + 0.8, 0.75, 0.7); // 업은 말: 진땀
      if (annoyed) pop(4, ['🙉', '💢'], headX, headY + 1.0, 0.8, 0.7); // 시끄러워!
      if (sulk) pop(3, ['😮‍💨', '🥕'], headX + 0.2, headY + 0.7, 0.75, 0.5); // 당근을 놓쳤다
      if (surpriseK != null) pop(14, ['❗', '❓', '🏁'], headX + rnd(0.6), headY + 1.1, 0.9, 0.9); // 결승선이 왜 저기에?
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

  /**
   * 먼지 알갱이는 최대 110개를 한 번의 그리기 명령으로 그린다 (알갱이마다 따로 그리면 명령이 100번 넘게 나간다).
   * 색은 알갱이마다 따로 줄 수 있고, 쓰지 않는 알갱이는 크기 0으로 둔다.
   */
  private dustMesh: THREE.InstancedMesh | null = null;
  private static readonly DUST_MAX = 110;

  private ensureDust(): THREE.InstancedMesh {
    if (this.dustMesh) return this.dustMesh;
    const mesh = new THREE.InstancedMesh(
      GEO.sphereLo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false }),
      Race3DView.DUST_MAX
    );
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    TMP_M.makeScale(0, 0, 0);
    for (let i = 0; i < Race3DView.DUST_MAX; i++) {
      mesh.setMatrixAt(i, TMP_M);
      mesh.setColorAt(i, this.dustMat.color);
      this.particles.push({ x: 0, y: 0, z: 0, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, size: 0.2 });
    }
    this.scene.add(mesh);
    this.dustMesh = mesh;
    return mesh;
  }

  private spawnDust(x: number, y: number, z: number, big: boolean, mat: THREE.Material): void {
    const mesh = this.ensureDust();
    const idx = this.particles.findIndex((q) => q.life <= 0);
    if (idx < 0) return;
    const p = this.particles[idx];
    mesh.setColorAt(idx, (mat as THREE.MeshBasicMaterial).color);
    mesh.instanceColor!.needsUpdate = true;
    p.maxLife = 0.55 + Math.random() * 0.3;
    p.life = p.maxLife;
    p.size = (big ? 0.34 : 0.22) + Math.random() * 0.12;
    p.vx = -1.5 - Math.random() * 1.5;
    p.vy = 0.9 + Math.random() * 0.8;
    p.vz = (Math.random() - 0.5) * 1.2;
    p.x = x;
    p.y = y;
    p.z = z;
  }

  private updateParticles(dt: number): void {
    const mesh = this.dustMesh;
    if (!mesh) return;
    let changed = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      changed = true;
      p.life -= dt;
      if (p.life <= 0) {
        TMP_M.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, TMP_M);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = p.life / p.maxLife;
      const sc = p.size * (0.4 + (1 - k) * 1.1) * Math.min(1, k * 3);
      TMP_M.makeScale(sc, sc, sc).setPosition(p.x, p.y, p.z);
      mesh.setMatrixAt(i, TMP_M);
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  private updateRings(dt: number): void {
    if (this.hlIds.size > 0) {
      // 어떤 털색에서도 눈에 띄도록 빛의 세기를 천천히 오르내린다
      const glow = 0.95 + Math.sin(this.elapsed * 6) * 0.4;
      for (const r of this.rigs) {
        if (!this.hlIds.has(r.info.id)) continue;
        for (const m of r.glowMats) m.emissiveIntensity = glow;
      }
    }
    this.rings = this.rings.filter((ring) => {
      ring.life -= dt;
      if (ring.life <= 0) {
        this.scene.remove(ring.mesh);
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
    const pos = TMP_A;
    const look = TMP_B;

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

  /** 이름표 내용을 다시 그린다 (내용이 바뀔 때만 불린다) */
  private renderLabel(r: Rig): void {
    r.label.textContent = '';
    if (r.note) {
      const nt = document.createElement('div');
      nt.className = `r3d-label-note${r.note.hostile ? ' hostile' : ''}`;
      nt.textContent = r.note.text;
      const who = document.createElement('small');
      if (r.note.byColor) {
        // 쓴 사람의 색 표식 — 등수표와 기록 칸의 표식과 같은 색
        const dot = document.createElement('i');
        dot.className = 'r3d-who-dot';
        dot.style.background = r.note.byColor;
        who.appendChild(dot);
      }
      who.appendChild(document.createTextNode(r.note.by));
      nt.appendChild(who);
      r.label.appendChild(nt);
    }
    if (r.fxText) {
      const f = document.createElement('div');
      f.className = 'r3d-label-fx';
      f.textContent = r.fxText;
      r.label.appendChild(f);
    }
    if (r.betMark) {
      // 내가 건 말: 노란 딱지 + 아래로 향한 꼬리
      const bet = document.createElement('div');
      bet.className = 'r3d-label-bet';
      bet.textContent = r.betMark;
      r.label.appendChild(bet);
    }
    // 순위는 화면 왼쪽 위 등수표에서 보여 주므로 이름표에는 넣지 않는다
    const n = document.createElement('div');
    n.className = 'r3d-label-name';
    n.style.borderColor = r.info.color;
    n.textContent = `${r.info.id}번 ${r.info.name}`;
    n.classList.toggle('mine', !!r.info.ownerId);
    r.label.appendChild(n);
    r.labelW = 0; // 다음 표시 때 크기를 다시 잰다
  }

  private labelOrder: Rig[] = [];

  private updateLabels(): void {
    const w = this.viewW;
    const h = this.viewH;
    const v = TMP_A;
    const followed = this.followedRig();
    const order = this.labelOrder;
    order.length = 0;

    for (const r of this.rigs) {
      // 라벨 내용 (바뀔 때만 DOM 갱신)
      if (r.note && this.elapsed > r.note.until) r.note = null;
      const text = `${r.betMark}|${r.note ? `${r.fxText}|${r.note.text}${r.note.by}` : r.fxText}`;
      if (text !== r.labelText) {
        r.labelText = text;
        this.renderLabel(r);
      }

      // 3D 위치 → 화면 좌표
      v.set(r.root.position.x + 0.3, (4.2 + 2.4 * r.neckStretch - 1.2 * r.rear) * r.bodyScale + r.inner.position.y, r.root.position.z);
      const dist = this.camera.position.distanceTo(v);
      v.project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      const visible = v.z < 1 && v.z > -1 && sx > -60 && sx < w + 60 && sy > -20 && sy < h + 40;
      if (visible !== r.labelShown) {
        r.labelShown = visible;
        r.label.style.display = visible ? '' : 'none';
      }
      if (visible) {
        if (r.labelW === 0) {
          r.labelW = r.label.offsetWidth || 110;
          r.labelH = r.label.offsetHeight || 24;
        }
        r.lsx = sx;
        r.lsy = sy;
        r.lscale = Math.max(0.7, Math.min(1.1, 24 / dist)); // 멀리 있는 말의 이름표도 읽을 수 있는 크기까지만 줄인다
        r.ldist = dist;
        order.push(r);
      }

      // 미니맵 점: 반 픽셀 넘게 움직였을 때만, 레이아웃을 다시 하지 않는 transform으로 옮긴다
      // (미니맵 너비는 CSS에서 화면의 68%)
      const px = Math.round((r.displayPos / COURSE_LENGTH) * w * MINIMAP_WIDTH_RATIO * 2) / 2;
      if (px !== r.dotPct) {
        r.dotPct = px;
        r.dot.style.transform = `translateX(${px}px)`;
      }
      const isFollowed = r === followed;
      if (isFollowed !== r.dotFollowed) {
        r.dotFollowed = isFollowed;
        r.dot.classList.toggle('followed', isFollowed);
      }
    }

    // 겹침 해소: 카메라에 가까운 말의 이름표를 먼저 놓고, 겹치는 것은 위로 밀어 올린다
    order.sort(byLabelDist);
    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      const lw = p.labelW * p.lscale;
      const lh = p.labelH * p.lscale;
      let bottom = p.lsy;
      for (let pass = 0; pass < 6; pass++) {
        let hit: Rig | null = null;
        for (let k = 0; k < i; k++) {
          const o = order[k];
          const ow = o.labelW * o.lscale;
          const oh = o.labelH * o.lscale;
          if (Math.abs(o.lsx - p.lsx) < (ow + lw) / 2 + 4 && bottom > o.lbottom - oh - 2 && bottom - lh < o.lbottom + 2) {
            hit = o;
            break;
          }
        }
        if (!hit) break;
        bottom = hit.lbottom - hit.labelH * hit.lscale - 3;
      }
      p.lbottom = bottom;
      const tf = `translate(${p.lsx.toFixed(1)}px, ${bottom.toFixed(1)}px) translate(-50%, -100%) scale(${p.lscale.toFixed(2)})`;
      if (tf !== p.labelTf) {
        p.labelTf = tf;
        p.label.style.transform = tf;
      }
    }
  }
}

// ---------------- 프레임마다 다시 쓰는 것들 ----------------

/** .r3d-minimap의 left 16% + right 16%를 뺀 너비 비율 */
const MINIMAP_WIDTH_RATIO = 0.68;
/** 이름표를 아직 한 번도 그리지 않았다는 표시 */
const LABEL_UNDRAWN = '(undrawn)';
const TMP_A = new THREE.Vector3();
const TMP_M = new THREE.Matrix4();
const TMP_B = new THREE.Vector3();
/** 증강을 맞았을 때 번쩍이는 고리 — 모양은 하나만 만들어 함께 쓴다 */
const RING_GEO = new THREE.TorusGeometry(1.3, 0.13, 8, 32);
const TAU = Math.PI * 2;
/** 수치만 걸린(quiet) 효과가 보여 줄 모습: 업은 말, 응원이 시끄러운 선두, 당근을 놓친 말 */
const QUIET_VISUAL: Partial<Record<AugmentVisual, AugmentVisual>> = { ride: 'carry', cheer: 'annoyed', carrot: 'sulk' };
/** 갤럽에서 다리별로 땅을 딛기 시작하는 때 (한 걸음 = 1). 앞다리 둘, 뒷다리 둘 순서로 적는다 */
const GALLOP_OFFSETS = [0.3, 0.42, 0, 0.1];
/** 한 걸음 중 발이 땅에 닿아 있는 비율 */
const GALLOP_STANCE = 0.3;
/** 강조된 말의 몸에 얹는 옅은 노란빛 */
const HIGHLIGHT_GLOW = 0xfff0a0;
const byLabelDist = (a: Rig, b: Rig): number => a.ldist - b.ldist;

/** 이름표에 붙는 상태 아이콘 (방어막, 기절, 지침, 걸린 증강 등). 겹치는 것은 한 번만, 5개까지 */
function labelFxText(snap: HorseSnapshot, vis: Set<AugmentVisual>): string {
  const fx: string[] = [];
  const add = (e: string): void => {
    if (fx.length < 5 && !fx.includes(e)) fx.push(e);
  };
  if (snap.shield > 0) add('🛡️');
  // 춤추거나 포즈를 잡거나 먹느라 멈춘 말은 자는 표시를 붙이지 않는다
  const awake = vis.has('disco') || vis.has('pose') || vis.has('eat');
  if (snap.anim === 'stunned' && !awake) add('💤');
  if (snap.anim === 'tired') add('💦');
  if (snap.anim === 'fallen') add('💫');
  if (snap.anim === 'finished') add('🏁');
  for (const e of snap.effects) add(e.emoji);
  return fx.join('');
}

// ---------------- 말 부품 합치기 ----------------

/** Rig가 직접 가리키는 3D 물체들 — 애니메이션이 건드리는 것이므로 합치지 않고 그대로 둔다 */
function animatedObjects(rig: Rig): Set<THREE.Object3D> {
  const keep = new Set<THREE.Object3D>();
  const visit = (v: unknown, depth: number): void => {
    if (v instanceof THREE.Object3D) keep.add(v);
    else if (depth < 2 && Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
    else if (depth < 2 && v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype)
      Object.values(v).forEach((x) => visit(x, depth + 1));
  };
  Object.values(rig).forEach((v) => visit(v, 0));
  return keep;
}

/**
 * 말 한 마리는 작은 부품 100개쯤으로 조립되고, 부품마다 그리기 명령이 한 번씩 나간다.
 * 같은 묶음(머리, 다리 한 짝 등) 안에서 따로 움직이지 않는 부품은 재질별로 한 덩어리로 합쳐
 * 그리기 명령 수를 줄인다. 모양과 움직임은 그대로다.
 */
function mergeStaticParts(rig: Rig): void {
  const keep = animatedObjects(rig);
  const isLeaf = (o: THREE.Object3D): o is THREE.Mesh =>
    o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o.children.length === 0 && !keep.has(o) && o.visible;
  const groups: THREE.Object3D[] = [];
  rig.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) groups.push(o);
  });
  const m = new THREE.Matrix4();
  for (const g of groups) {
    // 합칠 수 있는 부품: 보이는 메시이고, 딸린 것이 있다면 외곽선 같은 단순 메시뿐인 것
    const parts = g.children.filter(
      (c): c is THREE.Mesh =>
        c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh) && c.visible && !keep.has(c) && c.children.every(isLeaf)
    );
    if (parts.length === 0) continue;
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const push = (mesh: THREE.Mesh, matrix: THREE.Matrix4): void => {
      if (Array.isArray(mesh.material)) return;
      const geo = mesh.geometry.clone().applyMatrix4(matrix);
      // 좌우를 뒤집어 붙인 부품은 면의 앞뒤가 바뀌므로 다시 돌려 놓는다
      if (matrix.determinant() < 0 && geo.index) {
        const idx = geo.index.array;
        for (let i = 0; i < idx.length; i += 3) {
          const t = idx[i];
          idx[i] = idx[i + 2];
          idx[i + 2] = t;
        }
      }
      let list = byMat.get(mesh.material);
      if (!list) byMat.set(mesh.material, (list = []));
      list.push(geo);
    };
    let count = 0;
    for (const c of parts) {
      c.updateMatrix();
      push(c, c.matrix);
      count++;
      for (const o of c.children as THREE.Mesh[]) {
        o.updateMatrix();
        push(o, m.multiplyMatrices(c.matrix, o.matrix));
        count++;
      }
    }
    // 합쳐도 줄어드는 것이 없으면 그대로 둔다
    if (count <= byMat.size) {
      for (const list of byMat.values()) list.forEach((x) => x.dispose());
      continue;
    }
    for (const c of parts) g.remove(c);
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.userData.merged = true;
      mesh.matrixAutoUpdate = false;
      g.add(mesh);
    }
  }
}

/** 합쳐서 만든 도형은 이 말만의 것이므로 말을 치울 때 함께 버린다 */
function disposeMerged(rig: Rig): void {
  rig.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.merged) o.geometry.dispose();
  });
}

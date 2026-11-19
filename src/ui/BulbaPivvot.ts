import { isTouch } from "./TouchControls";
import { screenToStage, stage } from "./orientation";

// Логическое поле игры (px). Канвас масштабируется под экран через CSS.
const W = 480;
const H = 720;
const CX = W / 2;

// Ядро, вокруг которого вращается бульба, и радиус её орбиты.
const PIVOT_Y = 468;
const ORBIT_R = 100;
const BALL_R = 14;

// Линия трассы заметно извивается, как трасса в Pivvot. Бортов нет — только
// сама линия; шипы крепятся к ней на расстоянии вылета.
const SPIKE_ANCHOR = 126;
const SWAY_AMP = 34;
const SWAY_LEN = 760;
const SWAY_K = (Math.PI * 2) / SWAY_LEN;
const SWAY_PHASE = 0.6;

const SPIKE_BASE = 48;
const SPIKE_DEPTH = SPIKE_ANCHOR; // остриё одиночного шипа касается центра линии
const SPIKE_DEPTH_DOUBLE = 80;    // двойной шип оставляет щель по центру

// Вращающаяся пила — круг с лучами. Нужно проскочить между лучами.
const SAW_RADIUS = 72;
const SAW_BLADES = 3;
const SAW_SPIN = 1.9;

// Круг-препятствие: вокруг него трасса делает полную окружность,
// а точка вращения проезжает по этой окружности.
const CIRCLE_RADIUS = 54;
const CIRCLE_CLEARANCE = 30;
const CIRCLE_DETOUR_OFFSET = CIRCLE_RADIUS + CIRCLE_CLEARANCE;
const CIRCLE_LOOP_MS = 1800;
const CIRCLE_LOOP_GRACE_MS = 450;
const CIRCLE_PAIR_CHANCE = 0.35;
const CIRCLE_PAIR_SPACING = CIRCLE_DETOUR_OFFSET * 2.4;

const START_SPEED = 350;      // px/s
const SPEED_GROWTH = 2.6;     // прирост скорости за секунду
const MAX_SPEED = 560;

const GATE_START_MS = 1500;   // интервал между препятствиями
const GATE_MIN_MS = 760;
const GATE_DECAY = 8.5;       // мс за секунду
const START_GRACE_MS = 1000;  // пауза до первого препятствия
const SPAWN_AHEAD = 880;      // на каком расстоянии рождаются препятствия

const CIRCLE_FROM_MS = 12_000;
const SAW_FROM_MS = 24_000;
const SPECIAL_COOLDOWN_MS = 3400;
const SPECIAL_MIN_GAP_MS = 1250;

const ROT_BASE = 4.5;         // рад/с
const ROT_GROWTH = 0.006;
const ROT_MAX = 5.0;

const MILESTONE_MS = 15_000;
const BEST_KEY = "bulba-pivvot-best";
const TRAIL_MAX = 18;

type Phase = "ready" | "running" | "over";
type Side = -1 | 1;
type PointerSide = "left" | "right";

interface Spike {
  kind: "spike";
  s: number;      // мировая координата вдоль линии
  side: Side;     // -1 — слева, 1 — справа
  depth: number;  // насколько глубоко шип входит за линию
}

interface Saw {
  kind: "saw";
  s: number;      // центр пилы
  radius: number;
  blades: number;
  spin: number;   // рад/с
  phase: number;
}

interface CircleObstacle {
  kind: "circle";
  s: number;
  baseX: number;   // центр круга на базовой линии
  radius: number;
  detour: Side;    // с какой стороны трасса обходит круг
}

type Obstacle = Spike | Saw | CircleObstacle;

interface Pt {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  vrot: number;
  color: string;
}

interface Mote {
  x: number;
  y: number;
  r: number;
  a: number;
  v: number;
  phase: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} с`;
}

function readBest(): number {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

function writeBest(value: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // localStorage может быть недоступен — рекорд просто не сохранится.
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Точка внутри треугольника / расстояние до его сторон: коллизия «шарик — шип».
function pointInTriangle(px: number, py: number, a: Pt, b: Pt, c: Pt): boolean {
  const d1 = (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y);
  const d2 = (px - c.x) * (b.y - c.y) - (b.x - c.x) * (py - c.y);
  const d3 = (px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return Math.hypot(px - x, py - y);
}

function circleHitsTriangle(cx: number, cy: number, r: number, a: Pt, b: Pt, c: Pt): boolean {
  if (pointInTriangle(cx, cy, a, b, c)) return true;
  if (segDist(cx, cy, a, b) <= r) return true;
  if (segDist(cx, cy, b, c) <= r) return true;
  if (segDist(cx, cy, c, a) <= r) return true;
  return false;
}

// Bulba Pivvot — упрощённый Pivvot: бульба на тросе вращается вокруг ядра,
// дорожка с шипами едет навстречу. Один режим: продержаться как можно дольше.
export class BulbaPivvot {
  isOpen = false;
  onClose: (() => void) | null = null;
  onGameOver: ((value: number) => void) | null = null;
  onLeaderboard: (() => void) | null = null;

  private root = document.getElementById("bulbapivvot")!;
  private canvas = document.getElementById("bpvCanvas") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;
  private statusEl = document.getElementById("bpvStatus")!;

  private phase: Phase = "ready";
  private elapsed = 0;         // мс текущей попытки
  private traveled = 0;        // сколько px проехала дорожка
  private angle = 0;           // угол бульбы вокруг ядра: 0 — вперёд
  private clock = 0;           // общее время для анимаций

  private leftKey = false;
  private rightKey = false;
  private pointers = new Map<number, PointerSide>();
  private touchLeft = 0;
  private touchRight = 0;

  private obstacles: Obstacle[] = [];
  private gateTimer = 0;
  private specialCooldown = 0;
  private lastSide: Side = 1;

  private loopCircle: CircleObstacle | null = null;
  private loopT = 0;
  private loopCenter: Pt = { x: 0, y: 0 };
  private loopGrace = 0;
  private passedCircles: CircleObstacle[] = [];

  private trail: Pt[] = [];
  private particles: Particle[] = [];
  private motes: Mote[] = [];

  private best = 0;
  private newRecord = false;
  private reported = false;
  private deathT = 0;
  private deathPos: Pt | null = null;
  private shake = 0;
  private flash = 0;

  private milestone = 0;
  private milestoneFlash = 0;
  private nextMilestone = MILESTONE_MS;

  private lastStatus = "";
  private statusClock = 0;
  private lastT = 0;
  private raf = 0;
  private readonly touch = isTouch();

  constructor() {
    document.getElementById("bpvClose")!.onclick = () => this.close();
    document.getElementById("bpvLb")!.onclick = () => this.onLeaderboard?.();

    this.best = readBest();
    this.makeMotes();

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("lostpointercapture", this.onPointerUp);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  open(): void {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.best = readBest();
    this.showReady();
    this.lastT = performance.now();
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.clearPointers();
    this.root.classList.add("hidden");
    this.onClose?.();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Escape") {
      this.close();
      return;
    }
    const left = e.code === "ArrowLeft" || e.code === "KeyA";
    const right = e.code === "ArrowRight" || e.code === "KeyD";
    if (left || right) {
      e.preventDefault();
      if (left) this.leftKey = true;
      else this.rightKey = true;
      if (this.phase !== "running") this.startRun();
      return;
    }
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      if (this.phase !== "running") this.startRun();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") this.leftKey = false;
    else if (e.code === "ArrowRight" || e.code === "KeyD") this.rightKey = false;
  };

  private onBlur = (): void => {
    this.leftKey = false;
    this.rightKey = false;
    this.clearPointers();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.isOpen) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Некоторые браузеры не дают захват — просто продолжаем без него.
    }
    const side: PointerSide = this.pointerX(e) < W / 2 ? "left" : "right";
    this.pointers.set(e.pointerId, side);
    this.syncPointers();
    if (this.phase !== "running") this.startRun();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.syncPointers();
  };

  // Экранная точка → логическая X канваса. Учитывает поворот #stage на 90°.
  private pointerX(e: PointerEvent): number {
    const r = this.canvas.getBoundingClientRect();
    const local = screenToStage(
      e.clientX - (r.left + r.width / 2),
      e.clientY - (r.top + r.height / 2),
    );
    const dispW = this.canvas.clientWidth || (stage.rotated ? r.height : r.width);
    if (dispW <= 0) return W / 2;
    return (local.x / dispW) * W + W / 2;
  }

  private syncPointers(): void {
    let left = 0;
    let right = 0;
    for (const side of this.pointers.values()) {
      if (side === "left") left += 1;
      else right += 1;
    }
    this.touchLeft = left;
    this.touchRight = right;
  }

  private clearPointers(): void {
    this.pointers.clear();
    this.touchLeft = 0;
    this.touchRight = 0;
  }

  private dir(): number {
    const left = this.leftKey || this.touchLeft > 0;
    const right = this.rightKey || this.touchRight > 0;
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  private showReady(): void {
    this.phase = "ready";
    this.elapsed = 0;
    this.traveled = 0;
    this.angle = 0;
    this.clock = 0;
    this.leftKey = false;
    this.rightKey = false;
    this.clearPointers();
    this.trail = [];
    this.particles = [];
    this.deathT = 0;
    this.deathPos = null;
    this.shake = 0;
    this.flash = 0;
    this.newRecord = false;
    this.reported = false;
    this.milestone = 0;
    this.milestoneFlash = 0;
    this.nextMilestone = MILESTONE_MS;
    this.lastStatus = "";
    this.loopCircle = null;
    this.loopT = 0;
    this.loopGrace = 0;
    this.passedCircles = [];
    // Пара декоративных шипов, чтобы на стартовом экране было видно, чего ждать.
    this.obstacles = [
      { kind: "spike", s: 300, side: -1, depth: SPIKE_DEPTH },
      { kind: "spike", s: 450, side: 1, depth: SPIKE_DEPTH },
    ];
    this.specialCooldown = 0;
    this.updateStatus(true);
  }

  private startRun(): void {
    if (!this.isOpen) return;
    this.phase = "running";
    this.elapsed = 0;
    this.traveled = 0;
    this.angle = 0;
    this.trail = [];
    this.particles = [];
    this.obstacles = [];
    this.gateTimer = START_GRACE_MS;
    this.specialCooldown = 0;
    this.lastSide = 1;
    this.deathT = 0;
    this.deathPos = null;
    this.shake = 0;
    this.flash = 0;
    this.newRecord = false;
    this.reported = false;
    this.milestone = 0;
    this.milestoneFlash = 0;
    this.nextMilestone = MILESTONE_MS;
    this.statusClock = 0;
    this.lastStatus = "";
    this.loopCircle = null;
    this.loopT = 0;
    this.loopGrace = 0;
    this.passedCircles = [];
    this.updateStatus(true);
    this.lastT = performance.now();
  }

  private loop = (): void => {
    if (!this.isOpen) return;
    const now = performance.now();
    const dt = Math.min(now - this.lastT, 50); // защита от больших скачков
    this.lastT = now;
    this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    this.clock += dt;
    this.updateMotes(dt);

    if (this.phase === "running") {
      if (this.loopCircle) this.updateLoop(dt);
      else this.updateRunning(dt);
    } else if (this.phase === "over") {
      this.updateOver(dt);
    } else {
      // На стартовом экране бульба лениво покачивается вокруг ядра.
      this.angle = Math.sin(this.clock / 700) * 0.32;
    }

    if (this.milestoneFlash > 0) {
      this.milestoneFlash = Math.max(0, this.milestoneFlash - dt / 900);
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt / 200);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt / 420);
  }

  private updateRunning(dt: number): void {
    this.elapsed += dt;
    const sec = this.elapsed / 1000;
    const speed = Math.min(MAX_SPEED, START_SPEED + sec * SPEED_GROWTH);
    this.traveled += (speed * dt) / 1000;
    this.specialCooldown = Math.max(0, this.specialCooldown - dt);

    const rot = Math.min(ROT_MAX, ROT_BASE + sec * ROT_GROWTH);
    this.angle += (this.dir() * rot * dt) / 1000;

    const ball = this.ballPos();
    this.pushTrail(ball);

    this.gateTimer -= dt;
    if (this.gateTimer <= 0) {
      const special = this.spawnObstacle();
      this.gateTimer = this.gateInterval();
      // После пилы/круга даём чуть больше воздуха перед следующим шипом.
      if (special) this.gateTimer = Math.max(this.gateTimer, SPECIAL_MIN_GAP_MS);
    }

    const circle = this.obstacles.find(
      (o): o is CircleObstacle => o.kind === "circle" && o.s - this.traveled <= 0,
    );
    if (circle) {
      this.startLoop(circle);
      return;
    }

    for (const obstacle of this.obstacles) {
      if (this.obstacleHitsBall(obstacle, ball)) {
        this.die();
        return;
      }
    }

    const passed = this.traveled - (H - PIVOT_Y) - 160;
    this.obstacles = this.obstacles.filter((o) => this.obstacleEndS(o) > passed);
    this.passedCircles = this.passedCircles.filter(
      (c) => this.screenY(c.s) < H + CIRCLE_DETOUR_OFFSET + 120,
    );

    if (this.elapsed >= this.nextMilestone) {
      this.milestone = this.nextMilestone / 1000;
      this.nextMilestone += MILESTONE_MS;
      this.milestoneFlash = 1;
    }

    this.statusClock += dt;
    if (this.statusClock >= 100) {
      this.statusClock = 0;
      this.updateStatus();
    }
  }

  private updateLoop(dt: number): void {
    this.elapsed += dt;
    const sec = this.elapsed / 1000;
    const rot = Math.min(ROT_MAX, ROT_BASE + sec * ROT_GROWTH);
    this.angle += (this.dir() * rot * dt) / 1000;

    this.loopT = Math.min(1, this.loopT + dt / CIRCLE_LOOP_MS);
    this.loopGrace = Math.max(0, this.loopGrace - dt);

    const ball = this.ballPos();
    this.pushTrail(ball);

    if (this.loopCircle && this.loopGrace <= 0) {
      const dist = Math.hypot(ball.x - this.loopCenter.x, ball.y - this.loopCenter.y);
      if (dist <= this.loopCircle.radius + BALL_R * 0.9) {
        this.die();
        return;
      }
    }

    if (this.elapsed >= this.nextMilestone) {
      this.milestone = this.nextMilestone / 1000;
      this.nextMilestone += MILESTONE_MS;
      this.milestoneFlash = 1;
    }

    this.statusClock += dt;
    if (this.statusClock >= 100) {
      this.statusClock = 0;
      this.updateStatus();
    }

    if (this.loopT >= 1) {
      if (this.loopCircle) this.passedCircles.push(this.loopCircle);
      this.loopCircle = null;
      this.loopT = 0;
      this.loopGrace = 0;
    }
  }

  private startLoop(circle: CircleObstacle): void {
    this.obstacles = this.obstacles.filter((o) => o !== circle);
    this.loopCircle = circle;
    this.loopT = 0;
    this.loopGrace = CIRCLE_LOOP_GRACE_MS;
    this.loopCenter = { x: circle.baseX, y: PIVOT_Y };
  }

  private updateOver(dt: number): void {
    this.deathT += dt;
    for (const p of this.particles) {
      p.vy += (900 * dt) / 1000;
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
      p.rot += (p.vrot * dt) / 1000;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private gateInterval(): number {
    return Math.max(GATE_MIN_MS, GATE_START_MS - (this.elapsed / 1000) * GATE_DECAY);
  }

  private spawnObstacle(): boolean {
    const sec = this.elapsed / 1000;
    const s = this.traveled + SPAWN_AHEAD;

    if (this.specialCooldown <= 0) {
      if (sec > SAW_FROM_MS / 1000 && Math.random() < 0.16) {
        this.obstacles.push({
          kind: "saw",
          s,
          radius: SAW_RADIUS,
          blades: SAW_BLADES,
          spin: SAW_SPIN * (Math.random() < 0.5 ? -1 : 1),
          phase: Math.random() * Math.PI * 2,
        });
        this.specialCooldown = SPECIAL_COOLDOWN_MS;
        return true;
      }
      if (sec > CIRCLE_FROM_MS / 1000 && Math.random() < 0.18) {
        const detour: Side = Math.random() < 0.5 ? -1 : 1;
        const addCircle = (cs: number, side: Side): void => {
          this.obstacles.push({
            kind: "circle",
            s: cs,
            // Центр круга чуть в стороне от линии: трасса огибает его по окружности.
            baseX: this.baseRoadX(cs) + side * CIRCLE_DETOUR_OFFSET,
            radius: CIRCLE_RADIUS,
            detour: side,
          });
        };
        addCircle(s, detour);
        // Иногда — пара кругов подряд: сначала обход с одной стороны, затем с другой.
        if (Math.random() < CIRCLE_PAIR_CHANCE) {
          addCircle(s + CIRCLE_PAIR_SPACING, detour === 1 ? -1 : 1);
        }
        this.specialCooldown = SPECIAL_COOLDOWN_MS;
        return true;
      }
    }

    // Иногда — двойные шипы с узкой щелью по центру: нужно проскочить ядром.
    if (sec > 24 && Math.random() < 0.17) {
      this.obstacles.push(
        { kind: "spike", s, side: -1, depth: SPIKE_DEPTH_DOUBLE },
        { kind: "spike", s, side: 1, depth: SPIKE_DEPTH_DOUBLE },
      );
      this.lastSide = Math.random() < 0.5 ? -1 : 1;
      return false;
    }

    const side: Side = this.lastSide === 1 ? -1 : 1;
    this.obstacles.push({ kind: "spike", s, side, depth: SPIKE_DEPTH });
    this.lastSide = side;
    return false;
  }

  private obstacleEndS(obstacle: Obstacle): number {
    return obstacle.s;
  }

  private die(): void {
    if (this.phase !== "running") return;
    this.phase = "over";
    this.deathT = 0;
    this.deathPos = this.ballPos();
    this.shake = 1;
    this.flash = 1;
    this.spawnBurst(this.deathPos);

    const value = Math.max(1, Math.round(this.elapsed));
    if (value > this.best) {
      this.best = value;
      this.newRecord = true;
      writeBest(value);
    }
    this.finish(value);
    this.updateStatus(true);
  }

  private finish(value: number): void {
    if (this.reported) return;
    this.reported = true;
    this.onGameOver?.(value);
  }

  private spawnBurst(at: Pt): void {
    const colors = ["#7ac07a", "#d7f5c4", "#e8efe6", "#f2a65a", "#d64545"];
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 270;
      const life = 450 + Math.random() * 550;
      this.particles.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 60,
        life,
        maxLife: life,
        size: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 10,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  private pushTrail(p: Pt): void {
    this.trail.push(p);
    if (this.trail.length > TRAIL_MAX) this.trail.shift();
  }

  private makeMotes(): void {
    this.motes = [];
    for (let i = 0; i < 38; i++) {
      this.motes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.7 + Math.random() * 1.8,
        a: 0.05 + Math.random() * 0.16,
        v: 0.3 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private updateMotes(dt: number): void {
    const speed = this.phase === "running"
      ? Math.min(MAX_SPEED, START_SPEED + (this.elapsed / 1000) * SPEED_GROWTH) / START_SPEED
      : 1;
    for (const m of this.motes) {
      m.y += m.v * speed * (dt / 1000) * 26;
      m.x += Math.sin(this.clock / 1100 + m.phase) * 0.06;
      if (m.y > H + 6) {
        m.y = -6;
        m.x = Math.random() * W;
      }
    }
  }

  private pivotPos(): Pt {
    if (this.loopCircle) {
      const a0 = this.loopCircle.detour === 1 ? Math.PI : 0;
      const a = a0 - this.loopT * Math.PI * 2 * this.loopCircle.detour;
      return {
        x: this.loopCenter.x + Math.cos(a) * CIRCLE_DETOUR_OFFSET,
        y: this.loopCenter.y + Math.sin(a) * CIRCLE_DETOUR_OFFSET,
      };
    }
    return { x: this.roadX(this.traveled), y: PIVOT_Y };
  }

  private ballPos(): Pt {
    const p = this.pivotPos();
    return {
      x: p.x + Math.sin(this.angle) * ORBIT_R,
      y: p.y - Math.cos(this.angle) * ORBIT_R,
    };
  }

  private baseRoadX(s: number): number {
    return CX + SWAY_AMP * Math.sin(s * SWAY_K + SWAY_PHASE);
  }

  // Базовая линия плюс плавные обходы вокруг кругов-препятствий.
  private roadX(s: number): number {
    return this.baseRoadX(s);
  }

  private roadFrame(s: number): { fx: number; fy: number; lx: number; ly: number } {
    const step = 0.75;
    const slope = clamp(
      (this.roadX(s + step) - this.roadX(s - step)) / (2 * step),
      -2.2,
      2.2,
    );
    const inv = 1 / Math.hypot(slope, 1);
    const fx = slope * inv;
    const fy = -inv;
    return { fx, fy, lx: fy, ly: -fx };
  }

  private screenY(s: number): number {
    return PIVOT_Y + this.traveled - s;
  }

  private spikeGeometry(spike: Spike): { a: Pt; b: Pt; c: Pt; base: Pt } {
    const x = this.roadX(spike.s);
    const y = this.screenY(spike.s);
    const f = this.roadFrame(spike.s);
    const baseC: Pt = {
      x: x - spike.side * SPIKE_ANCHOR * f.lx,
      y: y - spike.side * SPIKE_ANCHOR * f.ly,
    };
    const inwardX = spike.side * f.lx;
    const inwardY = spike.side * f.ly;
    return {
      a: { x: baseC.x + f.fx * (SPIKE_BASE / 2), y: baseC.y + f.fy * (SPIKE_BASE / 2) },
      b: { x: baseC.x - f.fx * (SPIKE_BASE / 2), y: baseC.y - f.fy * (SPIKE_BASE / 2) },
      c: { x: baseC.x + inwardX * spike.depth, y: baseC.y + inwardY * spike.depth },
      base: baseC,
    };
  }

  private spikeHitsBall(spike: Spike, ball: Pt): boolean {
    const g = this.spikeGeometry(spike);
    if (g.c.y < -140 || g.c.y > H + 140) return false;
    return circleHitsTriangle(ball.x, ball.y, BALL_R * 0.88, g.a, g.b, g.c);
  }

  private sawHitsBall(saw: Saw, ball: Pt): boolean {
    const cx = this.roadX(saw.s);
    const cy = this.screenY(saw.s);
    if (cy < -saw.radius - 80 || cy > H + saw.radius + 80) return false;

    const spin = (this.clock / 1000) * saw.spin + saw.phase;
    for (let i = 0; i < saw.blades; i++) {
      const a = spin + (i * Math.PI * 2) / saw.blades;
      const tip = { x: cx + Math.cos(a) * saw.radius, y: cy + Math.sin(a) * saw.radius };
      if (segDist(ball.x, ball.y, { x: cx, y: cy }, tip) <= BALL_R * 0.9 + 5) return true;
    }
    return Math.hypot(ball.x - cx, ball.y - cy) <= BALL_R * 0.9 + 14;
  }

  private obstacleHitsBall(obstacle: Obstacle, ball: Pt): boolean {
    switch (obstacle.kind) {
      case "spike":
        return this.spikeHitsBall(obstacle, ball);
      case "circle":
        // До входа в круговой участок круг — только предупреждение.
        return false;
      case "saw":
        return this.sawHitsBall(obstacle, ball);
    }
  }

  private updateStatus(force = false): void {
    let text: string;
    if (this.phase === "ready") {
      text = this.touch ? "Тап по левой / правой половине экрана" : "← → или тап по половинам экрана";
    } else if (this.phase === "running") {
      text = `Время: ${formatSeconds(this.elapsed)} · Рекорд: ${this.best > 0 ? formatSeconds(this.best) : "—"}`;
    } else if (this.newRecord) {
      text = `Новый рекорд: ${formatSeconds(this.elapsed)}`;
    } else {
      text = `Время: ${formatSeconds(this.elapsed)} · Рекорд: ${this.best > 0 ? formatSeconds(this.best) : "—"}`;
    }
    if (force || text !== this.lastStatus) {
      this.statusEl.textContent = text;
      this.lastStatus = text;
    }
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this.drawBackground();

    ctx.save();
    if (this.shake > 0) {
      const s = this.shake * 7;
      ctx.translate((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
    }
    if (this.loopCircle) this.drawLoopTrack();
    else this.drawTrack();
    this.drawObstacles();
    if (this.loopCircle) {
      this.drawCircleAt(this.loopCenter.x, this.loopCenter.y, this.loopCircle.radius);
    }
    this.drawTether();
    this.drawTrail();
    this.drawBall();
    ctx.restore();

    this.drawParticles();
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 150, 120, ${0.32 * this.flash})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (this.phase === "running") this.drawHud();
    if (this.phase === "ready") this.drawReady();    else if (this.phase === "over") this.drawGameOver();
  }

  private drawBackground(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a1413");
    g.addColorStop(0.45, "#10201b");
    g.addColorStop(1, "#08100f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Мягкие зелёные пятна — свет офисных ламп, уходящий в темноту.
    const glowA = ctx.createRadialGradient(W * 0.18, H * 0.12, 10, W * 0.18, H * 0.12, 260);
    glowA.addColorStop(0, "rgba(122,192,122,0.10)");
    glowA.addColorStop(1, "rgba(122,192,122,0)");
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, W, H);

    const glowB = ctx.createRadialGradient(W * 0.86, H * 0.78, 10, W * 0.86, H * 0.78, 220);
    glowB.addColorStop(0, "rgba(72,150,160,0.08)");
    glowB.addColorStop(1, "rgba(72,150,160,0)");
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, W, H);

    // Едва заметная сетка — намёк на офисную плитку.
    ctx.strokeStyle = "rgba(122,192,122,0.028)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }

    // Пылинки двигаются навстречу — ощущение скорости.
    for (const m of this.motes) {
      ctx.fillStyle = `rgba(215,235,210,${m.a})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Виньетка.
    const v = ctx.createRadialGradient(W / 2, H * 0.44, H * 0.18, W / 2, H * 0.44, H * 0.82);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  private drawTrack(): void {
    const step = 8;
    const sStart = this.traveled - (H - PIVOT_Y) - 100;
    const sEnd = this.traveled + PIVOT_Y + 120;
    const points: Pt[] = [];

    for (let s = sStart; s <= sEnd; s += step) {
      points.push({ x: this.roadX(s), y: this.screenY(s) });
    }

    this.strokeTrack(points);
    this.drawAllCircleLoops();
  }

  private drawAllCircleLoops(): void {
    // Круговые участки — часть трассы: видны заранее и остаются позади.
    for (const obstacle of this.obstacles) {
      if (obstacle.kind !== "circle") continue;
      this.drawCircleLoop(obstacle.baseX, this.screenY(obstacle.s));
    }
    for (const circle of this.passedCircles) {
      this.drawCircleLoop(circle.baseX, this.screenY(circle.s));
    }
  }

  private drawCircleLoop(cx: number, cy: number): void {
    if (cy < -CIRCLE_DETOUR_OFFSET - 80 || cy > H + CIRCLE_DETOUR_OFFSET + 80) return;
    const points: Pt[] = [];
    const steps = 128;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      points.push({
        x: cx + Math.cos(a) * CIRCLE_DETOUR_OFFSET,
        y: cy + Math.sin(a) * CIRCLE_DETOUR_OFFSET,
      });
    }
    this.strokeTrack(points);
  }

  private drawLoopTrack(): void {
    // Непрерывная трасса: вход → полная окружность → выход.
    const ahead: Pt[] = [];
    const sTop = this.traveled + PIVOT_Y + 120;
    for (let s = this.traveled; s <= sTop; s += 8) {
      ahead.push({ x: this.roadX(s), y: this.screenY(s) });
    }

    const behind: Pt[] = [];
    const sBottom = this.traveled - (H - PIVOT_Y) - 100;
    for (let s = this.traveled; s >= sBottom; s -= 8) {
      behind.push({ x: this.roadX(s), y: this.screenY(s) });
    }

    this.strokeTrack(ahead);
    this.strokeTrack(behind);
    this.drawCircleLoop(this.loopCenter.x, this.loopCenter.y);
    this.drawAllCircleLoops();
  }

  private strokeTrack(points: Pt[]): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(122,192,122,0.85)";
    ctx.shadowBlur = 20;
    this.strokePath(points, "rgba(122,192,122,0.20)", 20);
    ctx.shadowBlur = 12;
    this.strokePath(points, "rgba(122,192,122,0.42)", 11);
    ctx.shadowBlur = 0;
    this.strokePath(points, "rgba(232,239,230,0.97)", 7);
    ctx.restore();
  }

  private drawObstacles(): void {
    for (const obstacle of this.obstacles) {
      if (obstacle.kind === "spike") this.drawSpike(obstacle);
      else if (obstacle.kind === "circle") this.drawCircle(obstacle);
      else this.drawSaw(obstacle);
    }
    // Круги, которые игрок уже прошёл, остаются видимыми позади.
    for (const circle of this.passedCircles) {
      this.drawCircle(circle);
    }
  }

  private drawSpike(spike: Spike): void {
    const ctx = this.ctx;
    const g = this.spikeGeometry(spike);
    if (g.c.y < -160 || g.c.y > H + 160) return;

    // Тень/крепление на краю дорожки.
    ctx.save();
    ctx.strokeStyle = "rgba(20, 10, 8, 0.65)";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(g.a.x, g.a.y);
    ctx.lineTo(g.b.x, g.b.y);
    ctx.stroke();
    ctx.restore();

    const grad = ctx.createLinearGradient(g.base.x, g.base.y, g.c.x, g.c.y);
    grad.addColorStop(0, "#7c2a2d");
    grad.addColorStop(0.55, "#d0593f");
    grad.addColorStop(1, "#ffb27a");

    const pulse = 0.55 + 0.45 * Math.sin(this.clock / 260 + spike.s * 0.02);
    ctx.save();
    ctx.shadowColor = `rgba(235, 105, 75, ${0.30 + pulse * 0.30})`;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(g.a.x, g.a.y);
    ctx.lineTo(g.b.x, g.b.y);
    ctx.lineTo(g.c.x, g.c.y);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255,225,200,0.42)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(g.a.x, g.a.y);
    ctx.lineTo(g.b.x, g.b.y);
    ctx.lineTo(g.c.x, g.c.y);
    ctx.closePath();
    ctx.stroke();

    // Блик по внутренней грани.
    ctx.strokeStyle = "rgba(255,240,220,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.base.x, g.base.y - 1);
    ctx.lineTo(g.c.x, g.c.y);
    ctx.stroke();
  }

  private drawCircle(circle: CircleObstacle): void {
    this.drawCircleAt(circle.baseX, this.screenY(circle.s), circle.radius);
  }

  private drawCircleAt(cx: number, cy: number, radius: number): void {
    const ctx = this.ctx;
    if (cy < -radius - 80 || cy > H + radius + 80) return;

    ctx.save();
    ctx.translate(cx, cy);

    // Тёмный диск с огненной кромкой — в него нельзя врезаться.
    ctx.save();
    ctx.shadowColor = "rgba(235,105,75,0.55)";
    ctx.shadowBlur = 20;
    const body = ctx.createRadialGradient(-10, -12, 4, 0, 0, radius);
    body.addColorStop(0, "#3a1114");
    body.addColorStop(0.62, "#7c2a2d");
    body.addColorStop(1, "#d0593f");
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(255,190,150,0.78)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 1.5, 0, Math.PI * 2);
    ctx.stroke();

    // Спираль внутри круга.
    ctx.strokeStyle = "rgba(255,180,140,0.32)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    const turns = 2.4;
    for (let i = 0; i <= 96; i++) {
      const t = i / 96;
      const a = t * turns * Math.PI * 2;
      const r = radius * (0.12 + 0.7 * t);
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,210,180,0.20)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.55, 0, Math.PI * 2);
    ctx.stroke();

    // Втулка.
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#241012";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,170,130,0.75)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#e8efe6";
    ctx.fill();

    ctx.restore();
  }

  private strokePath(points: Pt[], color: string, width: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  private drawSaw(saw: Saw): void {
    const ctx = this.ctx;
    const cx = this.roadX(saw.s);
    const cy = this.screenY(saw.s);
    if (cy < -saw.radius - 80 || cy > H + saw.radius + 80) return;

    const spin = (this.clock / 1000) * saw.spin + saw.phase;
    ctx.save();
    ctx.translate(cx, cy);

    // Призрачное кольцо, чтобы читался круг.
    ctx.setLineDash([5, 9]);
    ctx.lineDashOffset = -this.clock / 60;
    ctx.strokeStyle = "rgba(235,105,75,0.20)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, saw.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < saw.blades; i++) {
      const a = spin + (i * Math.PI * 2) / saw.blades;
      const tx = Math.cos(a) * saw.radius;
      const ty = Math.sin(a) * saw.radius;
      const px = -Math.sin(a) * 7;
      const py = Math.cos(a) * 7;

      const grad = ctx.createLinearGradient(0, 0, tx, ty);
      grad.addColorStop(0, "#7c2a2d");
      grad.addColorStop(0.55, "#d0593f");
      grad.addColorStop(1, "#ffb27a");

      ctx.save();
      ctx.shadowColor = "rgba(235,105,75,0.45)";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tx + px, ty + py);
      ctx.lineTo(tx - px, ty - py);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255,225,200,0.42)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tx + px, ty + py);
      ctx.lineTo(tx - px, ty - py);
      ctx.closePath();
      ctx.stroke();
    }

    // Втулка.
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fillStyle = "#241012";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,170,130,0.65)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#e8efe6";
    ctx.fill();

    ctx.restore();
  }

  private drawTether(): void {
    const ctx = this.ctx;
    const p = this.pivotPos();
    const b = this.ballPos();
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    // Полупрозрачный клин троса, как в Pivvot.
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(b.x + nx * 8, b.y + ny * 8);
    ctx.lineTo(b.x - nx * 8, b.y - ny * 8);
    ctx.closePath();
    ctx.fillStyle = "rgba(122,192,122,0.10)";
    ctx.fill();

    const grad = ctx.createLinearGradient(p.x, p.y, b.x, b.y);
    grad.addColorStop(0, "rgba(122,192,122,0.40)");
    grad.addColorStop(1, "rgba(232,239,230,0.92)");
    ctx.save();
    ctx.shadowColor = "rgba(122,192,122,0.55)";
    ctx.shadowBlur = 9;
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();

    // Ядро-пивот.
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#1a2a22";
    ctx.fill();
    ctx.strokeStyle = "rgba(122,192,122,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = "#e8efe6";
    ctx.fill();
  }

  private drawTrail(): void {
    const ctx = this.ctx;
    if (this.trail.length < 2) return;
    ctx.lineCap = "round";
    for (let i = 1; i < this.trail.length; i++) {
      const t = i / this.trail.length;
      ctx.strokeStyle = `rgba(122,192,122,${0.05 + t * 0.30})`;
      ctx.lineWidth = 1.5 + t * 3;
      ctx.beginPath();
      ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
      ctx.lineTo(this.trail[i].x, this.trail[i].y);
      ctx.stroke();
    }
  }

  private drawBall(): void {
    const ctx = this.ctx;
    const b = this.ballPos();

    ctx.save();
    ctx.shadowColor = "rgba(122,192,122,0.85)";
    ctx.shadowBlur = 18;
    const grad = ctx.createRadialGradient(b.x - 4, b.y - 5, 2, b.x, b.y, BALL_R);
    grad.addColorStop(0, "#e4f8d0");
    grad.addColorStop(0.45, "#8fd18a");
    grad.addColorStop(1, "#4a814c");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(232,239,230,0.85)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R - 0.6, 0, Math.PI * 2);
    ctx.stroke();

    // Пятнышки Бульбазавра.
    ctx.fillStyle = "rgba(40,80,45,0.50)";
    ctx.beginPath();
    ctx.arc(b.x - 4, b.y + 3, 2.4, 0, Math.PI * 2);
    ctx.arc(b.x + 4, b.y + 5, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Блик.
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(b.x - 4.5, b.y - 5.5, 4, 2.6, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.6);
      ctx.restore();
    }

    if (this.deathPos && this.deathT < 520) {
      const t = this.deathT / 520;
      ctx.strokeStyle = `rgba(255, 170, 130, ${(1 - t) * 0.6})`;
      ctx.lineWidth = 3 * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(this.deathPos.x, this.deathPos.y, 20 + t * 90, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const ms = this.phase === "ready" ? 0 : this.elapsed;

    // Затемнение сверху, чтобы цифры читались поверх подъезжающих шипов.
    const fade = ctx.createLinearGradient(0, 0, 0, 132);
    fade.addColorStop(0, "rgba(5, 9, 10, 0.86)");
    fade.addColorStop(1, "rgba(5, 9, 10, 0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, 132);

    ctx.save();
    ctx.textBaseline = "alphabetic";

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(232,239,230,0.55)";
    ctx.font = "bold 12px 'Trebuchet MS', sans-serif";
    ctx.fillText("ВРЕМЯ", 24, 34);
    ctx.fillStyle = "#e8efe6";
    ctx.font = "bold 32px 'Courier New', monospace";
    ctx.fillText(formatSeconds(ms), 24, 66);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(232,239,230,0.55)";
    ctx.font = "bold 11px 'Trebuchet MS', sans-serif";
    ctx.fillText("ЛИЧНЫЙ РЕКОРД", W - 24, 34);
    ctx.fillStyle = this.best > 0 ? "#f9c74f" : "rgba(232,239,230,0.35)";
    ctx.font = "bold 20px 'Courier New', monospace";
    ctx.fillText(this.best > 0 ? formatSeconds(this.best) : "—", W - 24, 62);
    ctx.restore();

    if (this.milestoneFlash > 0) {
      ctx.save();
      ctx.globalAlpha = this.milestoneFlash;
      ctx.textAlign = "center";
      ctx.fillStyle = "#7ac07a";
      ctx.font = "bold 22px 'Trebuchet MS', sans-serif";
      ctx.fillText(`${this.milestone} с`, W / 2, 132);
      ctx.strokeStyle = "rgba(122,192,122,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 64, 144);
      ctx.lineTo(W / 2 + 64, 144);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawReady(): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(6, 10, 11, 0.78)";
    ctx.fillRect(0, 0, W, H);

    // Бульба остаётся яркой поверх затемнения — она главный герой стартового экрана.
    this.drawTether();
    this.drawBall();

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#e8efe6";
    ctx.font = "900 42px 'Trebuchet MS', sans-serif";
    ctx.fillText("BULBA", W / 2, 190);
    ctx.fillStyle = "#7ac07a";
    ctx.font = "900 58px 'Trebuchet MS', sans-serif";
    ctx.fillText("PIVVOT", W / 2, 250);

    ctx.fillStyle = "rgba(232,239,230,0.78)";
    ctx.font = "15px 'Trebuchet MS', sans-serif";
    ctx.fillText("Крутись вокруг ядра и уходи от шипов.", W / 2, 292);
    ctx.fillStyle = "rgba(232,239,230,0.55)";
    ctx.font = "13px 'Trebuchet MS', sans-serif";
    ctx.fillText("Один режим — продержаться как можно дольше.", W / 2, 316);

    this.drawControlPanel(28, 384, 186, 116, "◀", "влево", this.touch ? "левая половина" : "← / A");
    this.drawControlPanel(W - 28 - 186, 384, 186, 116, "▶", "вправо", this.touch ? "правая половина" : "→ / D");

    const pulse = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(this.clock / 260));
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#7ac07a";
    ctx.font = "bold 21px 'Trebuchet MS', sans-serif";
    ctx.fillText(this.touch ? "ТАПНИ, ЧТОБЫ НАЧАТЬ" : "ПРОБЕЛ / ENTER — СТАРТ", W / 2, 540);
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(232,239,230,0.6)";
    ctx.font = "13px 'Trebuchet MS', sans-serif";
    ctx.fillText(
      this.touch ? "Левая и правая половины — вращение" : "Или нажми любую стрелку",
      W / 2,
      568,
    );

    ctx.fillStyle = "rgba(232,239,230,0.4)";
    ctx.font = "12px 'Trebuchet MS', sans-serif";
    ctx.fillText(
      this.best > 0 ? `Твой рекорд: ${formatSeconds(this.best)}` : "Первый рекорд — твой",
      W / 2,
      602,
    );
  }

  private drawControlPanel(
    x: number,
    y: number,
    w: number,
    h: number,
    arrow: string,
    title: string,
    subtitle: string,
  ): void {
    const ctx = this.ctx;
    roundRect(ctx, x, y, w, h, 18);
    ctx.fillStyle = "rgba(38,43,51,0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(122,192,122,0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "#7ac07a";
    ctx.font = "bold 38px 'Trebuchet MS', sans-serif";
    ctx.fillText(arrow, x + w / 2, y + 54);
    ctx.fillStyle = "#e8efe6";
    ctx.font = "bold 15px 'Trebuchet MS', sans-serif";
    ctx.fillText(title, x + w / 2, y + 82);
    ctx.fillStyle = "rgba(232,239,230,0.55)";
    ctx.font = "11px 'Trebuchet MS', sans-serif";
    ctx.fillText(subtitle, x + w / 2, y + 101);
  }

  private drawGameOver(): void {
    const ctx = this.ctx;
    const a = clamp((this.deathT - 200) / 300, 0, 1);
    if (a <= 0) return;

    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(6, 10, 11, 0.74)";
    ctx.fillRect(0, 0, W, H);

    const cardX = W / 2 - 168;
    const cardY = 176;
    const cardW = 336;
    const cardH = 318;
    roundRect(ctx, cardX, cardY, cardW, cardH, 22);
    ctx.fillStyle = "rgba(38,43,51,0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(122,192,122,0.55)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#ff9a6a";
    ctx.font = "900 38px 'Trebuchet MS', sans-serif";
    ctx.fillText("ОЙ!", W / 2, cardY + 62);

    ctx.fillStyle = "#e8efe6";
    ctx.font = "bold 56px 'Courier New', monospace";
    ctx.fillText(formatSeconds(this.elapsed), W / 2, cardY + 132);

    ctx.strokeStyle = "rgba(122,192,122,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 42, cardY + 164);
    ctx.lineTo(cardX + cardW - 42, cardY + 164);
    ctx.stroke();

    if (this.newRecord) {
      ctx.fillStyle = "#f9c74f";
      ctx.font = "bold 18px 'Trebuchet MS', sans-serif";
      ctx.fillText("ЛИЧНЫЙ РЕКОРД!", W / 2, cardY + 196);
    } else {
      ctx.fillStyle = "rgba(232,239,230,0.72)";
      ctx.font = "15px 'Trebuchet MS', sans-serif";
      ctx.fillText(`Личный рекорд: ${formatSeconds(this.best)}`, W / 2, cardY + 196);
    }

    const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(this.clock / 240));
    ctx.globalAlpha = a * pulse;
    ctx.fillStyle = "#7ac07a";
    ctx.font = "bold 17px 'Trebuchet MS', sans-serif";
    ctx.fillText("ENTER / ТАП — ЕЩЁ РАЗ", W / 2, cardY + 244);
    ctx.globalAlpha = a;

    ctx.fillStyle = "rgba(232,239,230,0.5)";
    ctx.font = "12px 'Trebuchet MS', sans-serif";
    ctx.fillText(
      this.touch ? "или тапни в любом месте" : "или просто нажми ← или →",
      W / 2,
      cardY + 270,
    );
    ctx.globalAlpha = 1;
  }
}

import { screenToStage, stage } from "./orientation";
import { publicPath } from "../publicPath";
import type { KeyConsumer } from "./KeyboardRouter";

// Логическое поле — как на сервере. Координаты ВИДА: своя бита всегда внизу.
export const AH_W = 420;
export const AH_H = 700;

const PADDLE_R = 37.6; // 34.2 × 1.1 — как на сервере
const PUCK_R = 25; // 22.75 × 1.1 — как на сервере
/** Как на сервере: хитбокс чуть меньше из‑за прозрачных краёв спрайтов. */
const CONTACT_SCALE = 0.9;
const PADDLE_DRAW = PADDLE_R * 2;
const PUCK_DRAW = PUCK_R * 2;
const SCORE_TO_WIN = 10;

const INVITE_RED = "Сыграем в аэрохоккей? Я за красную сторону!";
const INVITE_BLUE = "Сыграем в аэрохоккей? Я за синюю сторону!";

export type AirHockeySide = "red" | "blue";

export interface AirHockeyStateView {
  phase: string;
  mySide: AirHockeySide | null;
  redScore: number;
  blueScore: number;
  remainingMs: number;
  puckX: number;
  puckY: number;
  myX: number;
  myY: number;
  oppX: number;
  oppY: number;
  redLogin: string | null;
  blueLogin: string | null;
  redConnected: boolean;
  blueConnected: boolean;
  winnerSide: AirHockeySide | null;
  winnerLogin: string | null;
  rematchBy: AirHockeySide | null;
  goalFreezeMs: number;
  goalScorerLogin: string | null;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
}

function loadImg(src: string): HTMLImageElement {
  const img = new Image();
  img.src = publicPath(src);
  return img;
}

/**
 * Аэрохоккей. Сервер отдаёт уже «вид» игрока (я внизу, соперник сверху).
 * Клиент только рисует и шлёт координаты своей половины без переворотов.
 */
export class AirHockey implements KeyConsumer {
  isOpen = false;
  onClose: (() => void) | null = null;
  onLeave: (() => void) | null = null;
  onPaddle: ((x: number, y: number) => void) | null = null;
  onRematchRequest: (() => void) | null = null;
  onRematchCancel: (() => void) | null = null;
  onRematchRespond: ((accept: boolean) => void) | null = null;

  private root = document.getElementById("airhockey")!;
  private canvas = document.getElementById("ahCanvas") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;
  private statusEl = document.getElementById("ahStatus")!;
  private confetti = document.getElementById("ahConfetti") as HTMLCanvasElement;
  private confettiCtx = this.confetti.getContext("2d")!;
  private rematchRoot = document.getElementById("ahRematch")!;
  private rematchText = document.getElementById("ahRematchText")!;
  private rematchActions = document.getElementById("ahRematchActions")!;
  private goalRoot = document.getElementById("ahGoal")!;
  private goalText = document.getElementById("ahGoalText")!;
  private pingRoot = document.getElementById("ahPing")!;
  private pingText = document.getElementById("ahPingText")!;
  private timerEl = document.getElementById("ahTimer")!;

  private fieldImg = loadImg("assets/airhockey/field.png");
  private paddleRedImg = loadImg("assets/airhockey/paddle-red.png");
  private paddleBlueImg = loadImg("assets/airhockey/paddle-blue.png");
  private puckImg = loadImg("assets/airhockey/puck.png");

  private mySide: AirHockeySide = "red";
  private state: AirHockeyStateView | null = null;
  private localX = AH_W * 0.5;
  private localY = AH_H * 0.78;
  private over = false;
  private finaleShown = false;
  private raf = 0;
  private lastSend = 0;
  private pointerId: number | null = null;
  private pointerActive = false;

  private particles: Particle[] = [];
  private confettiRaf = 0;
  private confettiLast = 0;

  private renderPuckX = AH_W * 0.5;
  private renderPuckY = AH_H * 0.5;
  private renderOppX = AH_W * 0.5;
  private renderOppY = AH_H * 0.22;

  constructor() {
    document.getElementById("ahClose")!.onclick = () => this.close();
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (e.code === "Escape") {
      this.close();
      return true;
    }
    return false;
  }

  open(side: AirHockeySide): void {
    this.mySide = side;
    this.isOpen = true;
    this.over = false;
    this.finaleShown = false;
    this.state = null;
    this.canvas.width = AH_W;
    this.canvas.height = AH_H;
    this.localX = AH_W * 0.5;
    this.localY = AH_H * 0.78;
    this.renderPuckX = AH_W * 0.5;
    this.renderPuckY = AH_H * 0.5;
    this.renderOppX = AH_W * 0.5;
    this.renderOppY = AH_H * 0.22;
    this.stopConfetti();
    this.hideRematch();
    this.hideGoal();
    this.pingRoot.classList.add("hidden"); // покажем после первого замера
    this.setTimer(3 * 60 * 1000, false);
    this.root.classList.remove("hidden");
    this.statusEl.textContent = `Счёт 0 : 0 · до ${SCORE_TO_WIN}`;
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.over = false;
    this.finaleShown = false;
    cancelAnimationFrame(this.raf);
    this.stopConfetti();
    this.hideRematch();
    this.hideGoal();
    this.pointerId = null;
    this.pointerActive = false;
    this.pingRoot.classList.add("hidden");
    this.root.classList.add("hidden");
    this.onLeave?.();
    this.onClose?.();
  }

  /** Обновляет плашку пинга: зелёный ≤80 мс, жёлтый ≤180 мс, дальше красный. */
  setPing(rttMs: number): void {
    if (!this.isOpen) return;
    const cls = rttMs <= 80 ? "good" : rttMs <= 180 ? "mid" : "bad";
    this.pingRoot.classList.remove("hidden", "good", "mid", "bad");
    this.pingRoot.classList.add(cls);
    this.pingText.textContent = `${Math.round(rttMs)} мс`;
  }

  onState(state: AirHockeyStateView): void {
    if (!this.isOpen) return;

    const first = this.state == null;
    this.state = state;
    if (state.mySide) this.mySide = state.mySide;

    if (first) {
      if (Number.isFinite(state.puckX) && Number.isFinite(state.puckY)) {
        this.renderPuckX = state.puckX;
        this.renderPuckY = state.puckY;
      }
      if (Number.isFinite(state.oppX) && Number.isFinite(state.oppY)) {
        this.renderOppX = state.oppX;
        this.renderOppY = state.oppY;
      }
    }

    if (state.phase === "ended") {
      this.hideGoal();
      this.setTimer(state.remainingMs, false);
      if (!this.over) {
        this.over = true;
        this.showFinale(state, true);
      } else {
        this.showFinale(state, false);
      }
      this.updateRematchUi(state);
    } else if (state.phase === "playing") {
      this.over = false;
      this.finaleShown = false;
      this.hideRematch();
      this.stopConfetti();
      this.updateGoalUi(state);
      const oppGone =
        (this.mySide === "red" && !state.blueConnected) ||
        (this.mySide === "blue" && !state.redConnected);
      const mine = this.mySide === "red" ? state.redScore : state.blueScore;
      const opp = this.mySide === "red" ? state.blueScore : state.redScore;
      this.setTimer(state.remainingMs, true);
      if (state.goalFreezeMs > 0 && state.goalScorerLogin) {
        this.statusEl.textContent = `Гол! · до ${SCORE_TO_WIN}`;
      } else {
        this.statusEl.textContent =
          `Счёт ${mine} : ${opp} · до ${SCORE_TO_WIN}` +
          (oppGone ? " · соперник вышел" : "");
      }
    }
  }

  /** Крупный таймер над полем; в последние 20 секунд матча мигает красным. */
  private setTimer(remainingMs: number, playing: boolean): void {
    this.timerEl.textContent = formatMs(remainingMs);
    this.timerEl.classList.toggle("danger", playing && remainingMs <= 20_000);
  }

  static inviteText(side: AirHockeySide): string {
    return side === "red" ? INVITE_RED : INVITE_BLUE;
  }

  private oppLogin(state: AirHockeyStateView): string {
    return (this.mySide === "red" ? state.blueLogin : state.redLogin) ?? "соперник";
  }

  private oppConnected(state: AirHockeyStateView): boolean {
    return this.mySide === "red" ? state.blueConnected : state.redConnected;
  }

  private showFinale(state: AirHockeyStateView, first: boolean): void {
    const mine = this.mySide === "red" ? state.redScore : state.blueScore;
    const opp = this.mySide === "red" ? state.blueScore : state.redScore;
    const score = `${mine} : ${opp}`;
    const iWon =
      (this.mySide === "red" && state.winnerSide === "red") ||
      (this.mySide === "blue" && state.winnerSide === "blue");
    if (!state.winnerSide) {
      this.statusEl.textContent = `Ничья ${score} · время вышло`;
    } else if (iWon) {
      this.statusEl.textContent = `Победа! ${score}`;
      if (first && !this.finaleShown) {
        this.finaleShown = true;
        this.launchConfetti();
      }
    } else {
      const name = state.winnerLogin ?? "соперник";
      this.statusEl.textContent = `Победил ${name}. ${score}`;
    }
  }

  private updateRematchUi(state: AirHockeyStateView): void {
    if (!this.oppConnected(state)) {
      this.hideRematch();
      return;
    }
    const opp = this.oppLogin(state);
    const by = state.rematchBy;
    this.rematchActions.replaceChildren();
    this.rematchRoot.classList.remove("hidden");

    if (!by) {
      this.rematchText.textContent = "";
      this.rematchActions.append(
        this.btn(`Предложить ${opp} сыграть ещё раз`, () => this.onRematchRequest?.()),
      );
      return;
    }
    if (by === this.mySide) {
      this.rematchText.textContent = `Ожидание ответа от ${opp}`;
      this.rematchActions.append(this.btn("Отмена", () => this.onRematchCancel?.()));
      return;
    }
    this.rematchText.textContent = `Игрок ${opp} предлагает сыграть ещё раз`;
    this.rematchActions.append(
      this.btn("Да", () => this.onRematchRespond?.(true)),
      this.btn("Нет", () => this.onRematchRespond?.(false)),
    );
  }

  private btn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ttt-restart";
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  private hideRematch(): void {
    this.rematchRoot.classList.add("hidden");
    this.rematchActions.replaceChildren();
    this.rematchText.textContent = "";
  }

  private updateGoalUi(state: AirHockeyStateView): void {
    if (state.goalFreezeMs <= 0 || !state.goalScorerLogin) {
      this.hideGoal();
      return;
    }
    const mine = this.mySide === "red" ? state.redScore : state.blueScore;
    const opp = this.mySide === "red" ? state.blueScore : state.redScore;
    this.goalText.textContent =
      `Гол! Игрок ${state.goalScorerLogin}. Счёт ${mine} : ${opp}`;
    this.goalRoot.classList.remove("hidden");
  }

  private hideGoal(): void {
    this.goalRoot.classList.add("hidden");
    this.goalText.textContent = "";
  }

  private loop = (): void => {
    if (!this.isOpen) return;
    if (this.pointerActive && !this.over) {
      const now = performance.now();
      if (now - this.lastSend > 16) {
        this.lastSend = now;
        this.onPaddle?.(this.localX, this.localY);
      }
    }
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.drawField(ctx, w, h);

    const myColor = this.mySide === "red" ? "#c94f4f" : "#4a7fd4";
    const oppColor = this.mySide === "red" ? "#4a7fd4" : "#c94f4f";
    const myPaddle = this.mySide === "red" ? this.paddleRedImg : this.paddleBlueImg;
    const oppPaddle = this.mySide === "red" ? this.paddleBlueImg : this.paddleRedImg;

    const st = this.state;
    if (st) {
      if (Number.isFinite(st.puckX) && Number.isFinite(st.puckY)) {
        if (st.goalFreezeMs > 0) {
          // После гола шайба мягко едет в центр, без телепорта.
          this.renderPuckX += (AH_W * 0.5 - this.renderPuckX) * 0.18;
          this.renderPuckY += (AH_H * 0.5 - this.renderPuckY) * 0.18;
        } else {
          // Быстрая сходимость к серверу: после удара шайба сразу «отлетает»,
          // медленный лерп визуально выглядел как прилипание к бите.
          this.renderPuckX += (st.puckX - this.renderPuckX) * 0.5;
          this.renderPuckY += (st.puckY - this.renderPuckY) * 0.5;
        }
      }
      if (Number.isFinite(st.oppX) && Number.isFinite(st.oppY)) {
        this.renderOppX += (st.oppX - this.renderOppX) * 0.55;
        this.renderOppY += (st.oppY - this.renderOppY) * 0.55;
      }
    }
    // После гола / реванша шайба не должна рисоваться внутри биты только при движении.
    if (!this.over && !(st && st.goalFreezeMs > 0) && this.pointerActive) {
      this.pushPuckOut(this.localX, this.localY, 0, -1);
    }

    const oppConnected =
      this.mySide === "red" ? st?.blueConnected !== false : st?.redConnected !== false;
    if (oppConnected) {
      this.drawSprite(ctx, oppPaddle, this.renderOppX, this.renderOppY, PADDLE_DRAW, PADDLE_DRAW);
    }
    this.drawSprite(ctx, myPaddle, this.localX, this.localY, PADDLE_DRAW, PADDLE_DRAW);
    this.drawSprite(ctx, this.puckImg, this.renderPuckX, this.renderPuckY, PUCK_DRAW, PUCK_DRAW);

    const rs = st?.redScore ?? 0;
    const bs = st?.blueScore ?? 0;
    const topScore = this.mySide === "red" ? bs : rs;
    const botScore = this.mySide === "red" ? rs : bs;
    ctx.font = "bold 42px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = oppColor;
    ctx.globalAlpha = 0.7;
    ctx.fillText(String(topScore), w / 2, 48);
    ctx.fillStyle = myColor;
    ctx.fillText(String(botScore), w / 2, h - 48);
    ctx.globalAlpha = 1;
  }

  /** Поле: для синего вида ассет с абсолютной разметкой крутим на 180°. */
  private drawField(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const img = this.fieldImg;
    if (img.complete && img.naturalWidth > 0) {
      if (this.mySide === "blue") {
        ctx.save();
        ctx.translate(w, h);
        ctx.rotate(Math.PI);
        ctx.drawImage(img, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(img, 0, 0, w, h);
      }
      return;
    }
    // Fallback, пока картинка грузится.
    ctx.fillStyle = "#2a3038";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#d8dde4";
    ctx.fillRect(8, 8, w - 16, h - 16);
  }

  private drawSprite(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    dw: number,
    dh: number,
  ): void {
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x - dw / 2, y - dh / 2, dw, dh);
      return;
    }
    ctx.fillStyle = "#1b1f24";
    ctx.beginPath();
    ctx.arc(x, y, Math.min(dw, dh) / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.isOpen || this.over) return;
    this.pointerId = e.pointerId;
    this.pointerActive = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.moveToPointer(e);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isOpen || this.over) return;
    if (this.pointerId != null && e.pointerId !== this.pointerId) return;
    if (e.pointerType === "touch" && this.pointerId == null) return;
    if (e.pointerType !== "touch") this.pointerActive = true;
    this.moveToPointer(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.pointerId === e.pointerId) {
      this.pointerId = null;
      this.pointerActive = false;
    }
  };

  private moveToPointer(e: PointerEvent): void {
    const p = this.canvasPos(e);
    const tx = clamp(p.x, PADDLE_R + 4, AH_W - PADDLE_R - 4);
    const ty = clamp(p.y, AH_H * 0.5 + PADDLE_R + 2, AH_H - PADDLE_R - 4);
    // Локально выталкиваем шайбу по пути биты — иначе курсор рисует биту
    // поверх серверной шайбы и кажется, что бита проходит насквозь.
    if (!this.over) {
      this.sweepLocalPuck(this.localX, this.localY, tx, ty);
    }
    this.localX = tx;
    this.localY = ty;
    this.onPaddle?.(this.localX, this.localY);
    this.lastSend = performance.now();
  }

  /** Проход биты от (ox,oy) к (nx,ny) с выталкиванием отрисованной шайбы. */
  private sweepLocalPuck(ox: number, oy: number, nx: number, ny: number): void {
    const dx = nx - ox;
    const dy = ny - oy;
    const travel = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(travel / 4));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.pushPuckOut(ox + dx * t, oy + dy * t, dx, dy);
    }
  }

  private pushPuckOut(px: number, py: number, _moveX: number, _moveY: number): void {
    const minDist = (PADDLE_R + PUCK_R) * CONTACT_SCALE;
    const dx = this.renderPuckX - px;
    const dy = this.renderPuckY - py;
    const dist = Math.hypot(dx, dy);
    if (dist >= minDist) return;

    let nx: number;
    let ny: number;
    if (dist < 1e-6) {
      nx = 0;
      ny = -1;
    } else {
      nx = dx / dist;
      ny = dy / dist;
    }
    this.renderPuckX = clamp(px + nx * minDist, PUCK_R, AH_W - PUCK_R);
    this.renderPuckY = clamp(py + ny * minDist, PUCK_R, AH_H - PUCK_R);
  }

  private canvasPos(e: PointerEvent): { x: number; y: number } {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    if (!stage.rotated) {
      if (rect.width < 1 || rect.height < 1) return { x: AH_W / 2, y: AH_H * 0.78 };
      return {
        x: ((e.clientX - rect.left) / rect.width) * AH_W,
        y: ((e.clientY - rect.top) / rect.height) * AH_H,
      };
    }
    const local = screenToStage(
      e.clientX - (rect.left + rect.width / 2),
      e.clientY - (rect.top + rect.height / 2),
    );
    const dispW = canvas.clientWidth || rect.height;
    const dispH = canvas.clientHeight || rect.width;
    if (dispW < 1 || dispH < 1) return { x: AH_W / 2, y: AH_H * 0.78 };
    return {
      x: (local.x / dispW) * AH_W + AH_W / 2,
      y: (local.y / dispH) * AH_H + AH_H / 2,
    };
  }

  private launchConfetti(): void {
    const w = (this.confetti.width = stage.width);
    const h = (this.confetti.height = stage.height);
    const colors = ["#f94144", "#f8961e", "#f9c74f", "#90be6d", "#43aa8b", "#577590", "#4a7fd4"];
    this.particles = [];
    const cx = w / 2;
    const cy = h * 0.4;
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 9;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 4,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.4,
        size: 6 + Math.random() * 6,
        color: colors[i % colors.length],
      });
    }
    this.confettiLast = performance.now();
    cancelAnimationFrame(this.confettiRaf);
    this.confettiLoop();
  }

  private confettiLoop = (): void => {
    const now = performance.now();
    const frame = Math.min((now - this.confettiLast) / 16.67, 3);
    this.confettiLast = now;
    const ctx = this.confettiCtx;
    const { width: w, height: h } = this.confetti;
    ctx.clearRect(0, 0, w, h);
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.vy += 0.3 * frame;
      p.vx *= 0.99;
      p.x += p.vx * frame;
      p.y += p.vy * frame;
      p.rot += p.vrot * frame;
      if (p.y - p.size > h) continue;
      alive.push(p);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    this.particles = alive;
    if (alive.length) this.confettiRaf = requestAnimationFrame(this.confettiLoop);
    else ctx.clearRect(0, 0, w, h);
  };

  private stopConfetti(): void {
    cancelAnimationFrame(this.confettiRaf);
    this.particles = [];
    this.confettiCtx.clearRect(0, 0, this.confetti.width, this.confetti.height);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

import { screenToStage, stage } from "./orientation";
import type { KeyConsumer } from "./KeyboardRouter";

// Логическое поле — как на сервере. Координаты ВИДА: своя бита всегда внизу.
export const AH_W = 420;
export const AH_H = 700;

const PADDLE_R = 28;
const PUCK_R = 14;
const GOAL_HALF = 55;
const SCORE_TO_WIN = 10;

const INVITE = "Сыграем в аэрохоккей?";

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

/**
 * Аэрохоккей. Сервер отдаёт уже «вид» игрока (я внизу, соперник сверху).
 * Клиент только рисует и шлёт координаты своей половины без переворотов.
 */
export class AirHockey implements KeyConsumer {
  isOpen = false;
  onClose: (() => void) | null = null;
  onLeave: (() => void) | null = null;
  onPaddle: ((x: number, y: number) => void) | null = null;

  private root = document.getElementById("airhockey")!;
  private canvas = document.getElementById("ahCanvas") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;
  private statusEl = document.getElementById("ahStatus")!;
  private confetti = document.getElementById("ahConfetti") as HTMLCanvasElement;
  private confettiCtx = this.confetti.getContext("2d")!;

  private mySide: AirHockeySide = "red";
  private state: AirHockeyStateView | null = null;
  private localX = AH_W * 0.5;
  private localY = AH_H * 0.78;
  private over = false;
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
    this.root.classList.remove("hidden");
    this.statusEl.textContent = `Счёт 0 : 0 · до ${SCORE_TO_WIN}`;
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.over = false;
    cancelAnimationFrame(this.raf);
    this.stopConfetti();
    this.pointerId = null;
    this.pointerActive = false;
    this.root.classList.add("hidden");
    this.onLeave?.();
    this.onClose?.();
  }

  onState(state: AirHockeyStateView): void {
    if (!this.isOpen) return;

    const first = this.state == null;
    this.state = state;
    if (state.mySide) this.mySide = state.mySide;

    // Первый стейт — сразу ставим шайбу/соперника, без долгого lerp из нулей.
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

    if (state.phase === "ended" && !this.over) {
      this.over = true;
      this.showFinale(state);
    } else if (state.phase === "playing") {
      this.over = false;
      const oppGone =
        (this.mySide === "red" && !state.blueConnected) ||
        (this.mySide === "blue" && !state.redConnected);
      const mine = this.mySide === "red" ? state.redScore : state.blueScore;
      const opp = this.mySide === "red" ? state.blueScore : state.redScore;
      this.statusEl.textContent =
        `Счёт ${mine} : ${opp} · до ${SCORE_TO_WIN}` +
        (oppGone ? " · соперник вышел" : "");
    }
  }

  static inviteText(): string {
    return INVITE;
  }

  private showFinale(state: AirHockeyStateView): void {
    const mine = this.mySide === "red" ? state.redScore : state.blueScore;
    const opp = this.mySide === "red" ? state.blueScore : state.redScore;
    const score = `${mine} : ${opp}`;
    const iWon =
      (this.mySide === "red" && state.winnerSide === "red") ||
      (this.mySide === "blue" && state.winnerSide === "blue");
    if (!state.winnerSide) {
      this.statusEl.textContent = `Ничья ${score}`;
    } else if (iWon) {
      this.statusEl.textContent = `Победа! ${score}`;
      this.launchConfetti();
    } else {
      const name = state.winnerLogin ?? "соперник";
      this.statusEl.textContent = `Победил ${name}. ${score}`;
    }
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

    ctx.fillStyle = "#2a3038";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#d8dde4";
    roundRect(ctx, 8, 8, w - 16, h - 16, 18);
    ctx.fill();

    ctx.strokeStyle = "#e05555";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(16, h / 2);
    ctx.lineTo(w - 16, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#4a7fd4";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 48, 0, Math.PI * 2);
    ctx.stroke();

    const myColor = this.mySide === "red" ? "#c94f4f" : "#4a7fd4";
    const oppColor = this.mySide === "red" ? "#4a7fd4" : "#c94f4f";
    ctx.fillStyle = oppColor;
    ctx.fillRect(w / 2 - GOAL_HALF, 0, GOAL_HALF * 2, 10);
    ctx.fillStyle = myColor;
    ctx.fillRect(w / 2 - GOAL_HALF, h - 10, GOAL_HALF * 2, 10);

    const st = this.state;
    if (st) {
      if (Number.isFinite(st.puckX) && Number.isFinite(st.puckY)) {
        this.renderPuckX += (st.puckX - this.renderPuckX) * 0.55;
        this.renderPuckY += (st.puckY - this.renderPuckY) * 0.55;
      }
      if (Number.isFinite(st.oppX) && Number.isFinite(st.oppY)) {
        this.renderOppX += (st.oppX - this.renderOppX) * 0.55;
        this.renderOppY += (st.oppY - this.renderOppY) * 0.55;
      }
    }

    const oppConnected =
      this.mySide === "red" ? st?.blueConnected !== false : st?.redConnected !== false;
    if (oppConnected) {
      drawPaddle(ctx, this.renderOppX, this.renderOppY, oppColor);
    }
    drawPaddle(ctx, this.localX, this.localY, myColor);

    // Шайба — крупный контрастный диск по центру, если стейта ещё нет.
    ctx.fillStyle = "#1b1f24";
    ctx.beginPath();
    ctx.arc(this.renderPuckX, this.renderPuckY, PUCK_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4f1e8";
    ctx.beginPath();
    ctx.arc(this.renderPuckX, this.renderPuckY, PUCK_R * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c94f4f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.renderPuckX, this.renderPuckY, PUCK_R, 0, Math.PI * 2);
    ctx.stroke();

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
    this.localX = clamp(p.x, PADDLE_R + 4, AH_W - PADDLE_R - 4);
    this.localY = clamp(p.y, AH_H * 0.5 + PADDLE_R + 2, AH_H - PADDLE_R - 4);
    this.onPaddle?.(this.localX, this.localY);
    this.lastSend = performance.now();
  }

  private canvasPos(e: PointerEvent): { x: number; y: number } {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    // Без поворота сцены — прямое отображение в битмап (надёжнее для десктопа).
    if (!stage.rotated) {
      if (rect.width < 1 || rect.height < 1) return { x: AH_W / 2, y: AH_H * 0.78 };
      return {
        x: ((e.clientX - rect.left) / rect.width) * AH_W,
        y: ((e.clientY - rect.top) / rect.height) * AH_H,
      };
    }
    // Сцена повёрнута на 90°: AABB канваса осецентричен, смещение — через screenToStage.
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

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPaddle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, PADDLE_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f4f1e8";
  ctx.beginPath();
  ctx.arc(x, y, PADDLE_R * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1b1f24";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, PADDLE_R, 0, Math.PI * 2);
  ctx.stroke();
}

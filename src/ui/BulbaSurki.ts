import { publicPath } from "../publicPath";
import { screenToStage, stage } from "./orientation";

// Логическое поле (px). Канвас масштабируется через CSS.
const W = 480;
const H = 560;

const ROUND_MS = 30_000;
const COLS = 3;
const ROWS = 3;

// У каждой лунки свой таймер с разбросом — сурки не вылезают синхронно.
const HOLE_TICK_MIN = 800;
const HOLE_TICK_MAX = 1200;
const SPAWN_P = 0.12;          

const MOLE_UP_MIN = 400;
const MOLE_UP_MAX = 900;
const HIT_COOLDOWN = 200;
const POP_MS = 120;

const BOARD_X = 48;
const BOARD_Y = 78;
const BOARD_W = W - BOARD_X * 2;
const BOARD_H = 372;
const HOLE_R = 38;

const MOLE_DRAW_W = 72;
const MOLE_DRAW_H = 80;
const HAMMER_DRAW_W = 96;
const HAMMER_DRAW_H = 148;

interface Hole {
  x: number;
  y: number;
  tick: number;       // мс до следующей попытки спавна
  mole: number;       // мс, сколько ещё торчит (0 = пусто)
  pop: number;        // [-1..1]: -1 уходит, 0 спрятан, 1 полностью наружу
  poppingOut: boolean;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function holeCenters(): { x: number; y: number }[] {
  const cellW = BOARD_W / COLS;
  const cellH = BOARD_H / ROWS;
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      out.push({
        x: BOARD_X + cellW * (c + 0.5),
        y: BOARD_Y + cellH * (r + 0.5),
      });
    }
  }
  return out;
}

// Bulba Surki — бей сурков игрушечным молотком. 30 секунд, 9 лунок, очко за попадание.
export class BulbaSurki {
  isOpen = false;
  onClose: (() => void) | null = null;
  onGameOver: ((value: number) => void) | null = null;
  onLeaderboard: (() => void) | null = null;
  private reported = false;

  private root = document.getElementById("bulbasurki")!;
  private canvas = document.getElementById("bsCanvas") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;
  private statusEl = document.getElementById("bsStatus")!;

  private holes: Hole[] = [];
  private score = 0;
  private over = false;
  private leftMs = ROUND_MS;
  private hitCd = 0;
  private swing = 0;            // 0..1 анимация удара
  private hammerX = W / 2;
  private hammerY = H / 2;
  private highlight = 0;        // индекс ближайшей лунки
  private flash = 0;            // подсветка удачного попадания
  private flashHole = -1;
  private lastT = 0;
  private raf = 0;
  private pointerId: number | null = null;

  private moleImg = new Image();
  private hammerImg = new Image();
  private panelImg = new Image();
  private cabinetImg = new Image();

  constructor() {
    document.getElementById("bsClose")!.onclick = () => this.close();
    document.getElementById("bsLb")!.onclick = () => this.onLeaderboard?.();
    document.getElementById("bsRestart")!.onclick = () => this.reset();

    this.moleImg.src = publicPath("assets/bulbasurki/mole.png");
    this.hammerImg.src = publicPath("assets/bulbasurki/hammer.png");
    this.panelImg.src = publicPath("assets/bulbasurki/panel.png");
    this.cabinetImg.src = publicPath("assets/bulbasurki/cabinet.png");

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.style.touchAction = "none";
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Escape") {
      this.close();
      return;
    }
    if (this.over && (e.code === "Enter" || e.code === "Space")) {
      e.preventDefault();
      this.reset();
      return;
    }
    if (this.over) return;

    const step = (dx: number, dy: number) => {
      const col = this.highlight % COLS;
      const row = Math.floor(this.highlight / COLS);
      const nc = Math.max(0, Math.min(COLS - 1, col + dx));
      const nr = Math.max(0, Math.min(ROWS - 1, row + dy));
      this.highlight = nr * COLS + nc;
      const h = this.holes[this.highlight];
      this.hammerX = h.x;
      this.hammerY = h.y - 28;
      e.preventDefault();
    };

    if (e.code === "ArrowLeft" || e.code === "KeyA") step(-1, 0);
    else if (e.code === "ArrowRight" || e.code === "KeyD") step(1, 0);
    else if (e.code === "ArrowUp" || e.code === "KeyW") step(0, -1);
    else if (e.code === "ArrowDown" || e.code === "KeyS") step(0, 1);
    else if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      this.hit();
    } else {
      const n = digitHole(e.code);
      if (n >= 0) {
        this.highlight = n;
        const h = this.holes[n];
        this.hammerX = h.x;
        this.hammerY = h.y - 28;
        e.preventDefault();
        this.hit();
      }
    }
  };

  open(): void {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKeyDown);
    this.reset();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    this.root.classList.add("hidden");
    this.onClose?.();
  }

  private reset(): void {
    this.score = 0;
    this.over = false;
    this.reported = false;
    this.leftMs = ROUND_MS;
    this.hitCd = 0;
    this.swing = 0;
    this.flash = 0;
    this.flashHole = -1;
    this.highlight = 4;
    const centers = holeCenters();
    this.holes = centers.map((p, i) => ({
      x: p.x,
      y: p.y,
      // Стартовый разброс, чтобы лунки не тикали разом.
      tick: rand(HOLE_TICK_MIN, HOLE_TICK_MAX) * (0.3 + (i % 5) * 0.15),
      mole: 0,
      pop: 0,
      poppingOut: false,
    }));
    this.hammerX = this.holes[4].x;
    this.hammerY = this.holes[4].y - 28;
    this.updateStatus();
    this.lastT = performance.now();
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  private canvasPos(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    // Как у Phaser: bounding box повёрнутого канваса осецентричен, смещение
    // переводим в координаты сцены (см. main.ts patchPointerTransform).
    const local = screenToStage(
      e.clientX - (r.left + r.width / 2),
      e.clientY - (r.top + r.height / 2),
    );
    const dispW = this.canvas.clientWidth || (stage.rotated ? r.height : r.width);
    const dispH = this.canvas.clientHeight || (stage.rotated ? r.width : r.height);
    return {
      x: (local.x / dispW) * W + W / 2,
      y: (local.y / dispH) * H + H / 2,
    };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.isOpen || this.over) return;
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.canvasPos(e);
    this.hammerX = p.x;
    this.hammerY = p.y;
    this.updateHighlight();
    this.hit();
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isOpen) return;
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    const p = this.canvasPos(e);
    this.hammerX = p.x;
    this.hammerY = p.y;
    this.updateHighlight();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.pointerId = null;
  };

  private updateHighlight(): void {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i];
      const d = (h.x - this.hammerX) ** 2 + (h.y - this.hammerY) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.highlight = best;
  }

  private hit(): void {
    if (this.over || this.hitCd > 0) return;
    this.hitCd = HIT_COOLDOWN;
    this.swing = 1;
    const hole = this.holes[this.highlight];
    if (hole.mole > 0 && hole.pop > 0.35) {
      this.score += 1;
      hole.mole = 0;
      hole.poppingOut = false;
      hole.pop = 0;
      this.flash = 1;
      this.flashHole = this.highlight;
      this.updateStatus();
    }
  }

  private loop = (): void => {
    if (!this.isOpen) return;
    const now = performance.now();
    const dt = Math.min(now - this.lastT, 50);
    this.lastT = now;
    this.step(dt);
    this.render();
    if (!this.over) this.raf = requestAnimationFrame(this.loop);
  };

  private step(dt: number): void {
    if (this.over) return;

    this.leftMs -= dt;
    if (this.leftMs <= 0) {
      this.leftMs = 0;
      this.over = true;
      this.finish(this.score);
      this.updateStatus();
      this.render();
      return;
    }

    if (this.hitCd > 0) this.hitCd = Math.max(0, this.hitCd - dt);
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt / 180);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt / 280);

    for (const hole of this.holes) {
      if (hole.mole > 0) {
        hole.mole -= dt;
        if (hole.mole <= 0) {
          hole.mole = 0;
          hole.poppingOut = false;
        } else if (hole.mole < POP_MS) {
          hole.poppingOut = false;
          hole.pop = hole.mole / POP_MS;
        } else if (hole.poppingOut) {
          hole.pop = Math.min(1, hole.pop + dt / POP_MS);
          if (hole.pop >= 1) hole.poppingOut = false;
        } else {
          hole.pop = 1;
        }
      } else {
        hole.pop = Math.max(0, hole.pop - dt / POP_MS);
        hole.tick -= dt;
        if (hole.tick <= 0) {
          hole.tick = rand(HOLE_TICK_MIN, HOLE_TICK_MAX);
          if (Math.random() < SPAWN_P) {
            hole.mole = rand(MOLE_UP_MIN, MOLE_UP_MAX);
            hole.poppingOut = true;
            hole.pop = 0.05;
          }
        }
      }
    }

    this.updateStatus();
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#121820";
    ctx.fillRect(0, 0, W, H);

    this.drawCabinet();
    this.drawPlayPanel();
    this.drawScoreboard();

    for (let i = 0; i < this.holes.length; i++) this.drawHole(i);
    this.drawHammer();

    if (this.over) this.drawGameOver();
  }

  private drawCabinet(): void {
    const ctx = this.ctx;
    const x = 18;
    const y = 18;
    const w = W - 36;
    const h = H - 36;

    // Внешний корпус с фаской.
    roundRect(ctx, x, y, w, h, 16);
    this.fillPattern(this.cabinetImg, "#c43c3c");
    // Светлая кромка сверху / тёмная снизу — объём корпуса.
    ctx.save();
    roundRect(ctx, x, y, w, h, 16);
    ctx.clip();
    const bevel = ctx.createLinearGradient(0, y, 0, y + h);
    bevel.addColorStop(0, "rgba(255,220,200,0.28)");
    bevel.addColorStop(0.12, "rgba(255,255,255,0.06)");
    bevel.addColorStop(0.5, "rgba(0,0,0,0)");
    bevel.addColorStop(0.88, "rgba(0,0,0,0.18)");
    bevel.addColorStop(1, "rgba(40,0,0,0.45)");
    ctx.fillStyle = bevel;
    ctx.fillRect(x, y, w, h);
    // Боковые блики.
    const side = ctx.createLinearGradient(x, 0, x + w, 0);
    side.addColorStop(0, "rgba(255,200,180,0.22)");
    side.addColorStop(0.08, "rgba(0,0,0,0)");
    side.addColorStop(0.92, "rgba(0,0,0,0)");
    side.addColorStop(1, "rgba(0,0,0,0.3)");
    ctx.fillStyle = side;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // Внутренняя тёмная рамка.
    ctx.strokeStyle = "rgba(60,10,10,0.7)";
    ctx.lineWidth = 4;
    roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 12);
    ctx.stroke();

    // Звёзды на основании, как на автомате в чилл-зоне.
    this.drawStar(70, H - 58, 14);
    this.drawStar(W - 70, H - 58, 14);
    this.drawEngraving(W / 2, H - 56, "DaData Inc.");
  }

  private drawEngraving(cx: number, cy: number, text: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 22px 'Courier New', monospace";
    // Вдавленная гравировка: светлый блик сверху-слева, тёмная борозда.
    ctx.fillStyle = "rgba(255, 210, 180, 0.35)";
    ctx.fillText(text, cx - 1, cy - 1);
    ctx.fillStyle = "rgba(40, 8, 8, 0.75)";
    ctx.fillText(text, cx + 1, cy + 1);
    ctx.fillStyle = "rgba(90, 25, 25, 0.9)";
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  private drawStar(cx: number, cy: number, r: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "#f0d24a";
    ctx.strokeStyle = "#a87820";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const b = a + Math.PI / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(b) * r * 0.42, Math.sin(b) * r * 0.42);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawPlayPanel(): void {
    const ctx = this.ctx;
    const x = BOARD_X - 18;
    const y = BOARD_Y - 28;
    const w = BOARD_W + 36;
    const h = BOARD_H + 56;

    // Приподнятая панель с деревянно-жёлтой текстурой.
    roundRect(ctx, x, y, w, h, 14);
    this.fillPattern(this.panelImg, "#e0b84a");

    ctx.save();
    roundRect(ctx, x, y, w, h, 14);
    ctx.clip();
    // Рельеф: верхний блик + нижняя тень + лёгкие «канавки».
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "rgba(255,255,230,0.35)");
    g.addColorStop(0.08, "rgba(255,255,255,0.1)");
    g.addColorStop(0.5, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(80,50,0,0.28)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = "rgba(120,80,20,0.25)";
    ctx.lineWidth = 1;
    for (let gy = y + 18; gy < y + h - 10; gy += 28) {
      ctx.beginPath();
      ctx.moveTo(x + 10, gy);
      ctx.lineTo(x + w - 10, gy);
      ctx.stroke();
    }
    ctx.restore();

    // Фаска рамки панели.
    ctx.strokeStyle = "rgba(255,240,180,0.55)";
    ctx.lineWidth = 3;
    roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 12);
    ctx.stroke();
    ctx.strokeStyle = "rgba(90,55,10,0.55)";
    ctx.lineWidth = 3;
    roundRect(ctx, x + 5, y + 5, w - 10, h - 10, 10);
    ctx.stroke();
  }

  private drawScoreboard(): void {
    const ctx = this.ctx;
    const bx = W / 2 - 78;
    const by = 26;
    // Корпус табло.
    roundRect(ctx, bx - 4, by - 4, 164, 36, 8);
    ctx.fillStyle = "#2a1810";
    ctx.fill();
    roundRect(ctx, bx, by, 156, 28, 6);
    ctx.fillStyle = "#0a100e";
    ctx.fill();
    // Зелёное свечение цифр.
    ctx.shadowColor = "#5dff7a";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#7dff8a";
    ctx.font = "bold 18px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(this.score).padStart(3, "0"), W / 2, by + 20);
    ctx.shadowBlur = 0;
  }

  private fillPattern(img: HTMLImageElement, fallback: string): void {
    const ctx = this.ctx;
    if (img.complete && img.naturalWidth > 0) {
      ctx.fillStyle = ctx.createPattern(img, "repeat") ?? fallback;
    } else {
      ctx.fillStyle = fallback;
    }
    ctx.fill();
  }

  private drawHole(i: number): void {
    const ctx = this.ctx;
    const hole = this.holes[i];
    const hi = i === this.highlight;
    const ox = hole.x;
    const oy = hole.y + 10;

    // Выступающее металлическое кольцо (рельеф вокруг лунки).
    ctx.fillStyle = "rgba(60,40,15,0.35)";
    ctx.beginPath();
    ctx.ellipse(ox + 1, oy + 3, HOLE_R + 10, HOLE_R * 0.55 + 6, 0, 0, Math.PI * 2);
    ctx.fill();

    const rim = ctx.createRadialGradient(ox - 8, oy - 6, 4, ox, oy, HOLE_R + 10);
    rim.addColorStop(0, "#d8c070");
    rim.addColorStop(0.45, "#a88840");
    rim.addColorStop(1, "#6a4e1a");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.ellipse(ox, oy, HOLE_R + 9, HOLE_R * 0.55 + 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Внутренний ободок.
    ctx.strokeStyle = "rgba(255,230,150,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(ox, oy - 1, HOLE_R + 5, HOLE_R * 0.5 + 2, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (hi) {
      ctx.strokeStyle = "#7ac07a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(ox, oy, HOLE_R + 12, HOLE_R * 0.55 + 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.flash > 0 && i === this.flashHole) {
      ctx.fillStyle = `rgba(122,192,122,${0.4 * this.flash})`;
      ctx.beginPath();
      ctx.ellipse(ox, oy, HOLE_R + 14, HOLE_R * 0.6 + 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Глубокая лунка.
    const well = ctx.createRadialGradient(ox, oy - 4, 2, ox, oy, HOLE_R);
    well.addColorStop(0, "#2a2218");
    well.addColorStop(0.55, "#0c0a08");
    well.addColorStop(1, "#050406");
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.ellipse(ox, oy, HOLE_R, HOLE_R * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (hole.pop > 0.02) this.drawMole(hole.x, hole.y, hole.pop);
  }

  private drawMole(cx: number, cy: number, pop: number): void {
    const ctx = this.ctx;
    const s = 0.8 + pop * 0.2;
    const w = MOLE_DRAW_W * s;
    const h = MOLE_DRAW_H * s;
    // Нижний край спрайта сидит на линии лунки; при pop<1 уезжает вниз (прячется).
    const holeLine = cy + 10;
    const imgBottom = holeLine + (1 - pop) * (h * 0.55);
    const imgTop = imgBottom - h;

    // Тень в лунке.
    ctx.fillStyle = `rgba(0,0,0,${0.35 * pop})`;
    ctx.beginPath();
    ctx.ellipse(cx, holeLine + 2, 22 * s, 8 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    // Режем только низ (под землёй), верх головы всегда свободен.
    ctx.beginPath();
    ctx.rect(cx - w / 2 - 8, imgTop - 8, w + 16, holeLine - (imgTop - 8));
    ctx.clip();

    if (this.moleImg.complete && this.moleImg.naturalWidth > 0) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.moleImg, cx - w / 2, imgTop, w, h);
    } else {
      ctx.fillStyle = "#8b5a2b";
      ctx.beginPath();
      ctx.ellipse(cx, imgTop + h * 0.45, 22 * s, 24 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawHammer(): void {
    const ctx = this.ctx;
    const angle = this.swing > 0 ? -0.95 * this.swing : -0.18;
    const locked = this.hitCd > 0 && this.swing <= 0;

    ctx.save();
    ctx.translate(this.hammerX, this.hammerY);
    ctx.rotate(angle);
    ctx.globalAlpha = locked ? 0.5 : 1;
    ctx.imageSmoothingEnabled = false;

    // Тень молотка.
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(4, 36, 22, 8, 0.2, 0, Math.PI * 2);
    ctx.fill();

    if (this.hammerImg.complete && this.hammerImg.naturalWidth > 0) {
      ctx.drawImage(
        this.hammerImg,
        -HAMMER_DRAW_W / 2,
        -HAMMER_DRAW_H * 0.22,
        HAMMER_DRAW_W,
        HAMMER_DRAW_H,
      );
    } else {
      ctx.fillStyle = "#6b4226";
      ctx.fillRect(-5, -8, 10, 58);
      ctx.fillStyle = "#d64545";
      roundRect(ctx, -22, -28, 44, 28, 6);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawGameOver(): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(8,10,14,0.8)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8efe6";
    ctx.font = "bold 32px 'Trebuchet MS', sans-serif";
    ctx.fillText("Время вышло!", W / 2, H / 2 - 18);
    ctx.font = "20px 'Trebuchet MS', sans-serif";
    ctx.fillText(`Результат: ${this.score}`, W / 2, H / 2 + 16);
    ctx.fillStyle = "#7ac07a";
    ctx.font = "15px 'Trebuchet MS', sans-serif";
    ctx.fillText("«Заново» — сыграть ещё раз", W / 2, H / 2 + 48);
  }

  private finish(value: number): void {
    if (this.reported) return;
    this.reported = true;
    this.onGameOver?.(value);
  }

  private updateStatus(): void {
    const sec = (this.leftMs / 1000).toFixed(1);
    this.statusEl.textContent = this.over
      ? `Очки: ${this.score}`
      : `Очки: ${this.score} · ${sec} с`;
  }
}

function digitHole(code: string): number {
  const map: Record<string, number> = {
    Digit1: 0, Numpad1: 0,
    Digit2: 1, Numpad2: 1,
    Digit3: 2, Numpad3: 2,
    Digit4: 3, Numpad4: 3,
    Digit5: 4, Numpad5: 4,
    Digit6: 5, Numpad6: 5,
    Digit7: 6, Numpad7: 6,
    Digit8: 7, Numpad8: 7,
    Digit9: 8, Numpad9: 8,
  };
  return map[code] ?? -1;
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

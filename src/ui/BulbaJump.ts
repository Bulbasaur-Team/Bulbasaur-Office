import { getSpriteImage, type SpriteKey } from "../entities/sprites";
import { publicPath } from "../publicPath";
import { screenToStage } from "./orientation";

// Логическое поле игры (px). Канвас масштабируется под экран через CSS.
const W = 420;
const H = 640;

const GRAVITY = 0.4;
const JUMP_V = -12;      // скорость отскока от платформы
const SPRING_MULT = 1.6; // усиление отскока от батута на посылке
const MOVE = 5.2;        // горизонтальная скорость
const PLAYER_H = 50;
const HALF_W = 22;       // полширины игрока для столкновений
const LAND_PAD_X = 10;   // доп. допуск по X — визуально легче «зацепиться» краем
const LAND_SLACK = 10;   // допуск по Y: ловим приземление, даже если кадр чуть проскочил верх
const PLAT_W = 68;
const PLAT_H = 16;
const GAP_MIN = 70;
const GAP_MAX = 120;
const SCROLL_LINE = H * 0.4; // выше этой линии мир едет вниз, а не игрок вверх
const STEP_MS = 1000 / 90;   // 90 тиков физики/сек — игра идёт в 1.5× быстрее базовых 60; от частоты кадров экрана не зависит
const RENDER_MS = 1000 / 60; // рисуем не чаще 60 fps — на ProMotion 120 Гц иначе двойная нагрузка с Phaser

// Бонусы как в Doodle Jump: подъём на N очков (очко = 1 px набранной высоты).
const HELI_SCORE = 3000;
const JET_SCORE = 5000;
const HELI_SPAWN = 0.008; // вероятность шапочки на платформе
const JET_SPAWN = 0.005;  // вероятность ранца (взаимоисключающе с шапочкой)
const HELI_VY = -7.5;    // постоянная скорость подъёма в полёте
const JET_VY = -10.5;
const POWER_SIZE = 28;   // размер спрайта бонуса на платформе
const FRAGILE_SPAWN = 0.05; // хрупкая платформа: ломается после первого прыжка

type PlatformType = "box" | "belt" | "fragile";
type PowerUpKind = "heli" | "jet";
interface Platform {
  x: number;
  y: number;
  type: PlatformType;
  vx: number;       // скорость для конвейера
  spring: boolean;  // батут (усиленный отскок)
  powerUp: PowerUpKind | null;
  falling: boolean; // хрупкая уже сломалась и падает
  fallVy: number;
}

// Bulba Jump — аналог Doodle Jump в антураже склада: посылки-платформы,
// ленты-конвейеры, батуты, хрупкие коробки, шапочка-вертолёт и реактивный ранец.
// Игрок — спрайт выбранного персонажа.
export class BulbaJump {
  isOpen = false;
  onClose: (() => void) | null = null;
  onGameOver: ((value: number) => void) | null = null;
  onLeaderboard: (() => void) | null = null;
  private reported = false;

  private root = document.getElementById("bulbajump")!;
  private canvas = document.getElementById("bjCanvas") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;
  private statusEl = document.getElementById("bjStatus")!;

  private sprite: HTMLImageElement | null = null;
  private heliImg = new Image();
  private jetImg = new Image();
  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;
  private faceRight = false;
  private platforms: Platform[] = [];
  private topY = 0;           // Y самой верхней платформы (без Math.min по массиву каждый тик)
  private score = 0;
  private shownScore = -1;    // что уже вывели в DOM — не трогаем textContent чаще, чем меняется целые
  private boost: { kind: PowerUpKind; startScore: number } | null = null;
  private over = false;
  private keyLeft = false;
  private keyRight = false;
  private touchLeft = false;
  private touchRight = false;
  private touches = new Map<number, "left" | "right">();
  private raf = 0;
  private lastT = 0;  // время предыдущего кадра для аккумулятора фиксированного шага
  private acc = 0;    // накопленное время, ещё не отработанное шагами физики
  private lastRenderT = 0;

  constructor() {
    this.heliImg.src = publicPath("assets/bulbajump/heli.png");
    this.jetImg.src = publicPath("assets/bulbajump/jetpack.png");
    document.getElementById("bjClose")!.onclick = () => this.close();
    document.getElementById("bjLb")!.onclick = () => this.onLeaderboard?.();
    document.getElementById("bjRestart")!.onclick = () => this.reset();
    this.root.addEventListener("pointerdown", this.onPointerDown);
    this.root.addEventListener("pointermove", this.onPointerMove);
    this.root.addEventListener("pointerup", this.onPointerUp);
    this.root.addEventListener("pointercancel", this.onPointerUp);
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // Тач: левая половина экрана (в координатах сцены) — влево, правая — вправо.
  // Кнопки UI не перехватываем.
  private onPointerDown = (e: PointerEvent): void => {
    if (!this.isOpen || this.over) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest("button")) return;
    e.preventDefault();
    this.touches.set(e.pointerId, this.sideFromClient(e.clientX, e.clientY));
    this.root.setPointerCapture?.(e.pointerId);
    this.syncTouch();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.touches.has(e.pointerId)) return;
    e.preventDefault();
    this.touches.set(e.pointerId, this.sideFromClient(e.clientX, e.clientY));
    this.syncTouch();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.delete(e.pointerId);
    this.syncTouch();
  };

  private sideFromClient(clientX: number, clientY: number): "left" | "right" {
    const local = screenToStage(
      clientX - window.innerWidth / 2,
      clientY - window.innerHeight / 2,
    );
    return local.x < 0 ? "left" : "right";
  }

  private syncTouch(): void {
    let left = false;
    let right = false;
    for (const side of this.touches.values()) {
      if (side === "left") left = true;
      else right = true;
    }
    this.touchLeft = left;
    this.touchRight = right;
  }

  // Реальное время: игре нужно состояние «зажато/отпущено», поэтому свои
  // keydown/keyup живут только пока окно открыто (вне общего KeyboardRouter).
  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      this.keyLeft = true;
      e.preventDefault();
    } else if (e.code === "ArrowRight" || e.code === "KeyD") {
      this.keyRight = true;
      e.preventDefault();
    } else if (this.over && (e.code === "Enter" || e.code === "Space")) {
      e.preventDefault();
      this.reset();
    } else if (e.code === "Escape") {
      this.close();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") this.keyLeft = false;
    else if (e.code === "ArrowRight" || e.code === "KeyD") this.keyRight = false;
  };

  open(spriteKey: SpriteKey): void {
    this.sprite = getSpriteImage(spriteKey);
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.reset();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.touches.clear();
    this.syncTouch();
    this.keyLeft = this.keyRight = false;
    this.root.classList.add("hidden");
    this.onClose?.();
  }

  private reset(): void {
    this.score = 0;
    this.shownScore = -1;
    this.boost = null;
    this.over = false;
    this.reported = false;
    this.keyLeft = this.keyRight = false;
    this.touches.clear();
    this.syncTouch();
    this.px = W / 2;
    this.py = H - 90;
    this.vx = 0;
    this.vy = JUMP_V;
    this.faceRight = false;

    // Стартовая платформа точно под игроком + заполняем поле вверх.
    this.platforms = [{
      x: W / 2 - PLAT_W / 2, y: H - 50, type: "box", vx: 0,
      spring: false, powerUp: null, falling: false, fallVy: 0,
    }];
    this.topY = H - 50;
    while (this.topY > 0) {
      this.topY -= GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);
      this.platforms.push(this.makePlatform(this.topY));
    }

    this.updateStatus();
    this.lastT = performance.now();
    this.lastRenderT = 0;
    this.acc = 0;
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  private makePlatform(y: number): Platform {
    const kindRoll = Math.random();
    const belt = kindRoll < 0.22;
    const fragile = !belt && kindRoll < 0.22 + FRAGILE_SPAWN;
    const spring = !belt && !fragile && Math.random() < 0.14;
    // Бонус не ставим на батут и хрупкую — иначе визуально и по геймплею мешаются.
    let powerUp: PowerUpKind | null = null;
    if (!spring && !fragile) {
      const roll = Math.random();
      if (roll < JET_SPAWN) powerUp = "jet";
      else if (roll < JET_SPAWN + HELI_SPAWN) powerUp = "heli";
    }
    return {
      x: Math.random() * (W - PLAT_W),
      y,
      type: belt ? "belt" : fragile ? "fragile" : "box",
      vx: belt ? (Math.random() < 0.5 ? -1.5 : 1.5) : 0,
      spring,
      powerUp,
      falling: false,
      fallVy: 0,
    };
  }

  private loop = (): void => {
    if (!this.isOpen) return;
    const now = performance.now();
    let dt = now - this.lastT;
    this.lastT = now;
    if (dt > 100) dt = 100; // после сворачивания/лага не навёрстываем лавину шагов
    this.acc += dt;
    while (this.acc >= STEP_MS) {
      this.step();
      this.acc -= STEP_MS;
      if (this.over) break;
    }
    // Физика 90 Hz, отрисовка ≤60 Hz — меньше работы на 120 Гц дисплеях.
    if (this.over || now - this.lastRenderT >= RENDER_MS) {
      this.lastRenderT = now;
      this.render();
    }
    if (!this.over) this.raf = requestAnimationFrame(this.loop);
  };

  private step(): void {
    if (this.over) return;

    this.vx = (this.keyRight || this.touchRight ? MOVE : 0) - (this.keyLeft || this.touchLeft ? MOVE : 0);
    if (this.vx !== 0) this.faceRight = this.vx > 0;
    this.px += this.vx;
    // Обёртка по краям экрана, как в Doodle Jump.
    if (this.px < -HALF_W) this.px = W + HALF_W;
    else if (this.px > W + HALF_W) this.px = -HALF_W;

    for (const p of this.platforms) {
      if (p.type === "belt" && !p.falling) {
        p.x += p.vx;
        if (p.x < 0 || p.x > W - PLAT_W) p.vx *= -1;
      }
      if (p.falling) {
        p.fallVy += GRAVITY;
        p.y += p.fallVy;
      }
    }

    // Подбор бонуса: касание зоны над платформой.
    if (!this.boost) {
      for (const p of this.platforms) {
        if (!p.powerUp || p.falling) continue;
        const cx = p.x + PLAT_W / 2;
        const cy = p.y - POWER_SIZE / 2 - 2;
        const hit =
          Math.abs(this.px - cx) < HALF_W + POWER_SIZE / 2 &&
          Math.abs(this.py - cy) < PLAYER_H / 2 + POWER_SIZE / 2;
        if (hit) {
          this.boost = { kind: p.powerUp, startScore: this.score };
          p.powerUp = null;
          break;
        }
      }
    }

    if (this.boost) {
      const need = this.boost.kind === "heli" ? HELI_SCORE : JET_SCORE;
      if (this.score - this.boost.startScore >= need) {
        this.boost = null;
        this.vy = JUMP_V * 0.35; // мягкий выход из полёта
      } else {
        this.vy = this.boost.kind === "heli" ? HELI_VY : JET_VY;
      }
    } else {
      this.vy += GRAVITY;
    }

    const prevFeet = this.py + PLAYER_H / 2;
    this.py += this.vy;
    const feet = this.py + PLAYER_H / 2;

    // Приземление только без полёта, при падении.
    // Допуски по X/Y — иначе визуально уже на платформе, а хитбокс не цепляет.
    if (!this.boost && this.vy > 0) {
      for (const p of this.platforms) {
        if (p.falling) continue;
        const overX =
          this.px + HALF_W + LAND_PAD_X > p.x &&
          this.px - HALF_W - LAND_PAD_X < p.x + PLAT_W;
        if (overX && prevFeet <= p.y + LAND_SLACK && feet >= p.y) {
          this.py = p.y - PLAYER_H / 2;
          this.vy = JUMP_V * (p.spring ? SPRING_MULT : 1);
          if (p.type === "fragile") {
            p.falling = true;
            p.fallVy = 1.2;
            p.powerUp = null;
          }
          break;
        }
      }
    }

    // Игрок поднялся выше линии — двигаем мир вниз, досыпаем платформы сверху.
    if (this.py < SCROLL_LINE) {
      const dy = SCROLL_LINE - this.py;
      this.py = SCROLL_LINE;
      this.score += dy;
      this.updateStatus();
      this.topY += dy;
      // Сдвиг и выкидывание ниже экрана без filter/map (меньше GC на 90 Hz).
      let write = 0;
      for (let i = 0; i < this.platforms.length; i++) {
        const p = this.platforms[i];
        p.y += dy;
        if (p.y < H + PLAT_H) this.platforms[write++] = p;
      }
      this.platforms.length = write;
      while (this.topY > 0) {
        this.topY -= GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);
        this.platforms.push(this.makePlatform(this.topY));
      }
    }

    // Упал ниже экрана — конец.
    if (this.py > H + PLAYER_H) {
      this.over = true;
      this.touches.clear();
      this.syncTouch();
      this.finish(Math.floor(this.score));
    }
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#0e1620";
    ctx.fillRect(0, 0, W, H);

    // Полки склада — горизонтальные линии с лёгким параллаксом по счёту.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    for (let y = (this.score * 6) % 56; y < H; y += 56) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    for (const p of this.platforms) this.drawPlatform(p);
    this.drawPlayer();
    if (this.over) this.drawGameOver();
  }

  private drawPlatform(p: Platform): void {
    const ctx = this.ctx;
    if (p.type === "belt") {
      ctx.fillStyle = "#2f343c";
      ctx.fillRect(p.x, p.y, PLAT_W, PLAT_H);
      ctx.fillStyle = "#7ac07a";
      ctx.fillRect(p.x, p.y, PLAT_W, 3); // активная кромка ленты
      ctx.fillStyle = "#565d68";
      // Ролики ленты — квадраты вместо arc() (дешевле на canvas 2d).
      for (let rx = p.x + 6; rx < p.x + PLAT_W - 2; rx += 14) {
        ctx.fillRect(rx - 2, p.y + PLAT_H - 7, 4, 4);
      }
    } else if (p.type === "fragile") {
      // Хрупкая посылка: бледнее обычной, с трещинами — ломается с первого прыжка.
      const alpha = p.falling ? 0.55 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#d8c9a6";
      ctx.fillRect(p.x, p.y, PLAT_W, PLAT_H);
      ctx.strokeStyle = "#a89068";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 1, p.y + 1, PLAT_W - 2, PLAT_H - 2);
      ctx.fillStyle = "#c4a45a"; // предупреждающая полоска «хрупкое»
      ctx.fillRect(p.x + 4, p.y + 5, PLAT_W - 8, 3);
      ctx.strokeStyle = "#7a6550";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x + 12, p.y + 2);
      ctx.lineTo(p.x + 28, p.y + PLAT_H - 2);
      ctx.lineTo(p.x + 40, p.y + 4);
      ctx.lineTo(p.x + 56, p.y + PLAT_H - 3);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = "#c8965a";
      ctx.fillRect(p.x, p.y, PLAT_W, PLAT_H);
      ctx.strokeStyle = "#8a6332";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 1, p.y + 1, PLAT_W - 2, PLAT_H - 2);
      ctx.fillStyle = "#efe2c0"; // скотч крест-накрест
      ctx.fillRect(p.x + PLAT_W / 2 - 5, p.y, 10, PLAT_H);
    }
    if (p.spring) {
      ctx.fillStyle = "#7ac07a";
      ctx.fillRect(p.x + PLAT_W / 2 - 8, p.y - 7, 16, 7);
      ctx.fillStyle = "#5aa05a";
      ctx.fillRect(p.x + PLAT_W / 2 - 8, p.y - 3, 16, 3);
    }
    if (p.powerUp && !p.falling) this.drawPowerUp(p.x + PLAT_W / 2, p.y - 2, p.powerUp, POWER_SIZE);
  }

  private powerImg(kind: PowerUpKind): HTMLImageElement {
    return kind === "heli" ? this.heliImg : this.jetImg;
  }

  private drawPowerUp(cx: number, bottomY: number, kind: PowerUpKind, size: number): void {
    const img = this.powerImg(kind);
    const ctx = this.ctx;
    const x = cx - size / 2;
    const y = bottomY - size;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x, y, size, size);
    } else {
      // Заглушка, пока PNG грузится.
      ctx.fillStyle = kind === "heli" ? "#e86a8a" : "#3aa8a0";
      ctx.fillRect(x + 4, y + 4, size - 8, size - 8);
    }
    ctx.restore();
  }

  private drawPlayer(): void {
    if (!this.sprite) return;
    const ctx = this.ctx;
    const h = PLAYER_H;
    const w = this.sprite.height ? (this.sprite.width / this.sprite.height) * h : h;
    const y = this.py - h / 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // Спрайт по умолчанию смотрит влево; вправо — отзеркаливаем.
    // Ранец (+пламя) — до игрока (позади), шапочка — после (поверх головы).
    if (this.faceRight) {
      ctx.translate(this.px, 0);
      ctx.scale(-1, 1);
      if (this.boost?.kind === "jet") this.drawJetpackBehind(0, y, w, h);
      ctx.drawImage(this.sprite, -w / 2, y, w, h);
      if (this.boost?.kind === "heli") this.drawHeliHat(0, y);
    } else {
      if (this.boost?.kind === "jet") this.drawJetpackBehind(this.px, y, w, h);
      ctx.drawImage(this.sprite, this.px - w / 2, y, w, h);
      if (this.boost?.kind === "heli") this.drawHeliHat(this.px, y);
    }
    ctx.restore();

    if (this.boost?.kind === "heli") this.drawHeliFx();
  }

  private drawJetpackBehind(originX: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const t = performance.now();
    const flicker = 18 + (Math.sin(t / 35) + 1) * 12; // ×3 к исходной длине пламени
    const packY = y + h * 0.12; // чуть выше, чем раньше (было 0.22)
    const packX = originX + w * 0.28;
    // Пламя тоже позади персонажа, под ранцем.
    ctx.fillStyle = "#ffb040";
    ctx.fillRect(packX - 10, packY + 18, 7, flicker);
    ctx.fillRect(packX + 3, packY + 18, 7, flicker * 0.85);
    ctx.fillStyle = "#fff0a0";
    ctx.fillRect(packX - 8, packY + 18, 3, flicker * 0.55);
    ctx.fillRect(packX + 5, packY + 18, 3, flicker * 0.5);

    const img = this.jetImg;
    if (!(img.complete && img.naturalWidth > 0)) return;
    const size = 24;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    // Локально справа от центра: спрайт смотрит влево — ранец за спиной.
    ctx.drawImage(img, packX - size / 2, packY, size, size);
    ctx.restore();
  }

  private drawHeliHat(originX: number, y: number): void {
    const img = this.heliImg;
    if (!(img.complete && img.naturalWidth > 0)) return;
    const size = 26;
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    const bob = Math.sin(performance.now() / 60) * 0.25;
    ctx.translate(originX, y + 4);
    ctx.rotate(bob);
    ctx.drawImage(img, -size / 2, -size + 2, size, size);
    ctx.restore();
  }

  private drawHeliFx(): void {
    const ctx = this.ctx;
    const ang = (performance.now() / 40) % (Math.PI * 2);
    ctx.save();
    ctx.translate(this.px, this.py - PLAYER_H / 2 - 10);
    ctx.rotate(ang);
    ctx.strokeStyle = "rgba(255, 210, 80, 0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(14, 0);
    ctx.stroke();
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(14, 0);
    ctx.stroke();
    ctx.restore();
  }

  private drawGameOver(): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(8,10,14,0.8)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8efe6";
    ctx.font = "bold 32px 'Trebuchet MS', sans-serif";
    ctx.fillText(`Результат: ${Math.floor(this.score)}`, W / 2, H / 2 + 16);
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
    const n = Math.floor(this.score);
    if (n === this.shownScore) return;
    this.shownScore = n;
    this.statusEl.textContent = `Результат: ${n}`;
  }
}

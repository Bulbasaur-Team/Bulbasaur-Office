import { defaultAppearance, type PlayerAppearance } from "../data/wardrobe";
import { composeAppearanceCanvas, loadWardrobeDomImages } from "../entities/PlayerAvatar";
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
const ROCKET_SCORE = 10000;
const HELI_SPAWN = 0.008; // вероятность шапочки на платформе
const JET_SPAWN = 0.005;  // вероятность ранца (взаимоисключающе с шапочкой и ракетой)
const ROCKET_SPAWN = JET_SPAWN / 2; // ракета вдвое реже ранца
const HELI_VY = -7.5;    // постоянная скорость подъёма в полёте
const JET_VY = -10.5;
const ROCKET_VY = JET_VY * 2; // ракета летит вверх вдвое быстрее ранца
const POWER_SIZE = 28;   // размер спрайта бонуса на платформе
const FRAGILE_SPAWN = 0.05; // хрупкая платформа: ломается после двух прыжков
const MOVER_SPAWN = FRAGILE_SPAWN; // подвижные платформы — примерно так же редки
const MOVER_AMP = 26;    // амплитуда хода вверх-вниз, px
const MOVER_OMEGA = (Math.PI * 2) / (1.7 * 90); // полный цикл ~1.7 с при скорости 1×
const FRAGILE_HITS = 2;     // сколько приземлений выдерживает до исчезновения
const SAFETY_GAP = 28;      // отступ страховочной платформы под ногами после бонуса

// Скорость игры: прежняя физика (шаг 90 Гц) — это 1×.
// Отметки шкалы 0.75×…1.25×, каждую минуту плавно +0.1×.
// На игру отметка умножается на 1.12: фактически 0.84×…1.40×.
const SPEED_MARK_MIN = 0.75;
const SPEED_MARK_MAX = 1.25;
const SPEED_FACTOR = 1.12;
const SPEED_STEP = 0.1;
const SPEED_STEP_MS = 60_000;

// Ракета в полёте. Ноль — центр иллюминатора (там же центр игрока).
const ROCKET_WINDOW_R = 28;
const R_NOSE = -96;
const R_SHOULDER = -46;
const R_HALF = 36;
const R_BODY_BOT = 52;
const R_NOZZLE_BOT = 66;
const R_NOZZLE_HALF = 11;
const R_FIN_OUTER = 54;
const R_FIN_TOP = 18;
const R_FIN_BOT = 62;
const ROCKET_LOCAL_H = R_NOZZLE_BOT - R_NOSE;
// В зазоре между платформами свободно ~GAP_MIN − PLAT_H. Пикап ниже этого, чтобы не втыкаться в потолок.
const ROCKET_PICKUP_H = 50;
const ROCKET_PICKUP_SCALE = ROCKET_PICKUP_H / ROCKET_LOCAL_H;
const ROCKET_PICKUP_W = R_FIN_OUTER * 2 * ROCKET_PICKUP_SCALE;

type PlatformType = "box" | "belt" | "fragile" | "safety" | "mover";
type PowerUpKind = "heli" | "jet" | "rocket";
interface Platform {
  x: number;
  y: number;
  w: number;        // ширина (у safety — на весь экран)
  type: PlatformType;
  vx: number;       // скорость для конвейера
  spring: boolean;  // батут (усиленный отскок)
  powerUp: PowerUpKind | null;
  hits: number;     // сколько раз уже приземлялись (для fragile: 0 — малая трещина, 1 — большая)
  falling: boolean; // хрупкая уже сломалась и падает
  fallVy: number;
  anchorY: number;  // центр вертикального хода; у остальных совпадает с y и едет вместе с миром
  movePhase: number;
}

// Bulba Jump — аналог Doodle Jump в антураже склада: посылки-платформы,
// ленты-конвейеры, батуты, хрупкие коробки, лифты, шапочка-вертолёт,
// реактивный ранец и ракета. Игрок — текущий аватар с одеждой из гардероба.
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
  private speedValEl = document.getElementById("bjSpeedVal")!;
  private speedThumbEl = document.getElementById("bjSpeedThumb")!;
  private speedMeterEl = document.getElementById("bjSpeed")!;
  private heliBtn = document.getElementById("bjHeli") as HTMLButtonElement;

  private wardrobeImages: Map<string, HTMLImageElement> | null = null;
  private sprite: HTMLCanvasElement | null = null;
  private heliImg = new Image();
  private jetImg = new Image();
  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;
  private faceRight = false;
  private platforms: Platform[] = [];
  private topY = 0;           // Y самой верхней платформы (без Math.min по массиву каждый тик)
  private topIsMover = false; // верхняя платформа — лифт: следующему зазору нужен запас на амплитуду
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
  private runMs = 0;          // реальное время забега, по нему растёт отметка шкалы
  private speedMark = SPEED_MARK_MIN;
  private speed = SPEED_MARK_MIN * SPEED_FACTOR;
  private shownSpeedLabel = "";
  private freeHeliUsed = false;
  constructor() {
    this.heliImg.src = publicPath("assets/bulbajump/heli.png");
    this.jetImg.src = publicPath("assets/bulbajump/jetpack.png");
    this.speedMeterEl.setAttribute("aria-valuemin", String(SPEED_MARK_MIN));
    this.speedMeterEl.setAttribute("aria-valuemax", String(SPEED_MARK_MAX));
    document.getElementById("bjSpeedMin")!.textContent = formatSpeed(SPEED_MARK_MIN);
    document.getElementById("bjSpeedMax")!.textContent = formatSpeed(SPEED_MARK_MAX);
    document.getElementById("bjClose")!.onclick = () => this.close();
    document.getElementById("bjLb")!.onclick = () => this.onLeaderboard?.();
    this.heliBtn.onclick = () => this.useFreeHeli();
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
    } else if (e.code === "Enter") {
      e.preventDefault();
      if (this.over) this.reset();
      else this.useFreeHeli();
    } else if (this.over && e.code === "Space") {
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

  async open(appearance: PlayerAppearance = defaultAppearance()): Promise<void> {
    if (!this.wardrobeImages) this.wardrobeImages = await loadWardrobeDomImages();
    this.sprite = composeAppearanceCanvas(appearance, this.wardrobeImages);
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    cancelAnimationFrame(this.raf);
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
    this.freeHeliUsed = false;
    this.over = false;
    this.runMs = 0;
    this.speedMark = SPEED_MARK_MIN;
    this.speed = SPEED_MARK_MIN * SPEED_FACTOR;
    this.shownSpeedLabel = "";
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
      x: W / 2 - PLAT_W / 2, y: H - 50, w: PLAT_W, type: "box", vx: 0,
      spring: false, powerUp: null, hits: 0, falling: false, fallVy: 0,
      anchorY: H - 50, movePhase: 0,
    }];
    this.topY = H - 50;
    this.topIsMover = false;
    while (this.topY > 0) this.spawnNext();

    this.updateStatus();
    this.syncHeliBtn();
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
    const mover = !belt && !fragile && kindRoll < 0.22 + FRAGILE_SPAWN + MOVER_SPAWN;
    const spring = !belt && !fragile && !mover && Math.random() < 0.14;
    // Бонус не ставим на батут и хрупкую — иначе визуально и по геймплею мешаются.
    let powerUp: PowerUpKind | null = null;
    if (!spring && !fragile) {
      const roll = Math.random();
      if (roll < ROCKET_SPAWN) powerUp = "rocket";
      else if (roll < ROCKET_SPAWN + JET_SPAWN) powerUp = "jet";
      else if (roll < ROCKET_SPAWN + JET_SPAWN + HELI_SPAWN) powerUp = "heli";
    }
    return {
      x: Math.random() * (W - PLAT_W),
      y,
      w: PLAT_W,
      type: belt ? "belt" : fragile ? "fragile" : mover ? "mover" : "box",
      vx: belt ? (Math.random() < 0.5 ? -1.5 : 1.5) : 0,
      spring,
      powerUp,
      hits: 0,
      falling: false,
      fallVy: 0,
      anchorY: y,
      movePhase: mover ? Math.random() * Math.PI * 2 : 0,
    };
  }

  // Следующая платформа выше верхней. Лифту оставляем запас, чтобы ход вниз не съел зазор.
  private spawnNext(): void {
    let gap = GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);
    if (this.topIsMover) gap += MOVER_AMP;
    this.topY -= gap;
    const platform = this.makePlatform(this.topY);
    if (platform.type === "mover") {
      this.topY -= MOVER_AMP;
      platform.anchorY = this.topY;
      platform.y = this.topY + Math.sin(platform.movePhase) * MOVER_AMP;
      this.topIsMover = true;
    } else {
      this.topIsMover = false;
    }
    this.platforms.push(platform);
  }

  // После шапочки, ранца или ракеты — широкая платформа прямо под ногами, чтобы не упасть в пустоту.
  private spawnSafetyPlatform(): void {
    this.platforms.push({
      x: 0,
      y: this.py + PLAYER_H / 2 + SAFETY_GAP,
      w: W,
      type: "safety",
      vx: 0,
      spring: false,
      powerUp: null,
      hits: 0,
      falling: false,
      fallVy: 0,
      anchorY: this.py + PLAYER_H / 2 + SAFETY_GAP,
      movePhase: 0,
    });
  }

  private loop = (): void => {
    if (!this.isOpen) return;
    const now = performance.now();
    let dt = now - this.lastT;
    this.lastT = now;
    if (dt > 100) dt = 100; // после сворачивания/лага не навёрстываем лавину шагов
    if (!this.over) {
      this.runMs += dt;
      const grown = SPEED_MARK_MIN + SPEED_STEP * (this.runMs / SPEED_STEP_MS);
      this.speedMark = grown > SPEED_MARK_MAX ? SPEED_MARK_MAX : grown;
      this.speed = this.speedMark * SPEED_FACTOR;
    }
    // Множитель крутит ту же физику: 1× — прежний темп. Отметки 0.75×…1.25×, фактически ×1.12.
    this.acc += dt;
    const stepMs = STEP_MS / this.speed;
    while (this.acc >= stepMs) {
      this.step();
      this.acc -= stepMs;
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
      if (p.type === "mover") {
        p.movePhase += MOVER_OMEGA;
        p.y = p.anchorY + Math.sin(p.movePhase) * MOVER_AMP;
      } else if (p.type === "belt" && !p.falling) {
        p.x += p.vx;
        if (p.x < 0 || p.x > W - p.w) p.vx *= -1;
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
        const rocket = p.powerUp === "rocket";
        const hw = rocket ? ROCKET_PICKUP_W / 2 : POWER_SIZE / 2;
        const hh = rocket ? ROCKET_PICKUP_H / 2 : POWER_SIZE / 2;
        const cx = p.x + p.w / 2;
        const cy = p.y - hh - 2;
        const hit =
          Math.abs(this.px - cx) < HALF_W + hw &&
          Math.abs(this.py - cy) < PLAYER_H / 2 + hh;
        if (hit) {
          this.grantBoost(p.powerUp);
          p.powerUp = null;
          break;
        }
      }
    }

    if (this.boost) {
      const need = boostScore(this.boost.kind);
      if (this.score - this.boost.startScore >= need) {
        this.boost = null;
        this.vy = JUMP_V * 0.35; // мягкий выход из полёта
        this.spawnSafetyPlatform();
      } else {
        this.vy = boostVy(this.boost.kind);
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
          this.px - HALF_W - LAND_PAD_X < p.x + p.w;
        if (overX && prevFeet <= p.y + LAND_SLACK && feet >= p.y) {
          this.py = p.y - PLAYER_H / 2;
          this.vy = JUMP_V * (p.spring ? SPRING_MULT : 1);
          if (p.type === "fragile") {
            p.hits += 1;
            if (p.hits >= FRAGILE_HITS) {
              p.falling = true;
              p.fallVy = 1.2;
              p.powerUp = null;
            }
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
        p.anchorY += dy;
        // Лифт прячем, только когда вся амплитуда ушла под экран — иначе он моргнёт и пропадёт.
        const low = p.type === "mover" ? p.anchorY - MOVER_AMP : p.y;
        if (low < H + PLAT_H) this.platforms[write++] = p;
      }
      this.platforms.length = write;
      while (this.topY > 0) this.spawnNext();
    }

    // Упал ниже экрана — конец.
    if (this.py > H + PLAYER_H) {
      this.over = true;
      this.touches.clear();
      this.syncTouch();
      this.finish(Math.floor(this.score));
      this.syncHeliBtn();
    }
  }

  // Один раз за забег: та же шапочка, что лежит на платформе.
  // Пока уже летишь — не тратим заряд, иначе полёт просто оборвётся или обновится.
  private useFreeHeli(): void {
    if (!this.isOpen || this.over || this.freeHeliUsed || this.boost) return;
    this.freeHeliUsed = true;
    this.grantBoost("heli");
    this.syncHeliBtn();
  }

  private grantBoost(kind: PowerUpKind): void {
    this.boost = { kind, startScore: this.score };
  }

  private syncHeliBtn(): void {
    const used = this.freeHeliUsed;
    this.heliBtn.disabled = used || this.over;
    const label = used
      ? "Шапочка уже использована в этой игре"
      : "Бесплатная шапочка-вертолёт — один раз за игру, Enter";
    this.heliBtn.title = label;
    this.heliBtn.setAttribute("aria-label", label);
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
    this.syncSpeedHud();
  }

  private drawPlatform(p: Platform): void {
    const ctx = this.ctx;
    const pw = p.w;
    if (p.type === "belt") {
      ctx.fillStyle = "#2f343c";
      ctx.fillRect(p.x, p.y, pw, PLAT_H);
      ctx.fillStyle = "#7ac07a";
      ctx.fillRect(p.x, p.y, pw, 3); // активная кромка ленты
      ctx.fillStyle = "#565d68";
      // Ролики ленты — квадраты вместо arc() (дешевле на canvas 2d).
      for (let rx = p.x + 6; rx < p.x + pw - 2; rx += 14) {
        ctx.fillRect(rx - 2, p.y + PLAT_H - 7, 4, 4);
      }
    } else if (p.type === "fragile") {
      // Хрупкая посылка: малая трещина → после 1-го прыжка большая → после 2-го падает.
      const cracked = p.hits >= 1;
      const alpha = p.falling ? 0.55 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = cracked ? "#cbb896" : "#d8c9a6";
      ctx.fillRect(p.x, p.y, pw, PLAT_H);
      ctx.strokeStyle = "#a89068";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 1, p.y + 1, pw - 2, PLAT_H - 2);
      ctx.fillStyle = "#c4a45a"; // предупреждающая полоска «хрупкое»
      ctx.fillRect(p.x + 4, p.y + 5, pw - 8, 3);
      ctx.strokeStyle = cracked ? "#5c4a38" : "#7a6550";
      ctx.lineWidth = cracked ? 2 : 1.2;
      ctx.beginPath();
      if (cracked) {
        // Большая трещина: зигзаг через всю платформу + боковые ответвления.
        ctx.moveTo(p.x + 8, p.y + 2);
        ctx.lineTo(p.x + 22, p.y + PLAT_H - 2);
        ctx.lineTo(p.x + 34, p.y + 3);
        ctx.lineTo(p.x + 48, p.y + PLAT_H - 3);
        ctx.lineTo(p.x + 60, p.y + 4);
        ctx.moveTo(p.x + 22, p.y + PLAT_H - 2);
        ctx.lineTo(p.x + 18, p.y + PLAT_H - 1);
        ctx.moveTo(p.x + 34, p.y + 3);
        ctx.lineTo(p.x + 38, p.y + 1);
        ctx.moveTo(p.x + 48, p.y + PLAT_H - 3);
        ctx.lineTo(p.x + 52, p.y + PLAT_H - 1);
      } else {
        // Небольшая трещина по центру.
        ctx.moveTo(p.x + 24, p.y + 3);
        ctx.lineTo(p.x + 32, p.y + PLAT_H - 4);
        ctx.lineTo(p.x + 42, p.y + 5);
      }
      ctx.stroke();
      ctx.restore();
    } else if (p.type === "safety") {
      // Страховочная сетка на всю ширину — после шапочки, ранца или ракеты.
      ctx.fillStyle = "#2a3d34";
      ctx.fillRect(p.x, p.y, pw, PLAT_H);
      ctx.fillStyle = "#7ac07a";
      ctx.fillRect(p.x, p.y, pw, 3);
      ctx.strokeStyle = "#5a8a6a";
      ctx.lineWidth = 1.2;
      for (let rx = p.x + 10; rx < p.x + pw; rx += 18) {
        ctx.beginPath();
        ctx.moveTo(rx, p.y + 3);
        ctx.lineTo(rx - 8, p.y + PLAT_H - 1);
        ctx.stroke();
      }
      ctx.strokeStyle = "#4a7058";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + PLAT_H / 2);
      ctx.lineTo(p.x + pw, p.y + PLAT_H / 2);
      ctx.stroke();
    } else if (p.type === "mover") {
      this.drawMover(p);
    } else {
      ctx.fillStyle = "#c8965a";
      ctx.fillRect(p.x, p.y, pw, PLAT_H);
      ctx.strokeStyle = "#8a6332";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 1, p.y + 1, pw - 2, PLAT_H - 2);
      ctx.fillStyle = "#efe2c0"; // скотч крест-накрест
      ctx.fillRect(p.x + pw / 2 - 5, p.y, 10, PLAT_H);
    }
    if (p.spring) {
      ctx.fillStyle = "#7ac07a";
      ctx.fillRect(p.x + pw / 2 - 8, p.y - 7, 16, 7);
      ctx.fillStyle = "#5aa05a";
      ctx.fillRect(p.x + pw / 2 - 8, p.y - 3, 16, 3);
    }
    if (p.powerUp && !p.falling) this.drawPowerUp(p.x + pw / 2, p.y - 2, p.powerUp, POWER_SIZE);
  }

  private powerImg(kind: Exclude<PowerUpKind, "rocket">): HTMLImageElement {
    return kind === "heli" ? this.heliImg : this.jetImg;
  }

  private drawPowerUp(cx: number, bottomY: number, kind: PowerUpKind, size: number): void {
    if (kind === "rocket") {
      this.drawRocketPickup(cx, bottomY);
      return;
    }
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
    if (this.boost?.kind === "rocket") {
      this.drawRocketFlight();
      return;
    }
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

  private drawMover(p: Platform): void {
    const ctx = this.ctx;
    const top = p.anchorY - MOVER_AMP;
    const bot = p.anchorY + MOVER_AMP + PLAT_H;
    const left = p.x + 7;
    const right = p.x + p.w - 7;
    ctx.save();
    ctx.strokeStyle = "rgba(176, 206, 222, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bot);
    ctx.moveTo(right, top);
    ctx.lineTo(right, bot);
    ctx.moveTo(left - 4, top);
    ctx.lineTo(left + 4, top);
    ctx.moveTo(right - 4, top);
    ctx.lineTo(right + 4, top);
    ctx.moveTo(left - 4, bot);
    ctx.lineTo(left + 4, bot);
    ctx.moveTo(right - 4, bot);
    ctx.lineTo(right + 4, bot);
    ctx.stroke();

    ctx.fillStyle = "#5d8eae";
    ctx.fillRect(p.x, p.y, p.w, PLAT_H);
    ctx.strokeStyle = "#2a5168";
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, PLAT_H - 2);
    ctx.fillStyle = "#c5e4f4";
    ctx.fillRect(p.x, p.y, p.w, 3);

    const down = Math.cos(p.movePhase) > 0;
    const mid = p.x + p.w / 2;
    ctx.fillStyle = "#f4fbff";
    ctx.beginPath();
    if (down) {
      ctx.moveTo(mid - 7, p.y + 5);
      ctx.lineTo(mid + 7, p.y + 5);
      ctx.lineTo(mid, p.y + 12);
    } else {
      ctx.moveTo(mid - 7, p.y + 11);
      ctx.lineTo(mid + 7, p.y + 11);
      ctx.lineTo(mid, p.y + 4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawRocketPickup(cx: number, bottomY: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, bottomY - R_NOZZLE_BOT * ROCKET_PICKUP_SCALE);
    ctx.scale(ROCKET_PICKUP_SCALE, ROCKET_PICKUP_SCALE);
    this.paintRocketShell(ctx);
    this.paintRocketWindow(ctx);
    ctx.restore();
  }

  private drawRocketFlight(): void {
    const sprite = this.sprite;
    if (!sprite) return;
    const ctx = this.ctx;
    const h = PLAYER_H;
    const w = sprite.height ? (sprite.width / sprite.height) * h : h;
    const top = this.py - h / 2;

    this.drawRocketFlame(this.px, this.py + R_NOZZLE_BOT - 3);

    ctx.save();
    ctx.translate(this.px, this.py);
    this.paintRocketShell(ctx);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.px, this.py, ROCKET_WINDOW_R - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    if (this.faceRight) {
      ctx.translate(this.px, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(sprite, -w / 2, top, w, h);
    } else {
      ctx.drawImage(sprite, this.px - w / 2, top, w, h);
    }
    ctx.restore();

    ctx.save();
    ctx.translate(this.px, this.py);
    this.paintRocketWindow(ctx);
    ctx.restore();
  }

  private drawRocketFlame(cx: number, top: number): void {
    const ctx = this.ctx;
    const t = performance.now();
    const tongues = [
      { x: -11, w: 13, ph: 0 },
      { x: 0, w: 18, ph: 1.7 },
      { x: 11, w: 13, ph: 3.2 },
    ];
    for (const tongue of tongues) {
      const sway = Math.sin(t / 80 + tongue.ph) * 3.5;
      const len = 28 + Math.sin(t / 42 + tongue.ph) * 14 + (Math.sin(t / 17 + tongue.ph * 2) + 1) * 9;
      const x = cx + tongue.x + sway;
      ctx.fillStyle = "#ff7418";
      ctx.beginPath();
      ctx.moveTo(x - tongue.w / 2, top);
      ctx.lineTo(x + tongue.w / 2, top);
      ctx.lineTo(x + sway * 0.35, top + len);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffc14a";
      ctx.beginPath();
      ctx.moveTo(x - tongue.w / 4, top);
      ctx.lineTo(x + tongue.w / 4, top);
      ctx.lineTo(x + sway * 0.15, top + len * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff6c4";
      ctx.beginPath();
      ctx.moveTo(x - 2.2, top);
      ctx.lineTo(x + 2.2, top);
      ctx.lineTo(x, top + len * 0.34);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Корпус с вырезом под иллюминатор. Контекст уже сдвинут в центр ракеты.
  private paintRocketShell(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-140, -180, 280, 360);
    ctx.arc(0, 0, ROCKET_WINDOW_R, 0, Math.PI * 2, true);
    ctx.clip("evenodd");

    ctx.fillStyle = "#d0dde8";
    this.traceFin(ctx, -1);
    ctx.fill();
    this.traceFin(ctx, 1);
    ctx.fill();

    ctx.fillStyle = "#e7eef5";
    this.traceHull(ctx);
    ctx.fill();

    ctx.fillStyle = "#2c4254";
    ctx.fillRect(-7, R_BODY_BOT + 5, 14, 8);
    ctx.restore();

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#17344a";
    ctx.lineWidth = 2.5;
    this.traceFin(ctx, -1);
    ctx.stroke();
    this.traceFin(ctx, 1);
    ctx.stroke();
    this.traceHull(ctx);
    ctx.stroke();

    ctx.strokeStyle = "#3e6d8c";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, R_NOSE + 10);
    ctx.lineTo(0, R_SHOULDER + 6);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(-R_HALF + 3, R_SHOULDER + 8);
    ctx.lineTo(R_HALF - 3, R_SHOULDER + 8);
    ctx.moveTo(-R_HALF + 3, ROCKET_WINDOW_R + 8);
    ctx.lineTo(R_HALF - 3, ROCKET_WINDOW_R + 8);
    ctx.moveTo(-R_NOZZLE_HALF + 3, R_BODY_BOT + 8);
    ctx.lineTo(-R_NOZZLE_HALF + 3, R_NOZZLE_BOT - 3);
    ctx.moveTo(R_NOZZLE_HALF - 3, R_BODY_BOT + 8);
    ctx.lineTo(R_NOZZLE_HALF - 3, R_NOZZLE_BOT - 3);
    ctx.stroke();

    ctx.fillStyle = "#17344a";
    for (const [rx, ry] of [
      [-R_HALF + 7, R_SHOULDER + 8],
      [R_HALF - 7, R_SHOULDER + 8],
      [-R_HALF + 7, R_BODY_BOT - 6],
      [R_HALF - 7, R_BODY_BOT - 6],
    ] as const) {
      ctx.beginPath();
      ctx.arc(rx, ry, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "#17344a";
    ctx.beginPath();
    ctx.arc(0, R_NOSE + 16, 3.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private traceFin(ctx: CanvasRenderingContext2D, side: 1 | -1): void {
    const s = side;
    ctx.beginPath();
    ctx.moveTo(s * (R_HALF - 2), R_FIN_TOP);
    ctx.lineTo(s * R_FIN_OUTER, R_FIN_BOT - 6);
    ctx.lineTo(s * (R_FIN_OUTER - 8), R_FIN_BOT);
    ctx.lineTo(s * (R_HALF - 6), R_BODY_BOT - 2);
    ctx.closePath();
  }

  private traceHull(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.moveTo(-R_HALF, R_SHOULDER);
    ctx.quadraticCurveTo(-16, R_NOSE + 12, 0, R_NOSE);
    ctx.quadraticCurveTo(16, R_NOSE + 12, R_HALF, R_SHOULDER);
    ctx.lineTo(R_HALF, R_BODY_BOT);
    ctx.lineTo(R_NOZZLE_HALF, R_BODY_BOT + 3);
    ctx.lineTo(R_NOZZLE_HALF + 3, R_NOZZLE_BOT);
    ctx.lineTo(-(R_NOZZLE_HALF + 3), R_NOZZLE_BOT);
    ctx.lineTo(-R_NOZZLE_HALF, R_BODY_BOT + 3);
    ctx.lineTo(-R_HALF, R_BODY_BOT);
    ctx.closePath();
  }

  // Стекло рисуется после модельки: заливка с alpha 0.1 — это 90% прозрачности.
  private paintRocketWindow(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = "rgba(186, 216, 232, 0.1)";
    ctx.beginPath();
    ctx.arc(0, 0, ROCKET_WINDOW_R - 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#17344a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, ROCKET_WINDOW_R, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#7eafc8";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, ROCKET_WINDOW_R - 3.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, ROCKET_WINDOW_R - 6, Math.PI * 1.15, Math.PI * 1.48);
    ctx.stroke();

    ctx.fillStyle = "#17344a";
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8;
      const br = ROCKET_WINDOW_R + 4.5;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * br, Math.sin(a) * br, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private syncSpeedHud(): void {
    const t = (this.speedMark - SPEED_MARK_MIN) / (SPEED_MARK_MAX - SPEED_MARK_MIN);
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    const label = formatSpeed(this.speedMark);
    if (label !== this.shownSpeedLabel) {
      this.shownSpeedLabel = label;
      this.speedValEl.textContent = label;
      this.speedMeterEl.setAttribute("aria-valuenow", String(Math.round(this.speedMark * 100) / 100));
      this.speedMeterEl.setAttribute("aria-valuetext", label);
    }
    this.speedValEl.style.color = speedColor(clamped);
    this.speedThumbEl.style.left = `${clamped * 100}%`;
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
    ctx.fillText("Enter — сыграть ещё раз", W / 2, H / 2 + 48);
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

function boostScore(kind: PowerUpKind): number {
  if (kind === "heli") return HELI_SCORE;
  if (kind === "jet") return JET_SCORE;
  return ROCKET_SCORE;
}

function boostVy(kind: PowerUpKind): number {
  if (kind === "heli") return HELI_VY;
  if (kind === "jet") return JET_VY;
  return ROCKET_VY;
}

function formatSpeed(v: number): string {
  const n = Math.round(v * 100) / 100;
  return `${n.toFixed(2)}×`;
}

type Rgb = [number, number, number];

function speedColor(t: number): string {
  const green: Rgb = [0x3c, 0xba, 0x6a];
  const yellow: Rgb = [0xe2, 0xd2, 0x4a];
  const red: Rgb = [0xe2, 0x3b, 0x3b];
  const c = t < 0.5 ? mixRgb(green, yellow, t * 2) : mixRgb(yellow, red, (t - 0.5) * 2);
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

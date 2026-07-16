import { seedToIndex } from "../data/wotd";
import type { DailyProgress } from "../net/api";
import { isTouch } from "./TouchControls";
import { stage } from "./orientation";

const ROWS = 6;
const COLS = 5;

// Ряды экранной клавиатуры (раскладка ЙЦУКЕН). Enter и Backspace — по краям нижнего ряда.
const KEY_ROWS = [
  "йцукенгшщзхъ".split(""),
  "фывапролджэ".split(""),
  ["enter", ..."ячсмитьбю".split(""), "back"],
];

type Mark = "correct" | "present" | "absent";

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

const MARK_COLOR: Record<Mark, string> = {
  correct: "#5aa05a",
  present: "#c9b458",
  absent: "#3a414c",
};

function normalize(w: string): string {
  return w.trim().toLowerCase().replace(/ё/g, "е");
}

// Оценка догадки против загаданного слова с корректной обработкой повторов:
// сначала помечаем точные совпадения, затем «есть в слове» только на оставшиеся буквы.
function evaluate(guess: string, target: string): Mark[] {
  const marks: Mark[] = new Array(COLS).fill("absent");
  const rest = new Map<string, number>();
  for (let i = 0; i < COLS; i++) {
    if (guess[i] === target[i]) marks[i] = "correct";
    else rest.set(target[i], (rest.get(target[i]) ?? 0) + 1);
  }
  for (let i = 0; i < COLS; i++) {
    if (marks[i] === "correct") continue;
    const left = rest.get(guess[i]) ?? 0;
    if (left > 0) {
      marks[i] = "present";
      rest.set(guess[i], left - 1);
    }
  }
  return marks;
}

// Bulba Wordle — классический «Wordle» на пять букв. Игрок вводит слова из словаря
// с клавиатуры (или экранной клавиатуры); после каждой догадки плитки красятся:
// зелёная — буква на месте, жёлтая — есть в слове, но не там, серая — отсутствует.
// Словарь (он же список загадываемых слов) грузится один раз при первом открытии.
export class BulbaWordle {
  isOpen = false;
  minimized = false;
  onMinimize: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onGameOver: ((value: number) => void) | null = null;
  private reported = false;

  private root = document.getElementById("bulbawordle")!;
  private statusEl = document.getElementById("bwStatus")!;
  private gridEl = document.getElementById("bwGrid")!;
  private keyboardEl = document.getElementById("bwKeyboard")!;
  private input = document.getElementById("bwInput") as HTMLInputElement;
  private canvas = document.getElementById("bwCanvas") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;
  private confetti = document.getElementById("bwConfetti") as HTMLCanvasElement;
  private confettiCtx = this.confetti.getContext("2d")!;
  private particles: Particle[] = [];
  private confettiRaf = 0;
  private confettiLast = 0;

  private cells: HTMLDivElement[] = [];       // ROWS*COLS плиток, слева направо сверху вниз
  private keyEls = new Map<string, HTMLButtonElement>();
  private keyState = new Map<string, Mark>();  // накопленное состояние буквы на клавиатуре

  private words: string[] = [];
  private wordSet = new Set<string>();
  private loaded = false;
  private loading = false;

  private target = "";
  private guesses: string[] = [];  // отправленные слова
  private current = "";            // набираемая строка текущего ряда
  private done = false;
  private invalidRow: number | null = null;  // ряд, временно подсвеченный красным (слова нет в словаре)
  private invalidTimer = 0;
  private hintShown = false;      // сейчас в статусе висит подсказка про EN раскладку
  private statusBeforeHint = "";  // что было в статусе до подсказки — чтобы вернуть его

  private daily = false;                  // режим слова дня: без «Новое слово», со вчерашним словом
  private prevWord: string | null = null; // вчерашнее слово дня (для подписи)
  onDailyOver: ((attempts: number) => void) | null = null;
  onDailyProgress: ((state: DailyProgress) => void | Promise<void>) | null = null;

  private restartBtn = document.getElementById("bwRestart")!;
  private yesterdayEl = document.getElementById("bwYesterday")!;

  constructor() {
    document.getElementById("bwClose")!.onclick = () => this.close();
    document.getElementById("bwMin")!.onclick = () => this.minimize();
    document.getElementById("bwRestart")!.onclick = () => this.newGame();
    this.buildGrid();
    this.buildKeyboard();

    // Ввод ловим скрытым полем, когда оно в фокусе (нужно для экранной клавиатуры
    // на мобильных). stopPropagation не даёт клавишам уйти в управление миром Phaser.
    this.input.addEventListener("keydown", (e) => this.handleInput(e));
    // Клик по окну игры возвращает фокус в поле.
    this.root.addEventListener("pointerdown", () => this.focusInput());
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  async open(): Promise<void> {
    this.isOpen = true;
    this.daily = false;
    this.restartBtn.classList.remove("hidden"); // «Новое слово» доступно только в обычной игре
    this.yesterdayEl.classList.add("hidden");
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onWindowKey, true);
    requestAnimationFrame(() => this.focusInput());
    await this.ensureData();
    this.newGame();
  }

  // Режим слова дня: слово выводится из сида, «Новое слово» скрыто, показано вчерашнее слово.
  // progress — сохранённый на сервере прогресс (восстанавливаем доску, блокируем если пройдено).
  async openDaily(todaySeed: string, prevSeed: string | null, progress: DailyProgress): Promise<void> {
    this.isOpen = true;
    this.daily = true;
    this.restartBtn.classList.add("hidden");
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onWindowKey, true);
    requestAnimationFrame(() => this.focusInput());
    await this.ensureData();
    if (this.words.length === 0) return;
    this.prevWord = prevSeed ? this.words[seedToIndex(prevSeed, this.words.length)] : null;
    this.yesterdayEl.textContent = `Слово вчерашнего дня: ${this.prevWord ? this.prevWord.toUpperCase() : "—"}`;
    this.yesterdayEl.classList.remove("hidden");
    this.startWith(this.words[seedToIndex(todaySeed, this.words.length)]);
    this.restoreDaily(progress);
  }

  // Восстановить доску из сохранённого прогресса (переигрываем прошлые догадки).
  private restoreDaily(progress: DailyProgress): void {
    for (const word of progress.guesses) {
      this.guesses.push(word);
      this.applyKeyState(word, evaluate(word, this.target));
    }
    if (progress.solved) {
      this.done = true;
      this.statusEl.textContent = `Слово дня уже пройдено за ${progress.attempts}`;
    } else if (this.guesses.length >= ROWS) {
      this.done = true;
      this.statusEl.textContent = `Слово дня: не угадано. Было: ${this.target}`;
    }
    this.render();
    this.renderCanvas();
  }

  private persistDaily(solved: boolean): void | Promise<void> {
    return this.onDailyProgress?.({ solved, attempts: this.guesses.length, guesses: [...this.guesses] });
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.minimized = false;
    window.removeEventListener("keydown", this.onWindowKey, true);
    this.root.classList.add("hidden");
    this.stopConfetti();
    this.onClose?.();
  }

  minimize(): void {
    if (!this.isOpen || this.minimized) return;
    this.minimized = true;
    window.removeEventListener("keydown", this.onWindowKey, true);
    this.root.classList.add("hidden");
    this.stopConfetti();
    this.onMinimize?.();
  }

  restore(): void {
    if (!this.minimized) return;
    this.minimized = false;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onWindowKey, true);
    this.focusInput();
  }

  private focusInput(): void {
    // На телефоне фокус в поле поднял бы системную клавиатуру поверх игры — там ввод
    // идёт только через .bw-keyboard, а физические клавиши ловит onWindowKey.
    if (isTouch()) return;
    // preventScroll — чтобы страница не дёргалась при возврате фокуса.
    this.input.focus({ preventScroll: true });
  }

  private async ensureData(): Promise<void> {
    if (this.loaded || this.loading) return;
    this.loading = true;
    this.statusEl.textContent = "Загрузка словаря...";
    // Относительный путь (как у остальных ассетов) — резолвится с учётом base.
    const res = await fetch("assets/bulbawordle/words.txt");
    const text = await res.text();
    this.words = text.split("\n").map(normalize).filter((w) => w.length === COLS);
    this.wordSet = new Set(this.words);
    this.loading = false;
    this.loaded = true;
  }

  // Пока игра открыта — ловим клавиши на window в фазе перехвата, не полагаясь на
  // фокус поля: программный focus() при открытии срабатывает не всегда, а так первый
  // же физический ввод работает без клика по экранной клавиатуре. Если поле уже в
  // фокусе, уступаем событие его собственному обработчику (иначе двойная обработка).
  private onWindowKey = (e: KeyboardEvent): void => {
    if (!this.isOpen || this.minimized) return;
    if (document.activeElement === this.input) return;
    this.focusInput();
    this.handleInput(e);
  };

  private handleInput(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      this.close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      this.submit();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      this.eraseLetter();
      return;
    }
    const ch = normalize(e.key);
    if (ch.length === 1 && ch >= "а" && ch <= "я") {
      e.preventDefault();
      this.hideLayoutHint(); // игрок переключился на RU — убираем подсказку
      this.typeLetter(ch);
      return;
    }
    // Латинская буква — скорее всего забыли переключить раскладку.
    if (/^[a-z]$/i.test(e.key)) {
      e.preventDefault();
      this.showLayoutHint();
    }
  }

  private buildGrid(): void {
    this.gridEl.innerHTML = "";
    for (let i = 0; i < ROWS * COLS; i++) {
      const cell = document.createElement("div");
      cell.className = "bw-cell";
      this.gridEl.appendChild(cell);
      this.cells.push(cell);
    }
  }

  private buildKeyboard(): void {
    this.keyboardEl.innerHTML = "";
    for (const row of KEY_ROWS) {
      const rowEl = document.createElement("div");
      rowEl.className = "bw-krow";
      for (const key of row) {
        const btn = document.createElement("button");
        btn.className = "bw-key" + (key === "enter" || key === "back" ? " bw-key-wide" : "");
        btn.textContent = key === "enter" ? "ВВОД" : key === "back" ? "⌫" : key;
        // pointerdown, а не click: не уводим фокус со скрытого поля ввода.
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          if (key === "enter") this.submit();
          else if (key === "back") this.eraseLetter();
          else this.typeLetter(key);
        });
        rowEl.appendChild(btn);
        this.keyEls.set(key, btn);
      }
      this.keyboardEl.appendChild(rowEl);
    }
  }

  private newGame(): void {
    if (!this.loaded || this.words.length === 0) return;
    this.startWith(this.words[Math.floor(Math.random() * this.words.length)]);
  }

  // Начать раунд с заданным словом (общий путь для обычной игры и слова дня).
  private startWith(target: string): void {
    this.stopConfetti();
    this.target = target;
    this.guesses = [];
    this.current = "";
    this.done = false;
    this.reported = false;
    this.invalidRow = null;
    window.clearTimeout(this.invalidTimer);
    this.hintShown = false;
    this.keyState.clear();
    this.statusEl.textContent = "Угадай слово из пяти букв";
    this.render();
    this.renderCanvas();
    this.focusInput();
  }

  private showLayoutHint(): void {
    if (this.hintShown) return;
    this.statusBeforeHint = this.statusEl.textContent ?? "";
    this.statusEl.textContent = "Кажется, включена EN раскладка — переключись на RU";
    this.hintShown = true;
  }

  private hideLayoutHint(): void {
    if (!this.hintShown) return;
    this.statusEl.textContent = this.statusBeforeHint;
    this.hintShown = false;
  }

  // Подсветить текущий ряд красным на пару секунд (введённого слова нет в словаре).
  private flashInvalid(): void {
    this.invalidRow = this.guesses.length;
    window.clearTimeout(this.invalidTimer);
    this.invalidTimer = window.setTimeout(() => {
      this.invalidRow = null;
      this.render();
    }, 1500);
    this.render();
  }

  private typeLetter(ch: string): void {
    if (this.done || this.current.length >= COLS) return;
    this.current += ch;
    this.render();
  }

  private eraseLetter(): void {
    if (this.done || this.current.length === 0) return;
    this.current = this.current.slice(0, -1);
    this.render();
  }

  private submit(): void {
    if (this.done || !this.loaded) return;
    if (this.current.length < COLS) {
      this.statusEl.textContent = "Мало букв";
      return;
    }
    if (!this.wordSet.has(this.current)) {
      this.statusEl.textContent = `Нет слова «${this.current}»`;
      this.flashInvalid();
      return;
    }

    const guess = this.current;
    const marks = evaluate(guess, this.target);
    this.guesses.push(guess);
    this.current = "";
    this.applyKeyState(guess, marks);

    if (guess === this.target) {
      this.done = true;
      this.statusEl.textContent = `Угадал за ${this.guesses.length}!`;
      this.launchConfetti();
      if (this.daily) {
        // Слово дня: лидерборд открываем только ПОСЛЕ подтверждения сохранения прогресса
        // сервером — иначе GET за топом обгоняет PUT прогресса и игрока ещё нет в выборке.
        void Promise.resolve(this.persistDaily(true)).then(() => this.reportDaily(this.guesses.length));
      } else {
        // Обычная игра: каждое угаданное слово +1 к тоталу (накопительно).
        this.finish(1);
      }
    } else if (this.guesses.length >= ROWS) {
      this.done = true;
      this.statusEl.textContent = `Не угадал. Было: ${this.target}`;
      if (this.daily) this.persistDaily(false);
    } else {
      this.statusEl.textContent = `Попытка ${this.guesses.length} из ${ROWS}`;
      if (this.daily) this.persistDaily(false);
    }
    this.render();
    this.renderCanvas();
  }

  // Клавиша хранит лучшее известное состояние: correct не понижается до present/absent.
  private applyKeyState(guess: string, marks: Mark[]): void {
    const rank: Record<Mark, number> = { absent: 0, present: 1, correct: 2 };
    for (let i = 0; i < COLS; i++) {
      const prev = this.keyState.get(guess[i]);
      if (prev === undefined || rank[marks[i]] > rank[prev]) {
        this.keyState.set(guess[i], marks[i]);
      }
    }
  }

  private render(): void {
    for (let r = 0; r < ROWS; r++) {
      const submitted = this.guesses[r];
      const marks = submitted ? evaluate(submitted, this.target) : null;
      const typing = !submitted && r === this.guesses.length;
      for (let c = 0; c < COLS; c++) {
        const cell = this.cells[r * COLS + c];
        let ch = "";
        if (submitted) ch = submitted[c];
        else if (typing) ch = this.current[c] ?? "";
        cell.textContent = ch ? ch.toUpperCase() : "";
        cell.className = "bw-cell";
        if (marks) {
          cell.classList.add("bw-" + marks[c]);
        } else if (r === this.invalidRow) {
          cell.classList.add("bw-invalid");
        } else if (ch) {
          cell.classList.add("bw-filled");
        }
      }
    }
    for (const [key, btn] of this.keyEls) {
      btn.classList.remove("bw-correct", "bw-present", "bw-absent");
      const st = this.keyState.get(key);
      if (st) btn.classList.add("bw-" + st);
    }
  }

  // Салют из конфетти при победе: короткий залп частиц из центра экрана.
  private finish(value: number): void {
    if (this.reported) return;
    this.reported = true;
    this.onGameOver?.(value);
  }

  private reportDaily(attempts: number): void {
    if (this.reported) return;
    this.reported = true;
    this.onDailyOver?.(attempts);
  }

  private launchConfetti(): void {
    const w = (this.confetti.width = stage.width);
    const h = (this.confetti.height = stage.height);
    const colors = ["#f94144", "#f8961e", "#f9c74f", "#90be6d", "#43aa8b", "#577590", "#ff70a6"];
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
    const frame = Math.min((now - this.confettiLast) / 16.67, 3); // нормировка к 60 fps
    this.confettiLast = now;
    const ctx = this.confettiCtx;
    const { width: w, height: h } = this.confetti;
    ctx.clearRect(0, 0, w, h);
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.vy += 0.3 * frame; // гравитация
      p.vx *= 0.99;
      p.x += p.vx * frame;
      p.y += p.vy * frame;
      p.rot += p.vrot * frame;
      if (p.y - p.size > h) continue; // упал за нижний край — убираем
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

  // Миниатюра для экрана TV: сетка догадок в цвете.
  private renderCanvas(): void {
    const ctx = this.ctx;
    const { width: w, height: h } = this.canvas;
    ctx.fillStyle = "#0e1620";
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fd06b";
    ctx.font = "bold 26px 'Trebuchet MS', sans-serif";
    ctx.fillText("Bulba Wordle", w / 2, 44);

    const gap = 6;
    const size = 44;
    const gw = COLS * size + (COLS - 1) * gap;
    const x0 = (w - gw) / 2;
    const y0 = 64;
    for (let r = 0; r < ROWS; r++) {
      const submitted = this.guesses[r];
      const marks = submitted ? evaluate(submitted, this.target) : null;
      for (let c = 0; c < COLS; c++) {
        const x = x0 + c * (size + gap);
        const y = y0 + r * (size + gap);
        ctx.fillStyle = marks ? MARK_COLOR[marks[c]] : "#1b2430";
        ctx.fillRect(x, y, size, size);
        ctx.strokeStyle = "#3a414c";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, size, size);
        if (submitted) {
          ctx.fillStyle = "#e8efe6";
          ctx.font = "bold 24px 'Trebuchet MS', sans-serif";
          ctx.textBaseline = "middle";
          ctx.fillText(submitted[c].toUpperCase(), x + size / 2, y + size / 2 + 2);
          ctx.textBaseline = "alphabetic";
        }
      }
    }
  }
}

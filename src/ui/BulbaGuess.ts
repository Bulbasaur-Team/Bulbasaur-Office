import { dailyRoundIndex, moscowToday, shiftIsoDate } from "../data/wotd";
import { buyGuessHint, type DailyProgress } from "../net/api";
import { stage } from "./orientation";

interface Round {
  t: string;      // загаданное слово (нормализованное)
  n: number[];    // индексы ближайших по смыслу слов в порядке близости; n[0] — само
                  // загаданное слово, дальше по убыванию близости (в словаре words).
  h?: number[];   // позиции в n двух дальних подсказок, уже отобранные.
}

// Позиция соседа (0 — само слово) переводится в счёт 1..100 сглаживающей кривой:
// синонимы у начала остаются 2-4, ассоциации по смежности дают «рядом» ~15-30,
// а дальние слова плавно подходят к 100. Слово вне окна близости считаем за 100.
const SIM_K = 120;
const PAID_HINT_PRICE = 100;
function posToScore(pos: number): number {
  if (pos === 0) return 1;
  return Math.min(100, 1 + Math.round((99 * pos) / (pos + SIM_K)));
}

// Купленная подсказка открывает слово ближе к лучшему уже известному счёту.
function paidHintDelta(best: number): number | null {
  if (best > 50) return 25;
  if (best > 20) return 10;
  if (best > 10) return 5;
  if (best > 5) return 3;
  if (best > 2) return 1;
  return null;
}

interface Attempt {
  word: string;
  score: number;  // 1..100, либо Infinity («бесконечность» — слово неизвестно)
  seq: number;    // порядок ввода — при равном score недавние показываем выше
  hint?: boolean; // выданное игре слово: не считается попыткой
  paid?: boolean; // куплено за бульба коины — сохраняем в прогресс слова дня
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

// Цвет прогресс-бара по правилам игры. Порядок проверок разрешает пересечение
// диапазонов «1..5» и «<20» в пользу более узкого.
function barColor(score: number): string {
  if (score === Infinity) return "#c94f4f";
  if (score <= 5) return "#3fa34d";   // зелёный — почти угадал
  if (score < 20) return "#9fd15a";   // светло-зелёный — близко
  if (score <= 70) return "#e6c14b";  // жёлтый — средне
  return "#d95c5c";                   // красный — далеко
}

function normalize(w: string): string {
  return w.trim().toLowerCase().replace(/ё/g, "е");
}

// Bulba Guess — игра загадывает существительное в единственном числе и именительном
// падеже. Игрок вводит слово и получает меру смыслового расстояния: 1 — само слово,
// чем больше — тем дальше, 100 — совсем не близко, «бесконечность» — такого
// существительного нет. Другая форма («корову», «коровы») приводится к начальной.
// Словарь, соседи и подсказки грузятся один раз при первом открытии.
export class BulbaGuess {
  isOpen = false;
  onClose: (() => void) | null = null;
  onGameOver: ((value: number) => void) | null = null;
  onDailyOver: ((attempts: number) => void) | null = null;
  onDailyProgress: ((state: DailyProgress) => void | Promise<void>) | null = null;
  onLeaderboard: (() => void) | null = null;
  onBalance: ((balance: number) => void) | null = null;
  private reported = false;

  private daily = false;                  // режим слова дня: без «Сдаться»/«Новое слово», со вчерашним словом
  private prevWord: string | null = null;
  private dailyAttempts = 0;              // число подошедших попыток слова дня (для счётчика/лидерборда)

  private root = document.getElementById("bulbaguess")!;
  private statusEl = document.getElementById("bgStatus")!;
  private giveUpBtn = document.getElementById("bgGiveUp")!;
  private restartBtn = document.getElementById("bgRestart")!;
  private yesterdayEl = document.getElementById("bgYesterday")!;
  private hintBtn = document.getElementById("bgHint") as HTMLButtonElement;
  private balanceEl = document.getElementById("bgBalanceValue")!;
  private hintBusy = false;
  private form = document.getElementById("bgForm") as HTMLFormElement;
  private input = document.getElementById("bgInput") as HTMLInputElement;
  private listEl = document.getElementById("bgList")!;
  private canvas = document.getElementById("bgCanvas") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;
  private confetti = document.getElementById("bgConfetti") as HTMLCanvasElement;
  private confettiCtx = this.confetti.getContext("2d")!;
  private particles: Particle[] = [];
  private confettiRaf = 0;
  private confettiLast = 0;

  private words: string[] = [];              // словарь известных слов (индекс = позиция)
  private wordIndex = new Map<string, number>(); // слово -> индекс в words
  private forms = new Map<string, string>();     // косвенная форма -> начальная
  private rounds: Round[] = [];
  private dataReady: Promise<void> | null = null;
  private loaded = false;

  private round: Round | null = null;
  private posByIndex = new Map<number, number>(); // индекс слова -> позиция среди соседей
  private attempts: Attempt[] = [];
  private won = false;
  private surrendered = false; // игрок сдался — слово раскрыто, приём догадок остановлен

  constructor() {
    document.getElementById("bgClose")!.onclick = () => this.close();
    document.getElementById("bgLb")!.onclick = () => this.onLeaderboard?.();
    document.getElementById("bgRestart")!.onclick = () => this.newRound();
    document.getElementById("bgGiveUp")!.onclick = () => this.giveUp();
    this.hintBtn.onclick = () => void this.buyHint();
    const price = this.hintBtn.querySelector(".bg-price");
    if (price?.lastChild) price.lastChild.textContent = String(PAID_HINT_PRICE);
    const help = document.getElementById("bgHelp")!;
    help.onclick = () => help.parentElement!.classList.toggle("bg-open");
    this.form.onsubmit = (e) => {
      e.preventDefault();
      this.submitGuess();
    };
    // Клавиши поля ввода не должны доходить до Phaser: иначе физические W/A/S/D
    // (на русской раскладке — ц/ф/ы/в) и стрелки перехватываются управлением мира
    // и не набираются. Escape закрывает игру.
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.code === "Escape") this.close();
    });
  }

  setBalance(balance: number): void {
    this.balanceEl.textContent = String(balance);
  }

  async open(): Promise<void> {
    this.isOpen = true;
    this.daily = false;
    this.giveUpBtn.classList.remove("hidden"); // «Сдаться»/«Новое слово» — только в обычной игре
    this.restartBtn.classList.remove("hidden");
    this.yesterdayEl.classList.add("hidden");
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKeyDown);
    await this.ensureData();
    this.newRound();
  }

  get isDaily(): boolean {
    return this.daily;
  }

  // Режим слова дня: раунд выводится из сида, «Сдаться»/«Новое слово» скрыты, показано вчерашнее слово.
  // progress — сохранённый прогресс (восстанавливаем список догадок, блокируем если пройдено).
  async openDaily(todaySeed: string, prevSeed: string | null, progress: DailyProgress, todayIso?: string | null): Promise<void> {
    this.isOpen = true;
    this.daily = true;
    this.giveUpBtn.classList.add("hidden");
    this.restartBtn.classList.add("hidden");
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKeyDown);
    await this.ensureData();
    if (this.rounds.length === 0) return;
    // Сид по-прежнему приходит с сервера (вчера был или нет). Само слово — из
    // перестановки пула по московской дате, поэтому по кругу оно не повторяется.
    void todaySeed;
    const today = todayIso && /^\d{4}-\d{2}-\d{2}$/.test(todayIso) ? todayIso : moscowToday();
    this.prevWord = prevSeed ? this.rounds[dailyRoundIndex(shiftIsoDate(today, -1), this.rounds.length)].t : null;
    this.yesterdayEl.textContent = `Слово вчерашнего дня: ${this.prevWord ?? "—"}`;
    this.yesterdayEl.classList.remove("hidden");
    this.startRound(this.rounds[dailyRoundIndex(today, this.rounds.length)]);
    this.restoreDaily(progress);
  }

  // Восстановить список подошедших догадок и счётчик из сохранённого прогресса.
  private restoreDaily(progress: DailyProgress): void {
    this.dailyAttempts = progress.attempts;
    for (const word of progress.guesses) {
      if (this.attempts.some((a) => a.word === word)) continue;
      this.attempts.push({ word, score: this.scoreOf(word), seq: this.attempts.length });
    }
    this.attempts.sort((a, b) => a.score - b.score || b.seq - a.seq);
    if (progress.solved) {
      this.won = true;
      this.input.disabled = true;
      this.statusEl.textContent = `Слово дня уже пройдено за ${progress.attempts}`;
    } else {
      this.statusEl.textContent = `Попыток: ${this.dailyAttempts}`;
    }
    this.renderList();
    this.renderCanvas();
    this.refreshHintButton();
  }
  // Топ-20 подошедших слов и купленных подсказок — на сервер.
  private persistDaily(solved: boolean): void | Promise<void> {
    const guesses = this.attempts
      .filter((a) => a.score !== Infinity && (!a.hint || a.paid))
      .slice(0, 20)
      .map((a) => a.word);
    return this.onDailyProgress?.({ solved, attempts: this.dailyAttempts, guesses });
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    window.removeEventListener("keydown", this.onKeyDown);
    this.root.classList.add("hidden");
    this.stopConfetti();
    this.onClose?.();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Escape") this.close();
  };

  private async ensureData(): Promise<void> {
    if (!this.dataReady) {
      this.dataReady = this.loadData().catch((err) => {
        this.dataReady = null;
        throw err;
      });
    }
    await this.dataReady;
  }

  private async loadData(): Promise<void> {
    this.statusEl.textContent = "Загрузка словаря...";
    // Версия в адресе сбрасывает кэш браузера: старый словарь и новые индексы
    // вместе дали бы бессмысленные счета.
    const [wordsRes, roundsRes, formsRes] = await Promise.all([
      fetch("assets/bulbaguess/words.txt?v=4"),
      fetch("assets/bulbaguess/rounds.json?v=4"),
      fetch("assets/bulbaguess/forms.txt?v=4"),
    ]);
    const wordsText = await wordsRes.text();
    this.words = wordsText.split("\n").filter((w) => w.length > 0);
    this.wordIndex = new Map(this.words.map((w, i) => [w, i]));
    this.forms = new Map();
    for (const line of (await formsRes.text()).split("\n")) {
      const sp = line.indexOf(" ");
      if (sp <= 0) continue;
      this.forms.set(line.slice(0, sp), line.slice(sp + 1));
    }
    this.rounds = await roundsRes.json();
    this.loaded = true;
  }

  private newRound(): void {
    if (!this.loaded || this.rounds.length === 0) return;
    this.startRound(this.pickRound());
  }

  // Свободная игра не повторяет недавние слова и сегодняшнее слово дня,
  // пока пул не кончится.
  private pickRound(): Round {
    const today = this.rounds[dailyRoundIndex(moscowToday(), this.rounds.length)].t;
    const seen = new Set(this.readSeen());
    seen.add(today);
    let pool = this.rounds.filter((r) => !seen.has(r.t));
    if (pool.length === 0) {
      const stored = this.readSeen();
      const last = stored.length ? stored[stored.length - 1] : undefined;
      this.writeSeen([]);
      pool = this.rounds.filter((r) => r.t !== last && r.t !== today);
      if (pool.length === 0) pool = this.rounds;
    }
    const round = pool[Math.floor(Math.random() * pool.length)];
    const stored = this.readSeen().filter((w) => w !== round.t);
    stored.push(round.t);
    this.writeSeen(stored.slice(-this.rounds.length));
    return round;
  }

  private readSeen(): string[] {
    try {
      const raw = localStorage.getItem("bulbaguess-seen-v2");
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((w) => typeof w === "string") : [];
    } catch {
      return [];
    }
  }

  private writeSeen(words: string[]): void {
    try {
      localStorage.setItem("bulbaguess-seen-v2", JSON.stringify(words));
    } catch {
      // В приватном режиме запоминать недавние слова негде.
    }
  }

  // Начать раунд с заданным словом (общий путь для обычной игры и слова дня).
  private startRound(round: Round): void {
    this.stopConfetti();
    this.round = round;
    this.posByIndex = new Map(round.n.map((idx, i) => [idx, i]));
    this.attempts = [];
    const hints = this.hintWords(round);
    hints.forEach((h, i) => this.attempts.push({ word: h.word, score: h.score, seq: i, hint: true }));
    this.attempts.sort((a, b) => a.score - b.score);
    this.won = false;
    this.surrendered = false;
    this.reported = false;
    this.dailyAttempts = 0;
    this.input.value = "";
    this.input.disabled = false;
    this.statusEl.textContent = hints.length
      ? "Подсказки уже в списке. Попыток: 0"
      : "Угадай слово по смыслу. Попыток: 0";
    this.renderList();
    this.renderCanvas();
    this.refreshHintButton();
    this.input.focus();
  }

  // Слова-подсказки выбраны при сборке: понятные соседи около счетов 50 и 70.
  private hintWords(round: Round): { word: string; score: number }[] {
    const hints: { word: string; score: number }[] = [];
    for (const pos of round.h ?? []) {
      const idx = round.n[pos];
      const word = idx === undefined ? undefined : this.words[idx];
      if (!word) continue;
      hints.push({ word, score: posToScore(pos) });
    }
    return hints;
  }

  // Догадки игрока — без выданного слова-подсказки.
  private guesses(): Attempt[] {
    return this.attempts.filter((a) => !a.hint);
  }

  // Лучший уже открытый счёт: и догадки, и подсказки. Иначе покупка могла бы
  // показать слово хуже того, что уже лежит в списке.
  private bestKnownScore(): number {
    let best = Infinity;
    for (const attempt of this.attempts) {
      if (attempt.score < best) best = attempt.score;
    }
    return best === Infinity ? 100 : best;
  }

  private pickPaidHint(): { word: string; score: number } | null {
    if (!this.round || this.won || this.surrendered) return null;
    const anchor = this.bestKnownScore();
    const delta = paidHintDelta(anchor);
    if (delta == null) return null;
    const target = anchor - delta;
    const used = new Set(this.attempts.map((attempt) => attempt.word));
    let pick: { word: string; score: number; dist: number } | null = null;
    for (let pos = 1; pos < this.round.n.length; pos++) {
      const score = posToScore(pos);
      if (score <= 1 || score >= anchor) continue;
      const word = this.words[this.round.n[pos]];
      if (!word || used.has(word) || word === this.round.t) continue;
      const dist = Math.abs(score - target);
      if (!pick || dist < pick.dist || (dist === pick.dist && score > pick.score)) {
        pick = { word, score, dist };
      }
    }
    return pick ? { word: pick.word, score: pick.score } : null;
  }

  private refreshHintButton(): void {
    const pick = this.pickPaidHint();
    this.hintBtn.disabled = this.hintBusy || pick == null;
    this.hintBtn.classList.toggle("busy", this.hintBusy);
    if (this.won || this.surrendered) this.hintBtn.title = "";
    else if (paidHintDelta(this.bestKnownScore()) == null) this.hintBtn.title = "Уже совсем близко";
    else if (pick == null) this.hintBtn.title = "Ближе подсказать нечего";
    else this.hintBtn.title = "Открыть слово ближе к загадке";
  }

  private async buyHint(): Promise<void> {
    const pick = this.pickPaidHint();
    const round = this.round;
    if (!pick || !round || this.hintBusy) return;
    this.hintBusy = true;
    this.refreshHintButton();
    try {
      const res = await buyGuessHint();
      this.onBalance?.(res.balance);
      if (this.round !== round || this.attempts.some((attempt) => attempt.word === pick.word)) return;
      this.attempts.push({
        word: pick.word,
        score: pick.score,
        seq: this.attempts.length,
        hint: true,
        paid: true,
      });
      this.attempts.sort((a, b) => a.score - b.score || b.seq - a.seq);
      const count = this.daily ? this.dailyAttempts : this.guesses().length;
      this.statusEl.textContent = `Подсказка: «${pick.word}». Попыток: ${count}`;
      if (this.daily) this.persistDaily(false);
      this.renderList(pick.word);
      this.renderCanvas();
    } catch (e) {
      this.statusEl.textContent = e instanceof Error ? e.message : "Не удалось купить подсказку";
    } finally {
      this.hintBusy = false;
      this.refreshHintButton();
    }
  }

  // Сдаться: показать загаданное слово и остановить приём догадок. Результат не
  // отправляется в лидерборд (это не победа). Дальше — «Новое слово».
  private giveUp(): void {
    if (!this.loaded || !this.round || this.won || this.surrendered) return;
    this.surrendered = true;
    this.input.disabled = true;
    this.statusEl.textContent = `Загадано было «${this.round.t}». Жми «Новое слово».`;
    this.refreshHintButton();
    this.renderCanvas();
  }

  private submitGuess(): void {
    if (this.won || this.surrendered || !this.round || !this.loaded) return;
    const g = this.lemmaOf(this.input.value);
    this.input.value = "";
    if (!g) return;

    const count = () => (this.daily ? this.dailyAttempts : this.guesses().length);

    if (this.attempts.some((a) => a.word === g)) {
      this.statusEl.textContent = `«${g}» уже было. Попыток: ${count()}`;
      return;
    }

    const score = this.scoreOf(g);
    this.attempts.push({ word: g, score, seq: this.attempts.length });
    // От удачных (маленький score) к менее удачным; при равном score недавно
    // введённые выше. «Бесконечность» — в самый низ.
    this.attempts.sort((a, b) => a.score - b.score || b.seq - a.seq);

    // Слово дня: считаем и сохраняем только подошедшие по словарю догадки.
    const matched = score !== Infinity;
    if (this.daily && matched) this.dailyAttempts += 1;

    if (score === 1) {
      this.won = true;
      this.input.disabled = true;
      this.statusEl.textContent = this.daily
        ? `Угадал! «${g}» за ${count()} попыток.`
        : `Угадал! «${g}» за ${count()} попыток. +200 бульба коинов`;
      this.launchConfetti();
      if (this.daily) {
        // Лидерборд открываем только ПОСЛЕ подтверждения сохранения прогресса сервером:
        // иначе GET за топом обгоняет PUT прогресса и игрока ещё нет в выборке.
        void Promise.resolve(this.persistDaily(true)).then(() => this.reportDaily(this.dailyAttempts));
      } else {
        // Лидерборд накопительный (всего угаданных слов) — за победу засчитывается 1 слово.
        this.finish(1);
      }
    } else {
      this.statusEl.textContent = `Попыток: ${count()}`;
      if (this.daily && matched) this.persistDaily(false);
    }
    this.renderList(g);
    this.renderCanvas();
    this.refreshHintButton();
  }

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

  // Начальная форма: «корову» и «коровы» считаются как «корова».
  private lemmaOf(raw: string): string {
    const n = normalize(raw);
    if (this.wordIndex.has(n)) return n;
    return this.forms.get(n) ?? n;
  }

  private scoreOf(g: string): number {
    const gi = this.wordIndex.get(this.lemmaOf(g));
    if (gi === undefined) return Infinity;      // «бесконечность» — слово неизвестно
    const pos = this.posByIndex.get(gi);
    if (pos === undefined) return 100;          // слово известно, но далеко по смыслу
    return posToScore(pos);
  }

  private renderList(highlight?: string): void {
    this.listEl.innerHTML = "";
    for (const a of this.attempts.slice(0, 20)) {
      const row = document.createElement("div");
      row.className = "bg-row" + (a.word === highlight ? " bg-new" : "") + (a.hint ? " bg-hint" : "");

      const bar = document.createElement("div");
      bar.className = "bg-bar";
      bar.style.width = (a.score === Infinity ? 0 : 101 - a.score) + "%";
      bar.style.background = barColor(a.score);

      const word = document.createElement("span");
      word.className = "bg-word";
      word.textContent = a.word;

      const score = document.createElement("span");
      score.className = "bg-score";
      score.textContent = a.score === Infinity ? "∞" : String(a.score);

      row.append(bar, word, score);
      this.listEl.appendChild(row);
    }
  }

  // Салют из конфетти при победе: короткий залп частиц из центра экрана.
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
        vy: Math.sin(a) * sp - 4, // лёгкий подброс вверх
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

  // Миниатюра для экрана TV: сводка партии (сам список рисуется в DOM).
  private renderCanvas(): void {
    const ctx = this.ctx;
    const { width: w, height: h } = this.canvas;
    ctx.fillStyle = "#0e1620";
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fd06b";
    ctx.font = "bold 26px 'Trebuchet MS', sans-serif";
    ctx.fillText("Bulba Guess", w / 2, 48);

    const guesses = this.guesses();
    const best = guesses.length ? Math.min(...guesses.map((a) => a.score)) : null;
    ctx.fillStyle = "#e8efe6";
    ctx.font = "20px 'Trebuchet MS', sans-serif";
    ctx.fillText(`Попыток: ${guesses.length}`, w / 2, h / 2 - 10);
    if (best !== null) {
      ctx.fillText(`Лучший: ${best === Infinity ? "∞" : best}`, w / 2, h / 2 + 24);
    }
    if ((this.won || this.surrendered) && this.round) {
      ctx.fillStyle = "#8fd06b";
      ctx.font = "bold 24px 'Trebuchet MS', sans-serif";
      ctx.fillText(this.round.t, w / 2, h / 2 + 70);
    }
  }
}

import { fetchLeaderboard, fetchDailyLeaderboard, type Leaderboard as Board, type LeaderboardEntry } from "../net/api";
import { stage } from "./orientation";

// Медали за первые три места вместо номера.
const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

const CONFETTI_COLORS = ["#f94144", "#f8961e", "#f9c74f", "#90be6d", "#43aa8b", "#577590", "#ff70a6"];

const LB_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h5v-6H4zM9.5 20h5V8h-5zM15 20h5v-10h-5z"/></svg>`;

export interface LeaderboardGame {
  id: string;
  title: string;
  format: (value: number) => string;
  daily?: boolean;  // борд слова дня — грузится через дневной эндпоинт
  code?: string;    // код игры для API, если id отличается (у дневных бордов)
}

// Смещение ранга: >0 поднялся (номер места уменьшился), <0 опустился.
export type RankDeltas = Map<string, number>;

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

/** Собрать ранги до/после попытки: login → насколько изменился ранг. */
export function rankDeltas(before: Board, after: Board): RankDeltas {
  const prev = new Map<string, number>();
  for (const e of before.entries) prev.set(e.login, e.rank);
  if (before.you) prev.set(before.you.login, before.you.rank);

  const deltas: RankDeltas = new Map();
  const consider = (e: LeaderboardEntry) => {
    const p = prev.get(e.login);
    if (p !== undefined && p !== e.rank) deltas.set(e.login, p - e.rank);
    else if (p === undefined && e.you) deltas.set(e.login, 1); // впервые в таблице — зелёная стрелка
  };
  for (const e of after.entries) consider(e);
  if (after.you) consider(after.you);
  return deltas;
}

/** Попытка реально обновила таблицу (новый/улучшенный результат текущего игрока). */
export function boardChangedForYou(before: Board, after: Board): boolean {
  const beforeYou = before.you ?? before.entries.find((e) => e.you) ?? null;
  const afterYou = after.you ?? after.entries.find((e) => e.you) ?? null;
  if (!afterYou) return false;
  if (!beforeYou) return true;
  return beforeYou.value !== afterYou.value || beforeYou.rank !== afterYou.rank;
}

function youAreFirst(board: Board): boolean {
  // Смотрим на первую строку топа, а не на you.rank: при равных очках
  // betterCount даёт одинаковый ранг, хотя в таблице ты можешь быть вторым.
  return board.entries[0]?.you === true;
}

type View = "index" | "board";

// Экран лидерборда поверх игры. Из меню открывается список игр с рекордсменами,
// из мини-игры — борд только этой игры. После партии, если результат изменил
// таблицу, борд показывается со стрелками рангов.
export class Leaderboard {
  isOpen = false;

  private root = document.getElementById("leaderboard")!;
  private box = this.root.querySelector(".lb-box")!;
  private titleEl = document.getElementById("lbTitle")!;
  private statusEl = document.getElementById("lbStatus")!;
  private listEl = document.getElementById("lbList")!;
  private indexBtn = document.getElementById("lbIndex")!;
  private confetti = document.getElementById("lbConfetti") as HTMLCanvasElement;
  private confettiCtx = this.confetti.getContext("2d")!;

  private index = 0;
  private view: View = "board";
  private highlightId: string | null = null;
  private loadToken = 0;
  private deltas: RankDeltas | null = null;
  private particles: Particle[] = [];
  private confettiRaf = 0;
  private confettiLast = 0;

  constructor(private games: LeaderboardGame[]) {
    document.getElementById("lbClose")!.onclick = () => this.close();
    this.indexBtn.onclick = () => {
      this.highlightId = this.games[this.index]?.id ?? null;
      void this.showIndex();
    };
  }

  // Из меню — список всех игр. Из мини-игры — борд только этой игры.
  async open(gameId?: string): Promise<void> {
    this.deltas = null;
    this.highlightId = null;
    this.reveal();
    if (gameId) {
      this.setIndex(gameId);
      await this.loadBoard();
    } else {
      await this.showIndex();
    }
  }

  // Показать борд после партии со стрелками изменения ранга.
  showBoard(gameId: string, board: Board, deltas?: RankDeltas | null): void {
    this.deltas = deltas ?? null;
    this.highlightId = null;
    this.setIndex(gameId);
    this.loadToken++;
    this.reveal();
    this.showBoardChrome();
    this.render(board);
  }

  close(): void {
    this.isOpen = false;
    this.deltas = null;
    this.loadToken++;
    this.stopConfetti();
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
  }

  private reveal(): void {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
  }

  private setIndex(gameId?: string): void {
    const i = gameId ? this.games.findIndex((g) => g.id === gameId) : 0;
    this.index = i >= 0 ? i : 0;
  }

  private showBoardChrome(): void {
    this.view = "board";
    this.indexBtn.classList.remove("hidden");
    this.box.classList.remove("lb-index-view");
  }

  private async showIndex(): Promise<void> {
    this.view = "index";
    this.deltas = null;
    this.stopConfetti();
    this.indexBtn.classList.add("hidden");
    this.box.classList.add("lb-index-view");
    this.titleEl.textContent = "Лидерборды";
    this.statusEl.textContent = "";
    this.listEl.innerHTML = "";

    const champs = new Map<string, HTMLElement>();
    for (const game of this.games) {
      const champ = this.champPlaceholder();
      champs.set(game.id, champ);
      this.listEl.appendChild(this.gameRow(game, champ));
    }
    this.listEl.querySelector(".lb-game-current")?.scrollIntoView({ block: "nearest" });

    const token = ++this.loadToken;
    await Promise.all(this.games.map(async (game) => {
      const champ = champs.get(game.id)!;
      try {
        const board = await this.fetch(game);
        if (!this.alive("index", token)) return;
        this.fillChamp(champ, board.entries[0] ?? null, null);
      } catch (e) {
        if (!this.alive("index", token)) return;
        this.fillChamp(champ, null, (e as Error).message);
      }
    }));
  }

  private async loadBoard(): Promise<void> {
    const game = this.games[this.index];
    const token = ++this.loadToken;
    this.showBoardChrome();
    this.titleEl.textContent = game.title;
    this.statusEl.textContent = "Загрузка...";
    this.listEl.innerHTML = "";
    try {
      const board = await this.fetch(game);
      if (!this.alive("board", token)) return;
      this.render(board);
    } catch (e) {
      if (!this.alive("board", token)) return;
      this.statusEl.textContent = (e as Error).message;
    }
  }

  private fetch(game: LeaderboardGame): Promise<Board> {
    return game.daily
      ? fetchDailyLeaderboard(game.code ?? game.id)
      : fetchLeaderboard(game.id);
  }

  private alive(view: View, token: number): boolean {
    return this.isOpen && this.view === view && token === this.loadToken;
  }

  private champPlaceholder(): HTMLElement {
    const champ = document.createElement("span");
    champ.className = "lb-game-champ";
    const medal = document.createElement("span");
    medal.className = "lb-medal";
    medal.textContent = "🥇";
    const login = document.createElement("span");
    login.className = "lb-login lb-champ-empty";
    login.textContent = "…";
    champ.append(medal, login);
    return champ;
  }

  private fillChamp(champ: HTMLElement, top: LeaderboardEntry | null, error: string | null): void {
    champ.className = "lb-game-champ" + (top?.you ? " is-you" : "");
    champ.replaceChildren();
    const medal = document.createElement("span");
    medal.className = "lb-medal" + (top ? "" : " lb-medal-empty");
    medal.textContent = "🥇";
    const login = document.createElement("span");
    login.className = "lb-login" + (top ? "" : " lb-champ-empty");
    if (top) login.textContent = top.login;
    else if (error) {
      login.textContent = "ошибка";
      login.title = error;
    } else login.textContent = "пока нет";
    champ.append(medal, login);
  }

  private gameRow(game: LeaderboardGame, champ: HTMLElement): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "lb-game" + (game.id === this.highlightId ? " lb-game-current" : "");

    const title = document.createElement("span");
    title.className = "lb-game-title";
    title.textContent = game.title;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "arcade-lb";
    btn.setAttribute("aria-label", `Открыть лидерборд: ${game.title}`);
    btn.title = "Открыть лидерборд";
    btn.innerHTML = LB_ICON;
    btn.onclick = () => {
      this.deltas = null;
      this.stopConfetti();
      this.setIndex(game.id);
      void this.loadBoard();
    };

    row.append(title, champ, btn);
    return row;
  }

  private render(board: Board): void {
    const game = this.games[this.index];
    this.titleEl.textContent = game.title;
    this.listEl.innerHTML = "";
    this.statusEl.textContent = board.entries.length === 0 ? "Пока пусто — стань первым!" : "";

    for (const entry of board.entries) {
      this.listEl.appendChild(this.row(entry, game.format));
    }

    if (board.you && !board.entries.some((e) => e.you)) {
      const sep = document.createElement("div");
      sep.className = "lb-sep";
      sep.textContent = "···";
      this.listEl.appendChild(sep);
      this.listEl.appendChild(this.row(board.you, game.format));
    }

    if (youAreFirst(board)) this.launchConfetti();
    else this.stopConfetti();
  }

  private launchConfetti(): void {
    const w = (this.confetti.width = stage.width);
    const h = (this.confetti.height = stage.height);
    this.particles = [];
    const cx = w / 2;
    const cy = h * 0.35;
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
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      });
    }
    this.confettiLast = performance.now();
    cancelAnimationFrame(this.confettiRaf);
    this.confettiLoop();
  }

  private confettiLoop = (): void => {
    if (!this.isOpen) return;
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

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    // Стрелки больше не листают борды, но не должны уходить в игру под модалкой.
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key !== "Escape" && e.key !== "Enter" && e.key !== " ") return;
    const target = e.target;
    if ((e.key === "Enter" || e.key === " ") && target instanceof HTMLElement && this.root.contains(target) && target.closest("button")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  private row(entry: LeaderboardEntry, format: (value: number) => string): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "lb-row" + (entry.you ? " lb-you" : "");

    const delta = this.deltas?.get(entry.login);
    if (delta !== undefined && delta !== 0) {
      const arrow = document.createElement("span");
      arrow.className = "lb-delta " + (delta > 0 ? "lb-up" : "lb-down");
      arrow.textContent = delta > 0 ? "▲" : "▼";
      arrow.title = delta > 0 ? `Поднялся на ${delta}` : `Опустился на ${-delta}`;
      row.appendChild(arrow);
    } else if (this.deltas) {
      // В режиме «после попытки» выравниваем строки без стрелки.
      const spacer = document.createElement("span");
      spacer.className = "lb-delta lb-delta-empty";
      spacer.textContent = "";
      row.appendChild(spacer);
    }

    const rank = document.createElement("span");
    rank.className = "lb-rank";
    const medal = MEDALS[entry.rank];
    rank.textContent = medal ?? `${entry.rank}`;
    if (medal) rank.classList.add("lb-medal");

    const login = document.createElement("span");
    login.className = "lb-login";
    login.textContent = entry.login;

    const value = document.createElement("span");
    value.className = "lb-value";
    value.textContent = format(entry.value);

    row.append(rank, login, value);
    return row;
  }
}

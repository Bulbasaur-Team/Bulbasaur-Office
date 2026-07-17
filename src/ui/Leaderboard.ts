import { fetchLeaderboard, fetchDailyLeaderboard, type Leaderboard as Board, type LeaderboardEntry } from "../net/api";
import { stage } from "./orientation";

// Медали за первые три места вместо номера.
const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

const CONFETTI_COLORS = ["#f94144", "#f8961e", "#f9c74f", "#90be6d", "#43aa8b", "#577590", "#ff70a6"];

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

// Экран лидерборда поверх игры. Открывается по кнопке (грузит с сервера) или после
// сыгранной партии, если результат изменил таблицу (тогда — со стрелками рангов).
export class Leaderboard {
  isOpen = false;

  private root = document.getElementById("leaderboard")!;
  private titleEl = document.getElementById("lbTitle")!;
  private statusEl = document.getElementById("lbStatus")!;
  private listEl = document.getElementById("lbList")!;
  private prevBtn = document.getElementById("lbPrev")!;
  private nextBtn = document.getElementById("lbNext")!;
  private confetti = document.getElementById("lbConfetti") as HTMLCanvasElement;
  private confettiCtx = this.confetti.getContext("2d")!;

  private index = 0;
  private deltas: RankDeltas | null = null;
  private particles: Particle[] = [];
  private confettiRaf = 0;
  private confettiLast = 0;

  constructor(private games: LeaderboardGame[]) {
    document.getElementById("lbClose")!.onclick = () => this.close();
    this.prevBtn.onclick = () => this.step(-1);
    this.nextBtn.onclick = () => this.step(1);
  }

  // Открыть по кнопке / пьедесталу — обычный вид без стрелок.
  async open(gameId?: string): Promise<void> {
    this.deltas = null;
    this.setIndex(gameId);
    this.reveal();
    await this.load();
  }

  // Показать борд после партии со стрелками изменения ранга.
  showBoard(gameId: string, board: Board, deltas?: RankDeltas | null): void {
    this.deltas = deltas ?? null;
    this.setIndex(gameId);
    this.reveal();
    this.render(board);
  }

  close(): void {
    this.isOpen = false;
    this.deltas = null;
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

  private step(delta: number): void {
    // При листании — обычный вид, без стрелок прошлой попытки.
    this.deltas = null;
    this.stopConfetti();
    this.index = (this.index + delta + this.games.length) % this.games.length;
    void this.load();
  }

  private async load(): Promise<void> {
    const game = this.games[this.index];
    this.titleEl.textContent = game.title;
    this.statusEl.textContent = "Загрузка...";
    this.listEl.innerHTML = "";
    try {
      const board = game.daily
        ? await fetchDailyLeaderboard(game.code ?? game.id)
        : await fetchLeaderboard(game.id);
      this.render(board);
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
    }
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
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      this.step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      this.step(1);
    } else if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
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

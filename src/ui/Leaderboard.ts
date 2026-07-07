import { fetchLeaderboard, fetchDailyLeaderboard, type Leaderboard as Board, type LeaderboardEntry } from "../net/api";

// Медали за первые три места вместо номера.
const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export interface LeaderboardGame {
  id: string;
  title: string;
  format: (value: number) => string;
  daily?: boolean;  // борд слова дня — грузится через дневной эндпоинт
  code?: string;    // код игры для API, если id отличается (у дневных бордов)
}

// Экран лидерборда поверх игры. Открывается по кнопке (грузит с сервера) или после
// сыгранной партии (готовым бордом). Стрелками влево/вправо листаются игры. Своя
// строка подсвечена; если игрок не в топе — показывается отдельной строкой снизу.
export class Leaderboard {
  isOpen = false;

  private root = document.getElementById("leaderboard")!;
  private titleEl = document.getElementById("lbTitle")!;
  private statusEl = document.getElementById("lbStatus")!;
  private listEl = document.getElementById("lbList")!;
  private prevBtn = document.getElementById("lbPrev")!;
  private nextBtn = document.getElementById("lbNext")!;

  private index = 0;

  constructor(private games: LeaderboardGame[]) {
    document.getElementById("lbClose")!.onclick = () => this.close();
    this.prevBtn.onclick = () => this.step(-1);
    this.nextBtn.onclick = () => this.step(1);
  }

  // Открыть по кнопке и подгрузить с сервера (по умолчанию — первая игра).
  async open(gameId?: string): Promise<void> {
    this.setIndex(gameId);
    this.reveal();
    await this.load();
  }

  // Показать уже готовый борд (после партии); листать всё равно можно.
  showBoard(gameId: string, board: Board): void {
    this.setIndex(gameId);
    this.reveal();
    this.render(board);
  }

  close(): void {
    this.isOpen = false;
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

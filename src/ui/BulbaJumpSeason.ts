import { fetchJumpSeason, type JumpSeason, type LeaderboardEntry } from "../net/api";

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

/** Модалка сезона при входе в офис: таблица, таймер, победитель прошлого сезона. */
export class BulbaJumpSeason {
  isOpen = false;
  onPlay: (() => void) | null = null;
  onLeave: (() => void) | null = null;

  private root = document.getElementById("bjSeason")!;
  private numEl = document.getElementById("bjSeasonNum")!;
  private timerEl = document.getElementById("bjSeasonTimerValue")!;
  private prevEl = document.getElementById("bjSeasonPrev")!;
  private prevNumEl = document.getElementById("bjSeasonPrevNum")!;
  private champEl = document.getElementById("bjSeasonChamp")!;
  private statusEl = document.getElementById("bjSeasonStatus")!;
  private listEl = document.getElementById("bjSeasonList")!;
  private helpWrap = document.getElementById("bjSeasonHelpWrap")!;
  private infoBtn = document.getElementById("bjSeasonInfo")!;

  private token = 0;
  private timer = 0;
  private endsAt = 0;
  private skew = 0;

  constructor() {
    document.getElementById("bjSeasonClose")!.onclick = () => this.onLeave?.();
    document.getElementById("bjSeasonPlay")!.onclick = () => this.onPlay?.();
    this.infoBtn.onclick = () => this.toggleHelp();
  }

  async open(): Promise<void> {
    const token = ++this.token;
    this.isOpen = true;
    this.root.classList.remove("hidden");
    this.hideHelp();
    window.addEventListener("keydown", this.onKey, true);
    this.stopTimer();
    this.numEl.textContent = "";
    this.timerEl.textContent = "";
    this.prevEl.classList.add("hidden");
    this.prevNumEl.textContent = "";
    this.champEl.textContent = "";
    this.statusEl.textContent = "Загрузка...";
    this.listEl.replaceChildren();
    try {
      const data = await fetchJumpSeason();
      if (token !== this.token || !this.isOpen) return;
      this.render(data);
    } catch (e) {
      if (token !== this.token || !this.isOpen) return;
      this.statusEl.textContent = (e as Error).message;
    }
  }

  close(): void {
    this.token++;
    this.isOpen = false;
    this.stopTimer();
    this.hideHelp();
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
  }

  private render(data: JumpSeason): void {
    this.numEl.textContent = `Сезон ${data.number}`;
    const prevSeason = data.previousWinner.season ?? Math.max(0, data.number - 1);
    this.prevNumEl.textContent = String(prevSeason);
    this.champEl.textContent = `${data.previousWinner.login} — ${data.previousWinner.value}`;
    this.prevEl.classList.remove("hidden");
    this.listEl.replaceChildren();
    this.statusEl.textContent = data.entries.length === 0 ? "Пока пусто — стань первым!" : "";

    for (const entry of data.entries) {
      this.listEl.appendChild(this.row(entry));
    }
    if (data.you && !data.entries.some((entry) => entry.you)) {
      const sep = document.createElement("div");
      sep.className = "lb-sep";
      sep.textContent = "···";
      this.listEl.appendChild(sep);
      this.listEl.appendChild(this.row(data.you));
    }

    const ends = Date.parse(data.endsAt);
    const server = Date.parse(data.serverNow);
    if (Number.isNaN(ends) || Number.isNaN(server)) {
      this.timerEl.textContent = "";
      return;
    }
    this.endsAt = ends;
    this.skew = server - Date.now();
    this.tick();
    if (this.endsAt - (Date.now() + this.skew) > 0) {
      this.timer = window.setInterval(() => this.tick(), 1000);
    }
  }

  private tick = (): void => {
    const left = this.endsAt - (Date.now() + this.skew);
    this.timerEl.textContent = formatRemaining(left);
    if (left > 0) return;
    // Ноль на таймере — просим сервер закрыть сезон и сразу показать следующий.
    this.stopTimer();
    this.timer = window.setTimeout(() => void this.refreshAfterEnd(), 1000);
  };

  private async refreshAfterEnd(): Promise<void> {
    this.timer = 0;
    if (!this.isOpen) return;
    const token = this.token;
    try {
      const data = await fetchJumpSeason();
      if (token !== this.token || !this.isOpen) return;
      this.render(data);
    } catch (e) {
      if (token !== this.token || !this.isOpen) return;
      this.statusEl.textContent = (e as Error).message;
      this.timer = window.setTimeout(() => void this.refreshAfterEnd(), 2000);
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }

  private toggleHelp(): void {
    const open = this.helpWrap.classList.toggle("bg-open");
    this.infoBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  private hideHelp(): void {
    this.helpWrap.classList.remove("bg-open");
    this.infoBtn.setAttribute("aria-expanded", "false");
  }

  private helpOpen(): boolean {
    return this.helpWrap.classList.contains("bg-open");
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (this.helpOpen()) {
        this.hideHelp();
        return;
      }
      this.onLeave?.();
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target;
    if (target instanceof HTMLElement && target.closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    this.onPlay?.();
  };

  private row(entry: LeaderboardEntry): HTMLDivElement {
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
    value.textContent = String(entry.value);

    row.append(rank, login, value);
    return row;
  }
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Сезон завершён";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const clock = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  return days > 0 ? `${days}д ${clock}` : clock;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

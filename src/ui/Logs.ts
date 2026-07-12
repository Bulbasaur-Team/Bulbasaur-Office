import { fetchLogs } from "../net/api";

// Окно «логов» с принтера в дата-центре: последние 500 строк событий Бульба Офиса
// в виде, похожем на логи микросервиса.
export class Logs {
  isOpen = false;

  private root = document.getElementById("logs")!;
  private statusEl = document.getElementById("logsStatus")!;
  private outEl = document.getElementById("logsOut")!;

  constructor() {
    document.getElementById("logsClose")!.onclick = () => this.close();
  }

  async open(): Promise<void> {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    this.outEl.textContent = "";
    this.statusEl.textContent = "Загрузка...";
    try {
      const data = await fetchLogs();
      this.statusEl.textContent = data.lines.length === 0 ? "Пока пусто" : "";
      this.outEl.textContent = data.lines.join("\n");
      this.outEl.scrollTop = this.outEl.scrollHeight; // к последним строкам
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
    }
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };
}

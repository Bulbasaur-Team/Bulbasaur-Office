import { fetchCommunity, type CommunityPlayer } from "../net/api";
import { defaultAppearance } from "../data/wardrobe";
import { drawAppearance, loadWardrobeDomImages } from "../entities/PlayerAvatar";

// Окно «Сообщество»: все игроки в порядке регистрации. У каждого аватар
// с надетой одеждой, ник и кнопка «Ачивки: X/Y».
export class Community {
  isOpen = false;

  private root = document.getElementById("community")!;
  private statusEl = document.getElementById("commStatus")!;
  private listEl = document.getElementById("commList")!;
  private images: Map<string, HTMLImageElement> | null = null;

  constructor(private onShowAchievements: (login: string) => void) {
    document.getElementById("commClose")!.onclick = () => this.close();
  }

  async open(): Promise<void> {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    this.listEl.innerHTML = "";
    this.statusEl.textContent = "Загрузка...";
    try {
      if (!this.images) this.images = await loadWardrobeDomImages();
      const data = await fetchCommunity();
      this.statusEl.textContent = data.players.length === 0 ? "Пока никого нет" : "";
      for (const player of data.players) {
        this.listEl.appendChild(this.row(player, data.totalAchievements));
      }
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
    }
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
  }

  private row(player: CommunityPlayer, total: number): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "comm-row";

    const avatar = document.createElement("canvas");
    avatar.className = "comm-avatar";
    avatar.width = 40;
    avatar.height = 40;
    const ctx = avatar.getContext("2d");
    if (ctx && this.images) {
      drawAppearance(ctx, 40, player.appearance ?? defaultAppearance(), this.images);
    }

    const dot = document.createElement("span");
    dot.className = player.online ? "comm-dot comm-dot-online" : "comm-dot";
    dot.title = player.online ? "В сети" : "Не в сети";

    const login = document.createElement("span");
    login.className = "comm-login";
    login.textContent = player.login;

    const achBtn = document.createElement("button");
    achBtn.className = "comm-ach-btn";
    achBtn.textContent = `Ачивки: ${player.owned}/${total}`;
    achBtn.onclick = () => {
      this.close();
      this.onShowAchievements(player.login);
    };

    row.append(avatar, dot, login, achBtn);
    return row;
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

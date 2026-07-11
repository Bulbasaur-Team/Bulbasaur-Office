import { fetchCommunity, type CommunityPlayer } from "../net/api";
import { publicPath } from "../publicPath";
import { spriteForRole } from "../data/roles";
import { SPRITE_FILES } from "../entities/sprites";

// Окно «Сообщество»: все игроки в порядке регистрации. У каждого аватар (картинка
// выбранной роли), ник и кнопка «Ачивки: X/Y», открывающая ачивки этого игрока.
export class Community {
  isOpen = false;

  private root = document.getElementById("community")!;
  private statusEl = document.getElementById("commStatus")!;
  private listEl = document.getElementById("commList")!;

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

    // Аватар — спрайт выбранной роли; роль не выбрана — дефолтный скин.
    const avatar = document.createElement("img");
    avatar.className = "comm-avatar";
    avatar.src = publicPath(`assets/${SPRITE_FILES[spriteForRole(player.role ?? "")]}`);
    avatar.alt = player.login;

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

    row.append(avatar, login, achBtn);
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

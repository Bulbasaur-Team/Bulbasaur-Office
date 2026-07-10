import { fetchAchievements, type Achievement } from "../net/api";
import { publicPath } from "../publicPath";

// Окно «Мои ачивки»: сетка достижений. Полученные — обычная картинка, неполученные —
// в сером фильтре. Сверху счётчик «Получено X/Y ачивок». Закрывается по кнопке или Esc.
export class Achievements {
  isOpen = false;

  private root = document.getElementById("achievements")!;
  private countEl = document.getElementById("achCount")!;
  private statusEl = document.getElementById("achStatus")!;
  private gridEl = document.getElementById("achGrid")!;

  constructor() {
    document.getElementById("achClose")!.onclick = () => this.close();
  }

  async open(): Promise<void> {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    this.gridEl.innerHTML = "";
    this.countEl.textContent = "";
    this.statusEl.textContent = "Загрузка...";
    try {
      const data = await fetchAchievements();
      this.statusEl.textContent = "";
      this.countEl.textContent = `Получено ${data.owned}/${data.total} ачивок`;
      for (const achievement of data.achievements) {
        this.gridEl.appendChild(this.card(achievement));
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

  private card(achievement: Achievement): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "ach-card" + (achievement.owned ? "" : " ach-locked");

    const img = document.createElement("img");
    img.className = "ach-img";
    img.src = publicPath(`achievements/${achievement.image}`);
    img.alt = achievement.title;

    const name = document.createElement("div");
    name.className = "ach-name";
    name.textContent = achievement.title;

    card.append(img, name);
    card.title = achievement.description;
    return card;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };
}

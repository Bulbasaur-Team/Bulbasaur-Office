import { fetchAchievements, fetchPlayerAchievements, type Achievement } from "../net/api";
import { publicPath } from "../publicPath";

// Ачивка редкая, если ею владеет меньше этого процента игроков. Подсвечиваем рамкой
// только полученные редкие — неполученные выглядят как обычные заблокированные.
const RARE_PERCENT = 15;

// Окно ачивок: сетка достижений, отсортированная по редкости (сервер отдаёт от самых
// распространённых к самым редким). Полученные — обычная картинка, неполученные — в сером
// фильтре, у каждой процент игроков-владельцев. Без аргумента показывает свои («Мои ачивки»),
// с логином — чужие (из сообщества). Закрывается по кнопке или Esc.
export class Achievements {
  isOpen = false;

  private root = document.getElementById("achievements")!;
  private titleEl = document.getElementById("achTitle")!;
  private countEl = document.getElementById("achCount")!;
  private statusEl = document.getElementById("achStatus")!;
  private gridEl = document.getElementById("achGrid")!;

  constructor() {
    document.getElementById("achClose")!.onclick = () => this.close();
  }

  async open(login?: string): Promise<void> {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    this.titleEl.textContent = login ? `Ачивки ${login}` : "Мои ачивки";
    this.gridEl.innerHTML = "";
    this.countEl.textContent = "";
    this.statusEl.textContent = "Загрузка...";
    try {
      const data = login ? await fetchPlayerAchievements(login) : await fetchAchievements();
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
    if (achievement.owned && achievement.percent < RARE_PERCENT) card.classList.add("ach-rare");

    const img = document.createElement("img");
    img.className = "ach-img";
    img.src = publicPath(`achievements/${achievement.image}`);
    img.alt = achievement.title;

    const name = document.createElement("div");
    name.className = "ach-name";
    name.textContent = achievement.title;

    const pct = document.createElement("div");
    pct.className = "ach-pct";
    pct.textContent = `${achievement.percent.toFixed(1)}%`;

    card.append(img, name, pct);
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

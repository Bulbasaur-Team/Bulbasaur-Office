// Модалка выбора мини-игры из HUD: сетка кнопок, закрытие или запуск игры.

import { publicPath } from "../publicPath";

export interface BulbaGameOption {
  id: string;
  label: string;
  /** Эмодзи или путь к картинке (если задан image). */
  icon: string;
  image?: string;
}

const GAMES: BulbaGameOption[] = [
  { id: "bulbajump", label: "Bulba Jump", icon: "🚀", image: "assets/bulbajump/jetpack.png" },
  { id: "bulbapacker", label: "Bulba Packer", icon: "📦" },
  { id: "bulbaparking", label: "Bulba Parking", icon: "🚚" },
  { id: "bulbatanks", label: "Bulba Tanks", icon: "💥" },
  { id: "bulbacolors", label: "Bulba Colors", icon: "🎨" },
  { id: "bulbasurki", label: "Bulba Surki", icon: "🦫" },
  { id: "bulbaguess", label: "Bulba Guess", icon: "🔍" },
  { id: "bulbawordle", label: "Bulba Wordle", icon: "5️⃣" },
  { id: "bulbaquiz", label: "Bulba Quiz", icon: "❓" },
];

export class BulbaGames {
  isOpen = false;

  private root = document.getElementById("bulbaGames")!;
  private gridEl = document.getElementById("bgamesGrid")!;

  constructor(private onPick: (gameId: string) => void) {
    document.getElementById("bgamesClose")!.onclick = () => this.close();
    this.render();
  }

  open(): void {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
  }

  private render(): void {
    this.gridEl.innerHTML = "";
    for (const g of GAMES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bgames-card";
      btn.setAttribute("aria-label", g.label);

      let icon: HTMLElement;
      if (g.image) {
        const img = document.createElement("img");
        img.className = "bgames-icon bgames-icon-img";
        img.src = publicPath(g.image);
        img.alt = "";
        img.setAttribute("aria-hidden", "true");
        icon = img;
      } else {
        const span = document.createElement("span");
        span.className = "bgames-icon";
        span.textContent = g.icon;
        span.setAttribute("aria-hidden", "true");
        icon = span;
      }

      const name = document.createElement("span");
      name.className = "bgames-name";
      name.textContent = g.label;

      btn.append(icon, name);
      btn.onclick = () => {
        this.close();
        this.onPick(g.id);
      };
      this.gridEl.appendChild(btn);
    }
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

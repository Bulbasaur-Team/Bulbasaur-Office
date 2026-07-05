export type GameMode = "single" | "multiplayer";

interface ModeOption {
  mode: GameMode;
  icon: string;
  title: string;
  desc: string;
}

const OPTIONS: ModeOption[] = [
  { mode: "single", icon: "🎮", title: "Одиночная игра", desc: "Ходи по офису, общайся с командой, играй в мини-игры." },
  { mode: "multiplayer", icon: "🌐", title: "Мультиплеер", desc: "Выбери роль и играй вместе с другими онлайн." },
];

// Экран выбора режима после авторизации.
export function showModeSelect(onPick: (mode: GameMode) => void): void {
  const root = document.getElementById("modeSelect")!;
  const cards = document.getElementById("modeCards")!;
  cards.innerHTML = "";

  for (const opt of OPTIONS) {
    const card = document.createElement("div");
    card.className = "mode-card";
    card.innerHTML =
      `<div class="mode-icon">${opt.icon}</div>` +
      `<div class="nm">${opt.title}</div>` +
      `<div class="rl">${opt.desc}</div>`;
    card.onclick = () => {
      root.classList.add("hidden");
      onPick(opt.mode);
    };
    cards.appendChild(card);
  }

  root.classList.remove("hidden");
}

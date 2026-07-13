import { nestedUrl } from "../embed";
import { publicPath } from "../publicPath";
import { spriteForRole } from "../data/roles";
import { SPRITE_FILES } from "../entities/sprites";
import { isTouch } from "./TouchControls";

// Компьютер в дата-центре: корпус с экраном, на экране — рабочий стол в духе Windows XP
// с единственным ярлыком. Ярлык запускает эту же игру во вложенном iframe (одиночный
// режим, без мини-игр — см. embed.ts). Игра внутри живёт, пока открыто её окно: закрытие
// окна сносит iframe, и вложенная копия останавливается.
export class Computer {
  isOpen = false;

  private root = document.getElementById("computer")!;
  private shortcut = document.getElementById("xpShortcut")!;
  private windowEl = document.getElementById("xpWindow")!;
  private windowBody = document.getElementById("xpWindowBody")!;
  private startMenu = document.getElementById("xpStartMenu")!;
  private clock = document.getElementById("xpClock")!;
  private frame: HTMLIFrameElement | null = null;
  private clockTimer = 0;

  constructor() {
    const icon = document.getElementById("xpShortcutImg") as HTMLImageElement;
    icon.src = publicPath(`assets/${SPRITE_FILES[spriteForRole("")]}`);

    // На десктопе ярлык запускается двойным кликом (как в XP), на тапе — одиночным.
    if (isTouch()) this.shortcut.onclick = () => this.launch();
    else this.shortcut.ondblclick = () => this.launch();

    document.getElementById("xpWindowClose")!.onclick = () => this.closeApp();
    document.getElementById("xpStart")!.onclick = () => this.toggleStartMenu();
    document.getElementById("xpShutdown")!.onclick = () => this.close();
    document.getElementById("pcPower")!.onclick = () => this.close();
  }

  open(): void {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    this.tickClock();
    this.clockTimer = window.setInterval(() => this.tickClock(), 30_000);
  }

  close(): void {
    this.isOpen = false;
    this.closeApp();
    this.startMenu.classList.add("hidden");
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
    window.clearInterval(this.clockTimer);
  }

  private launch(): void {
    if (this.frame) return;
    this.frame = document.createElement("iframe");
    this.frame.className = "xp-frame";
    this.frame.src = nestedUrl();
    this.windowBody.appendChild(this.frame);
    this.windowEl.classList.remove("hidden");
    this.startMenu.classList.add("hidden");
  }

  // Снести iframe, а не спрятать: вложенная игра иначе продолжала бы крутиться.
  private closeApp(): void {
    this.frame?.remove();
    this.frame = null;
    this.windowEl.classList.add("hidden");
  }

  private toggleStartMenu(): void {
    this.startMenu.classList.toggle("hidden");
  }

  private tickClock(): void {
    this.clock.textContent = new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Escape доходит сюда, только пока фокус вне iframe: события клавиш из вложенной
  // копии наружу не всплывают. Поэтому у корпуса есть ещё и кнопка питания.
  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };
}

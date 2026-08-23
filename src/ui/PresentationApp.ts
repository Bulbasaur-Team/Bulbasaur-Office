import { PRESENTATION_QUEST } from "../data/presentationQuest";
import { PRESENTATION_SLIDES, slideAsset, type SlideSource } from "../data/presentationSlides";

export interface PresentationDesktop {
  visible: () => boolean;
  diyMade: () => boolean;
  claudePaid: () => boolean;
  makeDiy: () => void;
}

/** Приложение «Презентация» на рабочем столе ноутбука. */
export class PresentationApp {
  running = false;
  maximized = false;

  private windowEl = document.getElementById("macPresWindow")!;
  private bodyEl = document.getElementById("macPresBody")!;
  private building = false;
  private view: SlideSource | null = null;
  private index = 0;
  private buildTimer = 0;

  constructor(
    private onCloseRequest: () => void,
    private desktop: PresentationDesktop,
  ) {
    document.getElementById("macPresClose")!.onclick = () => this.onCloseRequest();
    document.getElementById("macPresMin")!.onclick = () => this.minimize();
    document.getElementById("macPresMax")!.onclick = () => this.toggleMaximize();
  }

  open(fresh: boolean): void {
    this.running = true;
    this.windowEl.classList.remove("hidden", "is-minimized");
    this.windowEl.classList.toggle("is-maximized", this.maximized);
    if (fresh) {
      this.view = null;
      this.index = 0;
    }
    this.render();
  }

  stash(): void {
    this.windowEl.classList.add("hidden");
  }

  close(): void {
    window.clearTimeout(this.buildTimer);
    this.building = false;
    this.running = false;
    this.maximized = false;
    this.view = null;
    this.windowEl.classList.add("hidden");
    this.windowEl.classList.remove("is-minimized", "is-maximized");
  }

  minimize(): void {
    this.windowEl.classList.add("is-minimized");
    this.windowEl.classList.remove("is-maximized");
  }

  restore(): void {
    this.windowEl.classList.remove("hidden", "is-minimized");
    this.windowEl.classList.toggle("is-maximized", this.maximized);
  }

  toggleMaximize(): void {
    if (this.windowEl.classList.contains("is-minimized")) {
      this.restore();
      this.windowEl.classList.add("is-maximized");
      this.maximized = true;
      return;
    }
    this.maximized = this.windowEl.classList.toggle("is-maximized");
  }

  unmaximize(): void {
    this.windowEl.classList.remove("is-maximized");
    this.maximized = false;
  }

  isVisible(): boolean {
    return (
      this.running
      && !this.windowEl.classList.contains("hidden")
      && !this.windowEl.classList.contains("is-minimized")
    );
  }

  isMaximized(): boolean {
    return this.windowEl.classList.contains("is-maximized");
  }

  handleEscape(): "consumed" | "close-app" {
    if (this.view) {
      this.view = null;
      this.render();
      return "consumed";
    }
    return "close-app";
  }

  refresh(): void {
    if (this.running && this.isVisible()) this.render();
  }

  private render(): void {
    this.bodyEl.replaceChildren();
    if (this.building) {
      const wait = document.createElement("div");
      wait.className = "mac-pres-wait";
      wait.textContent = "Собираю слайды самостоятельно…";
      this.bodyEl.appendChild(wait);
      return;
    }
    if (this.view) {
      this.renderViewer(this.view);
      return;
    }
    this.renderHome();
  }

  private renderHome(): void {
    const home = document.createElement("div");
    home.className = "mac-pres-home";

    const title = document.createElement("div");
    title.className = "mac-pres-heading";
    title.textContent = "Презентация на День X";
    home.appendChild(title);

    if (!this.desktop.diyMade()) {
      const hint = document.createElement("p");
      hint.className = "mac-pres-hint";
      hint.textContent = "Готовых слайдов нет. Нейросети отказались. Остаётся сделать самому.";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mac-pres-primary";
      btn.textContent = "Сделать презентацию самостоятельно";
      btn.onclick = () => this.startDiy();
      home.append(hint, btn);
    } else {
      const mine = document.createElement("button");
      mine.type = "button";
      mine.className = "mac-pres-primary";
      mine.textContent = "Посмотреть свою презентацию";
      mine.onclick = () => this.openViewer("diy");
      home.appendChild(mine);

      if (this.desktop.claudePaid()) {
        const claude = document.createElement("button");
        claude.type = "button";
        claude.className = "mac-pres-secondary";
        claude.textContent = "Посмотреть презентацию Claude";
        claude.onclick = () => this.openViewer("claude");
        home.appendChild(claude);
      } else {
        const hint = document.createElement("p");
        hint.className = "mac-pres-hint";
        hint.textContent = "Покажи свою версию Бульбулю в Bulba Talk. Потом, если повезёт, появится вторая.";
        home.appendChild(hint);
      }
    }

    this.bodyEl.appendChild(home);
  }

  private startDiy(): void {
    this.building = true;
    this.render();
    this.buildTimer = window.setTimeout(() => {
      this.building = false;
      this.desktop.makeDiy();
      this.view = "diy";
      this.index = 0;
      this.render();
    }, PRESENTATION_QUEST.timings.diyBuildMs);
  }

  private openViewer(source: SlideSource): void {
    this.view = source;
    this.index = 0;
    this.render();
  }

  private renderViewer(source: SlideSource): void {
    const slide = PRESENTATION_SLIDES[this.index]!;
    const wrap = document.createElement("div");
    wrap.className = "mac-pres-viewer";

    const media = source === "claude"
      ? document.createElement("iframe")
      : document.createElement("img");
    media.className = "mac-pres-slide";
    media.src = slideAsset(source, slide.id);
    media.title = slide.title;
    if (media instanceof HTMLIFrameElement) {
      media.tabIndex = -1;
    } else {
      media.alt = slide.title;
      media.draggable = false;
    }

    const nav = document.createElement("div");
    nav.className = "mac-pres-nav";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "←";
    prev.disabled = this.index === 0;
    prev.onclick = () => {
      this.index = Math.max(0, this.index - 1);
      this.render();
    };

    const label = document.createElement("div");
    label.className = "mac-pres-nav-label";
    label.textContent = `${this.index + 1} / ${PRESENTATION_SLIDES.length}  ·  ${
      source === "diy" ? "своя" : "Claude"
    }`;

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "→";
    next.disabled = this.index >= PRESENTATION_SLIDES.length - 1;
    next.onclick = () => {
      this.index = Math.min(PRESENTATION_SLIDES.length - 1, this.index + 1);
      this.render();
    };

    const back = document.createElement("button");
    back.type = "button";
    back.className = "mac-pres-back";
    back.textContent = "К наборам";
    back.onclick = () => {
      this.view = null;
      this.render();
    };

    nav.append(prev, label, next);
    wrap.append(media, nav, back);
    this.bodyEl.appendChild(wrap);
  }
}

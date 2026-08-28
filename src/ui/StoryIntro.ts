import type { KeyConsumer } from "./KeyboardRouter";

const STORAGE_KEY = "bulba_story_intro_v1";

/** Первый заход: коротко про необязательный сюжет и звонки. */
export class StoryIntro implements KeyConsumer {
  private root = document.getElementById("storyIntro")!;
  private okBtn = document.getElementById("storyIntroOk")!;
  isOpen = false;
  private done: (() => void) | null = null;

  constructor() {
    this.okBtn.onclick = () => this.dismiss();
  }

  showIfNeeded(): Promise<void> {
    if (localStorage.getItem(STORAGE_KEY)) return Promise.resolve();
    this.isOpen = true;
    this.root.classList.remove("hidden");
    this.okBtn.focus();
    return new Promise((resolve) => {
      this.done = resolve;
    });
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (e.code === "Enter" || e.code === "Space" || e.code === "Escape") {
      this.dismiss();
    }
    return true;
  }

  private dismiss(): void {
    if (!this.isOpen) return;
    localStorage.setItem(STORAGE_KEY, "1");
    this.isOpen = false;
    this.root.classList.add("hidden");
    this.done?.();
    this.done = null;
  }
}

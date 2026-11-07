import { getLogin } from "../net/api";
import type { KeyConsumer } from "./KeyboardRouter";

const STORAGE_KEY = "bulba_story_intro_v1";

/** Первый заход аккаунта: коротко про необязательный сюжет и звонки. */
export class StoryIntro implements KeyConsumer {
  private root = document.getElementById("storyIntro")!;
  private okBtn = document.getElementById("storyIntroOk")!;
  isOpen = false;
  private done: (() => void) | null = null;
  private pending: Promise<void> | null = null;

  constructor() {
    this.okBtn.onclick = () => this.dismiss();
  }

  showIfNeeded(): Promise<void> {
    if (localStorage.getItem(seenKey())) return Promise.resolve();
    if (this.pending) return this.pending;
    this.isOpen = true;
    this.root.classList.remove("hidden");
    this.okBtn.focus();
    this.pending = new Promise((resolve) => {
      this.done = resolve;
    });
    return this.pending;
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
    localStorage.setItem(seenKey(), "1");
    localStorage.removeItem(STORAGE_KEY);
    this.isOpen = false;
    this.root.classList.add("hidden");
    const done = this.done;
    this.done = null;
    this.pending = null;
    done?.();
  }
}

function seenKey(): string {
  const login = getLogin();
  return login ? `${STORAGE_KEY}:${login}` : STORAGE_KEY;
}

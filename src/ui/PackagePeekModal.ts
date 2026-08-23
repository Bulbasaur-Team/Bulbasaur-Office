import { PACKAGE_PEEK } from "../data/packageQuest";
import type { KeyConsumer } from "./KeyboardRouter";
import { publicPath } from "../publicPath";

/** Модалки развилки посылки: заглянуть / сохранить тайну, фото, провал. */
export class PackagePeekModal implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("packagePeek")!;
  private choiceEl = document.getElementById("packagePeekChoice")!;
  private photoEl = document.getElementById("packagePeekPhoto")!;
  private failEl = document.getElementById("packagePeekFail")!;
  private img = document.getElementById("packagePeekImg") as HTMLImageElement;

  constructor() {
    this.img.src = publicPath(PACKAGE_PEEK.image);
    this.img.alt = PACKAGE_PEEK.photoAlt;
    document.getElementById("packagePeekLook")!.onclick = () => this.look();
    document.getElementById("packagePeekKeep")!.onclick = () => this.keep();
    document.getElementById("packagePeekContinue")!.onclick = () => this.afterPhoto();
    document.getElementById("packagePeekFailOk")!.onclick = () => this.afterFail();
  }

  private onKeep: (() => void) | null = null;
  private onLook: (() => void) | null = null;
  private onPhotoDone: (() => void) | null = null;
  private onFailDone: (() => void) | null = null;

  showChoice(handlers: { onLook: () => void; onKeep: () => void }): void {
    this.onLook = handlers.onLook;
    this.onKeep = handlers.onKeep;
    this.showPanel("choice");
  }

  showFail(onDone: () => void): void {
    this.onFailDone = onDone;
    this.showPanel("fail");
  }

  hide(): void {
    this.isOpen = false;
    this.panel = "choice";
    this.root.classList.add("hidden");
    this.onKeep = null;
    this.onLook = null;
    this.onPhotoDone = null;
    this.onFailDone = null;
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (e.code === "Enter" || e.code === "Space") {
      if (this.panel === "photo") this.afterPhoto();
      else if (this.panel === "fail") this.afterFail();
      return true;
    }
    return true;
  }

  private panel: "choice" | "photo" | "fail" = "choice";

  private showPanel(panel: "choice" | "photo" | "fail"): void {
    this.isOpen = true;
    this.panel = panel;
    this.root.classList.remove("hidden");
    this.choiceEl.classList.toggle("hidden", panel !== "choice");
    this.photoEl.classList.toggle("hidden", panel !== "photo");
    this.failEl.classList.toggle("hidden", panel !== "fail");
  }

  private look(): void {
    const next = this.onLook;
    this.onLook = null;
    this.onKeep = null;
    this.onPhotoDone = next;
    this.showPanel("photo");
  }

  private keep(): void {
    const next = this.onKeep;
    this.hide();
    next?.();
  }

  private afterPhoto(): void {
    const next = this.onPhotoDone;
    this.hide();
    next?.();
  }

  private afterFail(): void {
    const next = this.onFailDone;
    this.hide();
    next?.();
  }
}

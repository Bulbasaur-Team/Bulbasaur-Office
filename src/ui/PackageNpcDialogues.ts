import { BEACH_QUEST, DRIVER_QUEST, matchesPackageSecretCode } from "../data/packageQuest";
import type { KeyConsumer } from "./KeyboardRouter";
import { typeWithVoice } from "./CharacterVoice";

const BUBBLE_CHAR_MS = Math.round(22 * 2.5);

/** Облачко над водителем на парковке (DOM; позиция — от канваса через layoutToCanvas). */
export class DriverBubble {
  private root = document.getElementById("driverBubble")!;
  private textEl = document.getElementById("driverBubbleText")!;
  private cancel: (() => void) | null = null;

  get el(): HTMLElement {
    return this.root;
  }

  show(text: string): void {
    this.cancel?.();
    this.root.classList.remove("hidden");
    this.cancel = typeWithVoice(this.textEl, text, "driver", () => {
      this.cancel = null;
    }, BUBBLE_CHAR_MS);
  }

  hide(): void {
    this.cancel?.();
    this.cancel = null;
    this.textEl.textContent = "";
    this.root.classList.add("hidden");
  }
}

interface DriverDialogueHandlers {
  questActive: () => boolean;
  hasPackage: () => boolean;
  driverBriefed: () => boolean;
  onBriefed: () => void;
  onSay: (text: string) => void;
  onDeliver: () => Promise<{ ok: boolean; deliverLine: string; errorLine?: string }>;
  onClose: () => void;
}

/** Разговор с водителем на парковке (DOM #dialogue + облачко над водителем). */
export class DriverDialogue implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("dialogue")!;
  private optionsEl = document.getElementById("dlgOptions")!;
  private inputWrap = document.getElementById("dlgInputWrap")!;

  private index = 0;
  private lines: { label: string; action: () => void }[] = [];

  constructor(private handlers: DriverDialogueHandlers) {}

  open(): void {
    this.isOpen = true;
    this.index = 0;
    this.hideInput();
    // Снимаем фокус с кнопок парковки — иначе стрелки не доходят до диалога.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.renderMenu();
    this.root.classList.remove("hidden");
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.hideInput();
    this.optionsEl.innerHTML = "";
    this.lines = [];
    this.root.classList.add("hidden");
    this.handlers.onClose();
  }

  private renderMenu(): void {
    this.lines = [];
    if (this.handlers.questActive()) {
      if (this.handlers.hasPackage()) {
        this.lines.push({ label: DRIVER_QUEST.giveLabel, action: () => void this.deliver() });
      }
      this.lines.push({
        label: this.handlers.driverBriefed()
          ? DRIVER_QUEST.askAgainLabel
          : "Про пропавшую посылку…",
        action: () => this.talkAboutPackage(),
      });
    }
    this.lines.push({ label: "Поеду дальше", action: () => this.close() });
    this.index = 0;
    this.renderOptions();
  }

  private talkAboutPackage(): void {
    if (this.handlers.driverBriefed()) {
      this.handlers.onSay(DRIVER_QUEST.alreadyTalked);
      this.lines = [{ label: "Понятно", action: () => this.renderMenu() }];
      this.index = 0;
      this.renderOptions();
      return;
    }
    this.handlers.onSay(DRIVER_QUEST.firstTalk);
    this.lines = [
      { label: DRIVER_QUEST.whereGoneLabel, action: () => this.afterFirstTalk() },
      { label: DRIVER_QUEST.gotItLabel, action: () => this.afterFirstTalk() },
    ];
    this.index = 0;
    this.renderOptions();
  }

  private afterFirstTalk(): void {
    this.handlers.onBriefed();
    this.handlers.onSay(DRIVER_QUEST.firstTalkFollowup);
    this.lines = [{ label: "Понятно", action: () => this.renderMenu() }];
    this.index = 0;
    this.renderOptions();
  }

  private async deliver(): Promise<void> {
    const res = await this.handlers.onDeliver();
    this.handlers.onSay(res.ok ? res.deliverLine : (res.errorLine ?? DRIVER_QUEST.noPackageYet));
    this.lines = [{ label: "Понятно", action: () => (res.ok ? this.close() : this.renderMenu()) }];
    this.index = 0;
    this.renderOptions();
  }

  private hideInput(): void {
    this.inputWrap.classList.add("hidden");
  }

  private renderOptions(): void {
    this.optionsEl.innerHTML = "";
    this.lines.forEach((o, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.className = "opt" + (i === this.index ? " sel" : "");
      b.textContent = o.label;
      b.onmouseenter = () => {
        this.index = i;
        this.refreshSel();
      };
      b.onclick = () => this.choose(i);
      this.optionsEl.appendChild(b);
    });
  }

  private refreshSel(): void {
    [...this.optionsEl.children].forEach((el, i) =>
      el.classList.toggle("sel", i === this.index),
    );
  }

  private choose(i: number): void {
    this.lines[i]?.action();
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    const n = this.lines.length;
    if (!n) return false;
    const up = e.code === "ArrowUp" || e.code === "KeyW" || e.key === "ArrowUp";
    const down = e.code === "ArrowDown" || e.code === "KeyS" || e.key === "ArrowDown";
    if (up) {
      this.index = (this.index + n - 1) % n;
      this.refreshSel();
      return true;
    }
    if (down) {
      this.index = (this.index + 1) % n;
      this.refreshSel();
      return true;
    }
    if (e.code === "Enter" || e.code === "Space") {
      this.choose(this.index);
      return true;
    }
    if (e.code === "Escape") {
      this.close();
      return true;
    }
    return false;
  }
}

interface BeachNpcDialogueHandlers {
  onSay: (text: string) => void;
  /** Пароль уже принят (повтор после провала). */
  codeAccepted: () => boolean;
  onCodeAccepted: () => void;
  onCodeOk: () => void;
  onClose: () => void;
}

type BeachPhase = "menu" | "input";

/** Диалог с вьетнамцем на пляже (DOM #dialogue + облачко). */
export class BeachNpcDialogue implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("dialogue")!;
  private optionsEl = document.getElementById("dlgOptions")!;
  private inputWrap = document.getElementById("dlgInputWrap")!;
  private input = document.getElementById("dlgInput") as HTMLInputElement;
  private inputSubmit = document.getElementById("dlgInputSubmit")!;

  private index = 0;
  private phase: BeachPhase = "menu";
  private lines: { label: string; action: () => void }[] = [];
  private done = false;

  constructor(private handlers: BeachNpcDialogueHandlers) {
    this.inputSubmit.addEventListener("click", () => this.submitCode());
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.submitCode();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }

  open(): void {
    this.isOpen = true;
    this.done = false;
    this.phase = "menu";
    this.hideInput();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (this.handlers.codeAccepted()) {
      this.showTakeReady();
    } else {
      this.handlers.onSay(BEACH_QUEST.greet);
      this.lines = [
        { label: BEACH_QUEST.askCodeLabel, action: () => this.openInput() },
        { label: BEACH_QUEST.byeLabel, action: () => this.close() },
      ];
      this.index = 0;
      this.renderOptions();
    }
    this.root.classList.remove("hidden");
  }

  private showTakeReady(): void {
    this.done = true;
    this.handlers.onSay(BEACH_QUEST.correct);
    this.lines = [
      {
        label: "Забрать посылку",
        action: () => {
          this.handlers.onCodeOk();
          this.close();
        },
      },
    ];
    this.index = 0;
    this.renderOptions();
  }

  close(): void {
    this.isOpen = false;
    this.phase = "menu";
    this.hideInput();
    this.root.classList.add("hidden");
    this.handlers.onClose();
  }

  private openInput(): void {
    this.phase = "input";
    this.optionsEl.innerHTML = "";
    this.inputWrap.classList.remove("hidden");
    this.input.value = "";
    this.input.placeholder = BEACH_QUEST.codePlaceholder;
    this.input.focus();
  }

  private submitCode(): void {
    if (this.phase !== "input" || this.done) return;
    const ok = matchesPackageSecretCode(this.input.value);
    this.hideInput();
    this.phase = "menu";
    if (!ok) {
      this.handlers.onSay(BEACH_QUEST.wrong);
      this.lines = [
        { label: BEACH_QUEST.askCodeLabel, action: () => this.openInput() },
        { label: BEACH_QUEST.byeLabel, action: () => this.close() },
      ];
      this.index = 0;
      this.renderOptions();
      return;
    }
    this.handlers.onCodeAccepted();
    this.showTakeReady();
  }

  private hideInput(): void {
    this.inputWrap.classList.add("hidden");
  }

  private renderOptions(): void {
    this.optionsEl.innerHTML = "";
    this.lines.forEach((o, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.className = "opt" + (i === this.index ? " sel" : "");
      b.textContent = o.label;
      b.onmouseenter = () => {
        this.index = i;
        this.refreshSel();
      };
      b.onclick = () => this.choose(i);
      this.optionsEl.appendChild(b);
    });
  }

  private refreshSel(): void {
    [...this.optionsEl.children].forEach((el, i) =>
      el.classList.toggle("sel", i === this.index),
    );
  }

  private choose(i: number): void {
    this.lines[i]?.action();
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (this.phase === "input") return false;
    const n = this.lines.length;
    if (!n) return false;
    const up = e.code === "ArrowUp" || e.code === "KeyW" || e.key === "ArrowUp";
    const down = e.code === "ArrowDown" || e.code === "KeyS" || e.key === "ArrowDown";
    if (up) {
      this.index = (this.index + n - 1) % n;
      this.refreshSel();
      return true;
    }
    if (down) {
      this.index = (this.index + 1) % n;
      this.refreshSel();
      return true;
    }
    if (e.code === "Enter" || e.code === "Space") {
      this.choose(this.index);
      return true;
    }
    if (e.code === "Escape") {
      this.close();
      return true;
    }
    return false;
  }
}

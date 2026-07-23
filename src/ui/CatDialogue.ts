import { BULBA_CAT } from "../data/bulbaCat";
import type { KeyConsumer } from "./KeyboardRouter";

interface CatDialogueHandlers {
  onOpen?: () => void;
  /** Русский текст реплики кота (в облачке сначала мяуканье). */
  onSay: (russianText: string) => void;
  /** Запросить совет с сервера. */
  onAdvice: () => void;
  onClose: () => void;
}

type Action = "ask" | "advice" | "bye";

interface Option {
  label: string;
  action: Action;
}

const OPTIONS: Option[] = [
  { label: BULBA_CAT.question, action: "ask" },
  { label: BULBA_CAT.adviceLabel, action: "advice" },
  { label: "Бывай", action: "bye" },
];

/** Диалог с Бульба Котом. Переиспользует DOM #dialogue. */
export class CatDialogue implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("dialogue")!;
  private optionsEl = document.getElementById("dlgOptions")!;
  private options = OPTIONS;
  private index = 0;

  constructor(private handlers: CatDialogueHandlers) {}

  open(): void {
    this.isOpen = true;
    this.index = 0;
    this.renderOptions();
    this.root.classList.remove("hidden");
    this.handlers.onOpen?.();
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add("hidden");
    this.handlers.onClose();
  }

  private renderOptions(): void {
    this.optionsEl.innerHTML = "";
    this.options.forEach((o, i) => {
      const b = document.createElement("button");
      b.type = "button";
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
    switch (this.options[i].action) {
      case "ask":
        this.handlers.onSay(BULBA_CAT.answerRu);
        break;
      case "advice":
        this.handlers.onAdvice();
        break;
      case "bye":
        this.close();
        break;
    }
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    switch (e.code) {
      case "ArrowLeft":
      case "KeyA":
        this.index = (this.index + this.options.length - 1) % this.options.length;
        this.refreshSel();
        return true;
      case "ArrowRight":
      case "KeyD":
        this.index = (this.index + 1) % this.options.length;
        this.refreshSel();
        return true;
      case "Enter":
      case "Space":
        this.choose(this.index);
        return true;
      case "Escape":
        this.close();
        return true;
      default:
        return false;
    }
  }
}

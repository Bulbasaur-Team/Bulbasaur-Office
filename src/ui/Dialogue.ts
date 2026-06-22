import type { Character } from "../data/characters";

type Action = "who" | "doing" | "did" | "bye" | "show" | "later";
interface Option {
  label: string;
  action: Action;
}

const MAIN_OPTIONS: Option[] = [
  { label: "Ты кто?", action: "who" },
  { label: "Что тут делаешь?", action: "doing" },
  { label: "Есть апдейты с прошлого демо?", action: "did" },
  { label: "Бывай", action: "bye" },
];

// Появляется после вопроса про демо, когда NPC предлагает показать слайды.
const SLIDE_OPTIONS: Option[] = [
  { label: "Давай", action: "show" },
  { label: "Потом гляну", action: "later" },
];

interface DialogueHandlers {
  onSay: (text: string) => void;            // реплика NPC — печатается в облачке над ним
  onShowSlides: (npc: Character) => void;   // открыть окно слайдов
  onClose: () => void;
}

export class Dialogue {
  isOpen = false;
  paused = false; // true, пока поверх открыто окно слайдов — клавиши меню игнорируются

  private root = document.getElementById("dialogue")!;
  private optionsEl = document.getElementById("dlgOptions")!;

  private options: Option[] = MAIN_OPTIONS;
  private index = 0;
  private npc: Character | null = null;

  constructor(private handlers: DialogueHandlers) {
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  open(npc: Character): void {
    this.npc = npc;
    this.isOpen = true;
    this.setOptions(MAIN_OPTIONS);
    this.root.classList.remove("hidden");
    this.handlers.onSay(npc.lines.greet);
  }

  close(): void {
    this.isOpen = false;
    this.npc = null;
    this.root.classList.add("hidden");
    this.handlers.onClose();
  }

  private setOptions(options: Option[]): void {
    this.options = options;
    this.index = 0;
    this.renderOptions();
  }

  private renderOptions(): void {
    this.optionsEl.innerHTML = "";
    this.options.forEach((o, i) => {
      const b = document.createElement("button");
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
    if (!this.npc) return;
    switch (this.options[i].action) {
      case "who":
        this.handlers.onSay(this.npc.lines.who);
        break;
      case "doing":
        this.handlers.onSay(this.npc.lines.doing);
        break;
      case "did":
        this.handlers.onSay(this.npc.lines.did);
        this.setOptions(SLIDE_OPTIONS);
        break;
      case "show":
        this.handlers.onShowSlides(this.npc);
        this.setOptions(MAIN_OPTIONS);
        break;
      case "later":
        this.setOptions(MAIN_OPTIONS);
        break;
      case "bye":
        this.close();
        break;
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen || this.paused) return;
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      this.index = (this.index + this.options.length - 1) % this.options.length;
      this.refreshSel();
    } else if (e.code === "ArrowRight" || e.code === "KeyD") {
      this.index = (this.index + 1) % this.options.length;
      this.refreshSel();
    } else if (e.code === "Enter" || e.code === "Space") {
      this.choose(this.index);
    } else if (e.code === "Escape") {
      this.close();
    }
  }
}

import { BULBA_CAT } from "../data/bulbaCat";
import { CAT_PACKAGE_QUEST } from "../data/packageQuest";
import { CAT_QUEST, matchesCatAnswer } from "../data/quests";
import type { KeyConsumer } from "./KeyboardRouter";

interface CatDialogueHandlers {
  onOpen?: () => void;
  /** Русский текст реплики кота (в облачке сначала мяуканье). */
  onSay: (russianText: string) => void;
  /** Запросить совет с сервера. */
  onAdvice: () => void;
  onClose: () => void;
  /** Квест fridge_pin в статусе IN_PROGRESS. */
  questActive?: () => boolean;
  /** Квест lost_package в статусе IN_PROGRESS. */
  packageQuestActive?: () => boolean;
}

type Action = "ask" | "advice" | "quest" | "package" | "bye";

interface Option {
  label: string;
  action: Action;
}

type Phase = "menu" | "questDescribe" | "questInput";

/** Диалог с Бульба Котом. Переиспользует DOM #dialogue. */
export class CatDialogue implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("dialogue")!;
  private optionsEl = document.getElementById("dlgOptions")!;
  private inputWrap = document.getElementById("dlgInputWrap")!;
  private input = document.getElementById("dlgInput") as HTMLInputElement;
  private inputSubmit = document.getElementById("dlgInputSubmit")!;

  private options: Option[] = [];
  private index = 0;
  private phase: Phase = "menu";

  constructor(private handlers: CatDialogueHandlers) {
    this.inputSubmit.addEventListener("click", () => this.submitQuestAnswer());
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.submitQuestAnswer();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }

  open(): void {
    this.isOpen = true;
    this.phase = "menu";
    this.index = 0;
    this.hideInput();
    this.renderMenu();
    this.root.classList.remove("hidden");
    this.handlers.onOpen?.();
  }

  close(): void {
    this.isOpen = false;
    this.phase = "menu";
    this.hideInput();
    this.root.classList.add("hidden");
    this.handlers.onClose();
  }

  private renderMenu(): void {
    this.phase = "menu";
    this.hideInput();
    this.options = [
      { label: BULBA_CAT.question, action: "ask" },
      { label: BULBA_CAT.adviceLabel, action: "advice" },
    ];
    if (this.handlers.questActive?.()) {
      this.options.push({ label: CAT_QUEST.optionLabel, action: "quest" });
    }
    if (this.handlers.packageQuestActive?.()) {
      this.options.push({ label: CAT_PACKAGE_QUEST.optionLabel, action: "package" });
    }
    this.options.push({ label: "Бывай", action: "bye" });
    this.index = 0;
    this.renderOptions();
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
    const opt = this.options[i];
    if (!opt) return;
    switch (opt.action) {
      case "ask":
        this.handlers.onSay(BULBA_CAT.answerRu);
        break;
      case "advice":
        this.handlers.onAdvice();
        break;
      case "quest":
        this.openQuestDescribe();
        break;
      case "package":
        this.handlers.onSay(CAT_PACKAGE_QUEST.answer);
        break;
      case "bye":
        this.close();
        break;
    }
  }

  private openQuestDescribe(): void {
    this.phase = "questDescribe";
    this.options = [
      { label: CAT_QUEST.describeLabel, action: "quest" },
      { label: "Назад", action: "bye" },
    ];
    // Переиспользуем actions локально в chooseQuestDescribe
    this.index = 0;
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
      b.onclick = () => {
        if (i === 0) this.openQuestInput();
        else this.renderMenu();
      };
      this.optionsEl.appendChild(b);
    });
  }

  private openQuestInput(): void {
    this.phase = "questInput";
    this.optionsEl.innerHTML = "";
    this.handlers.onSay(CAT_QUEST.askHistory);
    this.input.placeholder = CAT_QUEST.inputPlaceholder;
    this.input.value = "";
    this.inputWrap.classList.remove("hidden");
    this.input.focus();
  }

  private submitQuestAnswer(): void {
    if (this.phase !== "questInput") return;
    const answer = this.input.value;
    this.hideInput();
    if (matchesCatAnswer(answer)) {
      this.handlers.onSay(CAT_QUEST.correct);
      this.renderMenu();
      return;
    }
    this.handlers.onSay(CAT_QUEST.wrong);
    this.renderMenu();
  }

  private hideInput(): void {
    this.inputWrap.classList.add("hidden");
    this.input.value = "";
    this.input.blur();
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (this.phase === "questInput") {
      // Фокус в инпуте — не перехватываем стрелки/ввод; Escape закрывает.
      if (e.code === "Escape") {
        this.close();
        return true;
      }
      return false;
    }
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
        if (this.phase === "questDescribe") {
          if (this.index === 0) this.openQuestInput();
          else this.renderMenu();
          return true;
        }
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

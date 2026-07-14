import { CHARACTERS, type Character } from "../data/characters";
import type { KeyConsumer } from "./KeyboardRouter";

/** Персонажи, у которых есть свои слайды (sample не считается). */
export function slideOwners(): Character[] {
  return CHARACTERS.filter((c) => c.slideCount > 0);
}

/**
 * Выбор чьи слайды показать на проекторе.
 * Если колоды нет — текст «Загрузите слайды».
 */
export class SlidePicker implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("slidePicker")!;
  private titleEl = document.getElementById("slidePickerTitle")!;
  private optionsEl = document.getElementById("slidePickerOptions")!;
  private emptyEl = document.getElementById("slidePickerEmpty")!;

  private owners: Character[] = [];
  private index = 0;

  constructor(private onPick: (owner: Character) => void) {
    document.getElementById("slidePickerClose")!.onclick = () => this.close();
  }

  open(): void {
    this.owners = slideOwners();
    this.index = 0;
    this.isOpen = true;
    this.render();
    this.root.classList.remove("hidden");
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add("hidden");
  }

  private render(): void {
    const empty = this.owners.length === 0;
    this.titleEl.textContent = empty ? "" : "Чьи слайды будем показывать?";
    this.emptyEl.classList.toggle("hidden", !empty);
    this.optionsEl.classList.toggle("hidden", empty);
    this.optionsEl.innerHTML = "";
    if (empty) return;

    this.owners.forEach((owner, i) => {
      const b = document.createElement("button");
      b.className = "opt" + (i === this.index ? " sel" : "");
      b.textContent = owner.name;
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
    const owner = this.owners[i];
    if (!owner) return;
    this.close();
    this.onPick(owner);
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (this.owners.length === 0) {
      if (e.code === "Escape" || e.code === "Space" || e.code === "Enter") {
        this.close();
        return true;
      }
      return false;
    }
    switch (e.code) {
      case "ArrowLeft":
      case "ArrowUp":
        this.index = (this.index - 1 + this.owners.length) % this.owners.length;
        this.refreshSel();
        return true;
      case "ArrowRight":
      case "ArrowDown":
        this.index = (this.index + 1) % this.owners.length;
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

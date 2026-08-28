import { LOCATIONS, type ExitDef, type LocationDef } from "../data/locations";
import type { KeyConsumer } from "./KeyboardRouter";

// Меню выбора локации на парковке: ходить нельзя, вместо этого жмём кнопку нужной локации.
// Навигация стрелками вверх/вниз, выбор — Enter.
export class LocationMenu implements KeyConsumer {
  private root = document.getElementById("parking") as HTMLDivElement;
  private list = document.getElementById("parkingBtns") as HTMLDivElement;
  private exits: ExitDef[] = [];
  private index = 0;
  private visible = false;

  constructor(private onPick: (to: number) => void) {}

  show(loc: LocationDef, exits?: ExitDef[]): void {
    this.exits = exits ?? loc.exits;
    this.index = Math.min(this.index, Math.max(0, this.exits.length - 1));
    this.visible = true;
    this.list.innerHTML = "";
    this.exits.forEach((exit, i) => {
      const btn = document.createElement("button");
      btn.className = "loc-btn" + (i === this.index ? " sel" : "");
      btn.textContent = LOCATIONS[exit.to].enterLabel;
      btn.onmouseenter = () => {
        this.index = i;
        this.refreshSel();
      };
      btn.onclick = () => this.pick(i);
      this.list.appendChild(btn);
    });
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.visible = false;
    this.root.classList.add("hidden");
  }

  private refreshSel(): void {
    [...this.list.children].forEach((el, i) => el.classList.toggle("sel", i === this.index));
  }

  private pick(i: number): void {
    const exit = this.exits[i];
    if (!exit) return;
    this.onPick(exit.to);
  }

  isActive(): boolean {
    return this.visible && this.exits.length > 0;
  }

  handleKey(e: KeyboardEvent): boolean {
    const n = this.list.children.length;
    if (!n) return false;
    switch (e.code) {
      case "ArrowUp":
      case "KeyW":
        this.index = (this.index + n - 1) % n;
        this.refreshSel();
        return true;
      case "ArrowDown":
      case "KeyS":
        this.index = (this.index + 1) % n;
        this.refreshSel();
        return true;
      case "Enter":
      case "Space":
        this.pick(this.index);
        return true;
      default:
        return false;
    }
  }
}

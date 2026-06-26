import { LOCATIONS, type LocationDef } from "../data/locations";

// Меню выбора локации на парковке: ходить нельзя, вместо этого жмём кнопку нужной локации.
// Навигация стрелками вверх/вниз, выбор — Enter.
export class LocationMenu {
  private root = document.getElementById("parking") as HTMLDivElement;
  private list = document.getElementById("parkingBtns") as HTMLDivElement;
  private loc: LocationDef | null = null;
  private index = 0;
  private visible = false;

  constructor(private onPick: (to: number, spawn: { x: number; y: number }) => void) {
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  show(loc: LocationDef): void {
    this.loc = loc;
    this.index = 0;
    this.visible = true;
    this.list.innerHTML = "";
    loc.exits.forEach((exit, i) => {
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
    if (!this.loc) return;
    const exit = this.loc.exits[i];
    this.onPick(exit.to, exit.spawn);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible || !this.loc) return;
    const n = this.loc.exits.length;
    if (e.code === "ArrowUp" || e.code === "KeyW") {
      this.index = (this.index + n - 1) % n;
      this.refreshSel();
    } else if (e.code === "ArrowDown" || e.code === "KeyS") {
      this.index = (this.index + 1) % n;
      this.refreshSel();
    } else if (e.code === "Enter" || e.code === "Space") {
      this.pick(this.index);
    }
  }
}

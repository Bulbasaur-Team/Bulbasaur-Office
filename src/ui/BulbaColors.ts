// Bulba Colors — мини-игра у мольберта в главном офисе.
// Референс-цвет сверху, снизу четыре очень похожих оттенка; верный только один.
// 30 секунд на партию; ошибка или истечение таймера — конец. За каждый верный ответ — 1 очко.

const ROUND_MS = 30_000;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = clamp(s, 0, 1);
  const lit = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lit - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbCss(c: Rgb): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function rgbKey(c: Rgb): string {
  return `${c.r},${c.g},${c.b}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Референс + три близких, но различных отвлекающих оттенка.
function makeRound(): { target: Rgb; options: Rgb[] } {
  const h = Math.random() * 360;
  const s = 0.35 + Math.random() * 0.55;
  const l = 0.28 + Math.random() * 0.44;
  const target = hslToRgb(h, s, l);

  const distractors: Rgb[] = [];
  const used = new Set<string>([rgbKey(target)]);
  let guard = 0;
  while (distractors.length < 3 && guard++ < 80) {
    const kind = Math.floor(Math.random() * 3);
    let dh = h;
    let ds = s;
    let dl = l;
    if (kind === 0) dh += (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 8);
    else if (kind === 1) ds += (Math.random() < 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.1);
    else dl += (Math.random() < 0.5 ? -1 : 1) * (0.04 + Math.random() * 0.08);
    const c = hslToRgb(dh, ds, dl);
    const key = rgbKey(c);
    if (used.has(key)) continue;
    used.add(key);
    distractors.push(c);
  }
  while (distractors.length < 3) {
    const c = hslToRgb(h + distractors.length * 7 + 5, s, l + (distractors.length - 1) * 0.05);
    if (!used.has(rgbKey(c))) {
      used.add(rgbKey(c));
      distractors.push(c);
    } else break;
  }

  return { target, options: shuffle([target, ...distractors]) };
}

export class BulbaColors {
  isOpen = false;
  onGameOver: ((value: number) => void) | null = null;
  onLeaderboard: (() => void) | null = null;

  private root = document.getElementById("bulbacolors")!;
  private statusEl = document.getElementById("bcStatus")!;
  private timerEl = document.getElementById("bcTimer")!;
  private refEl = document.getElementById("bcRef") as HTMLDivElement;
  private optionsEl = document.getElementById("bcOptions")!;
  private restartBtn = document.getElementById("bcRestart")!;

  private score = 0;
  private over = false;
  private reported = false;
  private correctIndex = 0;
  private endsAt = 0;
  private tickTimer = 0;
  private optionButtons: HTMLButtonElement[] = [];

  constructor() {
    document.getElementById("bcClose")!.onclick = () => this.close();
    document.getElementById("bcLb")!.onclick = () => this.onLeaderboard?.();
    this.restartBtn.onclick = () => this.reset();
    this.optionButtons = Array.from(this.optionsEl.querySelectorAll<HTMLButtonElement>(".bc-opt"));
    this.optionButtons.forEach((btn, i) => {
      btn.onclick = () => this.pick(i);
    });
  }

  open(): void {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKeyDown);
    this.reset();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.stopTimer();
    window.removeEventListener("keydown", this.onKeyDown);
    this.root.classList.add("hidden");
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
      return;
    }
    if (this.over && (e.code === "Enter" || e.code === "Space")) {
      e.preventDefault();
      this.reset();
      return;
    }
    if (this.over) return;
    const n = e.code === "Digit1" || e.code === "Numpad1" ? 0
      : e.code === "Digit2" || e.code === "Numpad2" ? 1
      : e.code === "Digit3" || e.code === "Numpad3" ? 2
      : e.code === "Digit4" || e.code === "Numpad4" ? 3
      : -1;
    if (n >= 0) {
      e.preventDefault();
      this.pick(n);
    }
  };

  private reset(): void {
    this.score = 0;
    this.over = false;
    this.reported = false;
    this.endsAt = performance.now() + ROUND_MS;
    this.restartBtn.classList.add("hidden");
    this.setOptionsEnabled(true);
    this.nextRound();
    this.updateStatus();
    this.startTimer();
  }

  private nextRound(): void {
    const round = makeRound();
    this.refEl.style.background = rgbCss(round.target);
    this.correctIndex = round.options.findIndex((c) => rgbKey(c) === rgbKey(round.target));
    this.optionButtons.forEach((btn, i) => {
      btn.style.background = rgbCss(round.options[i]!);
      btn.classList.remove("bc-wrong", "bc-right");
      btn.disabled = false;
    });
  }

  private pick(index: number): void {
    if (!this.isOpen || this.over) return;
    if (index < 0 || index >= this.optionButtons.length) return;

    if (index === this.correctIndex) {
      this.score += 1;
      this.updateStatus();
      this.nextRound();
      return;
    }

    this.optionButtons[index]?.classList.add("bc-wrong");
    this.optionButtons[this.correctIndex]?.classList.add("bc-right");
    this.finish();
  }

  private finish(): void {
    if (this.over) return;
    this.over = true;
    this.stopTimer();
    this.setOptionsEnabled(false);
    this.restartBtn.classList.remove("hidden");
    this.updateStatus();
    this.report();
  }

  private report(): void {
    if (this.reported) return;
    this.reported = true;
    this.onGameOver?.(this.score);
  }

  private startTimer(): void {
    this.stopTimer();
    this.renderTimer();
    this.tickTimer = window.setInterval(() => {
      if (performance.now() >= this.endsAt) {
        this.timerEl.textContent = "0.0";
        this.finish();
        return;
      }
      this.renderTimer();
    }, 50);
  }

  private stopTimer(): void {
    if (this.tickTimer) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = 0;
    }
  }

  private renderTimer(): void {
    const left = Math.max(0, this.endsAt - performance.now());
    this.timerEl.textContent = (left / 1000).toFixed(1);
    this.timerEl.classList.toggle("bc-urgent", left <= 5000 && !this.over);
  }

  private updateStatus(): void {
    if (this.over) {
      this.statusEl.textContent = `Игра окончена · очки: ${this.score}`;
    } else {
      this.statusEl.textContent = `Очки: ${this.score} · выбери такой же оттенок`;
    }
  }

  private setOptionsEnabled(on: boolean): void {
    for (const btn of this.optionButtons) btn.disabled = !on;
  }
}

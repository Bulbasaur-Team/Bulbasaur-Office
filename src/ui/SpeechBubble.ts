import Phaser from "phaser";
import { meowify } from "../data/bulbaCat";

const PAD = 10;        // отступ текста от краёв облачка
const WRAP_W = 220;    // максимальная ширина текста до переноса
const TAIL_H = 12;     // высота хвостика, указывающего на NPC
const CHAR_DELAY = 25; // мс на букву при печати
const GAME_W = 1408;
const GAME_H = 768;

export class SpeechBubble {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private translateBtn: HTMLButtonElement;
  private timer?: Phaser.Time.TimerEvent;
  private hideTimer?: Phaser.Time.TimerEvent;
  private w = 0;
  private h = 0;
  private follow?: () => { x: number; y: number };
  private russianText = "";
  private translated = false;
  private catMode = false;

  constructor(private scene: Phaser.Scene, depth: number) {
    this.bg = scene.add.graphics();
    this.label = scene.add.text(PAD, PAD, "", {
      fontFamily: "Trebuchet MS",
      fontSize: "14px",
      color: "#1b1f24",
      wordWrap: { width: WRAP_W },
    });
    this.container = scene.add
      .container(0, 0, [this.bg, this.label])
      .setDepth(depth)
      .setVisible(false);

    this.translateBtn = document.createElement("button");
    this.translateBtn.type = "button";
    this.translateBtn.id = "catTranslate";
    this.translateBtn.className = "cat-translate hidden";
    this.translateBtn.textContent = "Перевести";
    this.translateBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onTranslateClick();
    });
    document.getElementById("stage")?.appendChild(this.translateBtn)
      ?? document.body.appendChild(this.translateBtn);
  }

  show(fullText: string, x: number, y: number, autoHideMs?: number, follow?: () => { x: number; y: number }, fontSize = 14): void {
    this.catMode = false;
    this.russianText = "";
    this.translated = false;
    this.hideTranslateBtn();
    this.startType(fullText, x, y, autoHideMs, follow, fontSize);
  }

  /** Реплика кота: печатает мяуканье; «Перевести» сразу над облачком, один раз. */
  showCat(russian: string, x: number, y: number, follow?: () => { x: number; y: number }): void {
    this.catMode = true;
    this.russianText = russian;
    this.translated = false;
    this.translateBtn.textContent = "Перевести";
    this.translateBtn.disabled = false;
    this.startType(meowify(russian), x, y, undefined, follow, 14);
    // Кнопка доступна сразу, пока кот ещё «говорит».
    this.translateBtn.classList.remove("hidden");
    this.positionTranslateBtn();
  }

  update(): void {
    if (this.follow && this.container.visible) {
      const p = this.follow();
      this.place(p.x, p.y);
    }
    if (this.catMode && this.container.visible && !this.translateBtn.classList.contains("hidden")) {
      this.positionTranslateBtn();
    }
  }

  hide(): void {
    this.timer?.remove();
    this.hideTimer?.remove();
    this.follow = undefined;
    this.catMode = false;
    this.russianText = "";
    this.translated = false;
    this.hideTranslateBtn();
    this.container.setVisible(false);
  }

  destroy(): void {
    this.timer?.remove();
    this.hideTimer?.remove();
    this.translateBtn.remove();
    this.container.destroy();
  }

  private startType(
    fullText: string,
    x: number,
    y: number,
    autoHideMs: number | undefined,
    follow: (() => { x: number; y: number }) | undefined,
    fontSize: number,
  ): void {
    this.timer?.remove();
    this.hideTimer?.remove();
    this.follow = follow;
    this.label.setFontSize(fontSize);

    this.label.setText(fullText);
    this.w = this.label.width + PAD * 2;
    this.h = this.label.height + PAD * 2;
    this.drawBubble(this.w, this.h);
    this.place(x, y);
    this.container.setVisible(true);

    this.label.setText("");
    let shown = 0;
    this.timer = this.scene.time.addEvent({
      delay: CHAR_DELAY,
      loop: true,
      callback: () => {
        // Уже перевели — не перетираем русский текст мяуканьем.
        if (this.translated) {
          this.timer?.remove();
          return;
        }
        shown++;
        this.label.setText(fullText.slice(0, shown));
        if (shown >= fullText.length) {
          this.timer?.remove();
          if (autoHideMs != null) this.hideTimer = this.scene.time.delayedCall(autoHideMs, () => this.hide());
        }
      },
    });
  }

  /** Можно ли сейчас нажать «Перевести» (кнопка видна). */
  canTranslate(): boolean {
    return this.catMode && !!this.russianText && !this.translated
      && !this.translateBtn.classList.contains("hidden");
  }

  /** Перевести мяуканье на русский. true, если перевод сработал. */
  tryTranslate(): boolean {
    if (!this.canTranslate()) return false;
    this.translated = true;
    this.timer?.remove();
    this.label.setText(this.russianText);
    this.w = this.label.width + PAD * 2;
    this.h = this.label.height + PAD * 2;
    this.drawBubble(this.w, this.h);
    this.hideTranslateBtn();
    if (this.follow) {
      const p = this.follow();
      this.place(p.x, p.y);
    }
    return true;
  }

  private onTranslateClick(): void {
    this.tryTranslate();
  }

  private positionTranslateBtn(): void {
    const canvas = this.scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / GAME_W;
    const scaleY = rect.height / GAME_H;
    // Центр верхнего края облачка (container — левый верх облачка).
    const cx = this.container.x + this.w / 2;
    const cy = this.container.y;
    const left = rect.left + cx * scaleX;
    const top = rect.top + cy * scaleY;
    this.translateBtn.style.left = `${left}px`;
    this.translateBtn.style.top = `${top}px`;
  }

  private hideTranslateBtn(): void {
    this.translateBtn.classList.add("hidden");
  }

  private place(x: number, y: number): void {
    this.container.setPosition(Math.round(x - this.w / 2), Math.round(y - this.h - TAIL_H));
  }

  private drawBubble(w: number, h: number): void {
    const cx = w / 2;
    this.bg.clear();
    this.bg.fillStyle(0xf4f1e8, 1);
    this.bg.fillRoundedRect(0, 0, w, h, 8);
    this.bg.fillTriangle(cx - 8, h - 1, cx + 8, h - 1, cx, h + TAIL_H);
    this.bg.lineStyle(2, 0x7ac07a, 1);
    this.bg.strokeRoundedRect(0, 0, w, h, 8);
  }
}

import Phaser from "phaser";

const PAD = 10;        // отступ текста от краёв облачка
const WRAP_W = 220;    // максимальная ширина текста до переноса
const TAIL_H = 12;     // высота хвостика, указывающего на NPC
const CHAR_DELAY = 25; // мс на букву при печати

export class SpeechBubble {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private timer?: Phaser.Time.TimerEvent;
  private hideTimer?: Phaser.Time.TimerEvent;
  private w = 0;
  private h = 0;
  private follow?: () => { x: number; y: number }; // если задан — облачко следует за якорем

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
  }

  // Показывает облачко так, чтобы кончик хвостика был в точке (x, y) — над головой.
  // autoHideMs (если задан) — скрыть облачко через столько мс после конца печати (для чата).
  // follow (если задан) — источник живой позиции якоря: облачко едет за ним (см. update).
  show(fullText: string, x: number, y: number, autoHideMs?: number, follow?: () => { x: number; y: number }): void {
    this.timer?.remove();
    this.hideTimer?.remove();
    this.follow = follow;

    // Размер считаем по полному тексту, чтобы облачко не «прыгало» во время печати.
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
        shown++;
        this.label.setText(fullText.slice(0, shown));
        if (shown >= fullText.length) {
          this.timer?.remove();
          if (autoHideMs != null) this.hideTimer = this.scene.time.delayedCall(autoHideMs, () => this.hide());
        }
      },
    });
  }

  // Если задан follow — подтянуть облачко к текущей позиции якоря. Зовётся каждый кадр.
  update(): void {
    if (this.follow && this.container.visible) {
      const p = this.follow();
      this.place(p.x, p.y);
    }
  }

  private place(x: number, y: number): void {
    this.container.setPosition(Math.round(x - this.w / 2), Math.round(y - this.h - TAIL_H));
  }

  hide(): void {
    this.timer?.remove();
    this.hideTimer?.remove();
    this.follow = undefined;
    this.container.setVisible(false);
  }

  destroy(): void {
    this.timer?.remove();
    this.hideTimer?.remove();
    this.container.destroy(); // уничтожает и дочерние bg/label
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

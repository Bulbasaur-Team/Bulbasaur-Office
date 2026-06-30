import Phaser from "phaser";

const PAD = 10;              // отступ текста от краёв облачка
const WRAP_W = 200;         // максимальная ширина текста до переноса
const CHAR_DELAY = 25;      // мс на букву — печатаем так же, как обычную реплику
const HOLD_AFTER_TYPING = 4000; // мс: облачко висит после окончания печати и пропадает
const RX_FACTOR = 1.3;      // во сколько горизонтальная полуось эллипса больше полуширины текста
const RY_FACTOR = 1.7;      // то же по вертикали — чтобы эллипс вмещал прямоугольник текста
const TAIL_REACH = 24;      // на сколько хвостик-кружки опускаются ниже эллипса к голове NPC

// Облачко с мыслями NPC. Механика как у обычной реплики (побуквенная печать),
// но оформлено облаком с кружками-хвостиком и само пропадает через 2 секунды.
export class ThoughtBubble {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private typeTimer?: Phaser.Time.TimerEvent;
  private hideTimer?: Phaser.Time.TimerEvent;
  private active = false;

  constructor(private scene: Phaser.Scene, depth: number) {
    this.bg = scene.add.graphics();
    this.label = scene.add.text(PAD, PAD, "", {
      fontFamily: "Trebuchet MS",
      fontSize: "14px",
      fontStyle: "italic",
      color: "#1b1f24",
      wordWrap: { width: WRAP_W },
    });
    this.container = scene.add
      .container(0, 0, [this.bg, this.label])
      .setDepth(depth)
      .setVisible(false);
  }

  get isActive(): boolean {
    return this.active;
  }

  // Показывает облачко так, чтобы хвостик указывал на точку (x, y) — над головой NPC.
  show(fullText: string, x: number, y: number): void {
    this.typeTimer?.remove();
    this.hideTimer?.remove();
    this.active = true;

    // Размер считаем по полному тексту, чтобы облачко не «прыгало» во время печати.
    // Эллипс должен вмещать прямоугольник текста, поэтому полуоси берём с запасом.
    this.label.setText(fullText);
    const rx = (this.label.width / 2 + PAD) * RX_FACTOR;
    const ry = (this.label.height / 2 + PAD) * RY_FACTOR;

    // Всё рисуем относительно центра эллипса (0, 0); текст центрируем в нём.
    this.drawCloud(rx, ry);
    this.label.setPosition(-this.label.width / 2, -this.label.height / 2);
    this.container.setPosition(Math.round(x), Math.round(y - ry - TAIL_REACH));
    this.container.setVisible(true);

    this.label.setText("");
    let shown = 0;
    this.typeTimer = this.scene.time.addEvent({
      delay: CHAR_DELAY,
      loop: true,
      callback: () => {
        shown++;
        this.label.setText(fullText.slice(0, shown));
        if (shown >= fullText.length) {
          this.typeTimer?.remove();
          this.hideTimer = this.scene.time.delayedCall(HOLD_AFTER_TYPING, () => this.hide());
        }
      },
    });
  }

  hide(): void {
    this.typeTimer?.remove();
    this.hideTimer?.remove();
    this.container.setVisible(false);
    this.active = false;
  }

  destroy(): void {
    this.typeTimer?.remove();
    this.hideTimer?.remove();
    this.container.destroy();
  }

  // Рисуем облако в два прохода: сначала силуэт в цвете обводки, затем тот же
  // силуэт чуть меньше белым — так union из эллипса и «комков» получает ровный
  // контур без внутренних швов. Всё центрировано в (0, 0).
  private drawCloud(rx: number, ry: number): void {
    this.bg.clear();
    const puffs = this.cloudPuffs(rx, ry);
    this.paintSilhouette(rx, ry, puffs, 2, 0x9fb8d0);
    this.paintSilhouette(rx, ry, puffs, 0, 0xffffff);
  }

  // Комки облака, равномерно разложенные по периметру эллипса; радиус чередуется,
  // чтобы силуэт был неровным, «кучевым».
  private cloudPuffs(rx: number, ry: number): { x: number; y: number; r: number }[] {
    const puffs: { x: number; y: number; r: number }[] = [];
    const count = Math.max(5, Math.round((rx + ry) / 22));
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count;
      puffs.push({
        x: Math.cos(a) * rx,
        y: Math.sin(a) * ry,
        r: i % 2 ? 22 : 17,
      });
    }
    return puffs;
  }

  private paintSilhouette(
    rx: number,
    ry: number,
    puffs: { x: number; y: number; r: number }[],
    inflate: number,
    color: number,
  ): void {
    const g = this.bg;
    g.fillStyle(color, 1);
    g.fillEllipse(0, 0, (rx + inflate) * 2, (ry + inflate) * 2);
    for (const p of puffs) g.fillCircle(p.x, p.y, p.r + inflate);
    // хвостик — пара уменьшающихся кружков-облачков к голове NPC
    g.fillCircle(6, ry + 8, 6 + inflate);
    g.fillCircle(-4, ry + 20, 4 + inflate);
  }
}

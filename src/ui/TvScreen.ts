import Phaser from "phaser";
import type { Rect } from "../scenes/LocationLoader";

const TEX_KEY = "tvGameMini";

// Мини-версия игры на экране TV — как мини-слайд у проектора. Каждый кадр
// копирует canvas запущенной игры на текстуру экрана. Прямоугольник экрана
// задаётся в Tiled (объект "tvScreen" слоя interactions) и приходит в show().
export class TvScreen {
  private rect: Rect | null = null;
  private image?: Phaser.GameObjects.Image;
  private btnBg?: Phaser.GameObjects.Rectangle;
  private btnIcon?: Phaser.GameObjects.Graphics;
  private tex?: Phaser.Textures.CanvasTexture;
  private surface?: HTMLCanvasElement;
  private sctx?: CanvasRenderingContext2D;
  private source: HTMLCanvasElement | null = null;

  constructor(
    private scene: Phaser.Scene,
    private onExpand: () => void,
  ) {}

  show(rect: Rect, source: HTMLCanvasElement): void {
    this.ensureBuilt(rect);
    this.source = source;
    this.setVisible(true);
  }

  hide(): void {
    this.setVisible(false);
    this.source = null;
  }

  // Перерисовка текстуры из canvas игры (вписываем с сохранением пропорций).
  update(): void {
    if (!this.source || !this.rect || !this.image?.visible) return;
    const { w, h } = this.rect;
    const ctx = this.sctx!;
    ctx.fillStyle = "#05070b";
    ctx.fillRect(0, 0, w, h);
    const s = this.source;
    if (s.width > 0 && s.height > 0) {
      const fit = Math.min(w / s.width, h / s.height);
      const dw = s.width * fit;
      const dh = s.height * fit;
      ctx.drawImage(s, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    this.tex!.refresh();
  }

  // Пересобирает объекты экрана под прямоугольник; если он тот же — ничего не делает.
  private ensureBuilt(rect: Rect): void {
    if (this.rect && this.rect.x === rect.x && this.rect.y === rect.y && this.rect.w === rect.w && this.rect.h === rect.h) {
      return;
    }
    this.destroyObjects();
    this.rect = rect;

    this.surface = document.createElement("canvas");
    this.surface.width = rect.w;
    this.surface.height = rect.h;
    this.sctx = this.surface.getContext("2d")!;
    if (this.scene.textures.exists(TEX_KEY)) this.scene.textures.remove(TEX_KEY);
    this.tex = this.scene.textures.addCanvas(TEX_KEY, this.surface)!;

    this.image = this.scene.add
      .image(rect.x + rect.w / 2, rect.y + rect.h / 2, TEX_KEY)
      .setDepth(rect.y)
      .setInteractive({ useHandCursor: true });
    this.image.on("pointerdown", () => this.onExpand());

    [this.btnBg, this.btnIcon] = this.buildButton(rect);
  }

  private destroyObjects(): void {
    this.image?.destroy();
    this.btnBg?.destroy();
    this.btnIcon?.destroy();
    this.image = this.btnBg = this.btnIcon = undefined;
  }

  private setVisible(v: boolean): void {
    this.image?.setVisible(v);
    this.btnBg?.setVisible(v);
    this.btnIcon?.setVisible(v);
  }

  // Кнопка «развернуть» в углу экрана: иконка-уголки.
  private buildButton(rect: Rect): [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Graphics] {
    const size = 16;
    const bx = rect.x + rect.w - size / 2 - 3;
    const by = rect.y + size / 2 + 3;

    const bg = this.scene.add
      .rectangle(bx, by, size, size, 0x11141a, 0.7)
      .setStrokeStyle(1, 0x7ac07a)
      .setDepth(rect.y + 1)
      .setInteractive({ useHandCursor: true });
    bg.on("pointerdown", () => this.onExpand());

    const a = size / 2 - 3;
    const icon = this.scene.add.graphics({ x: bx, y: by }).setDepth(rect.y + 2);
    icon.lineStyle(1.5, 0x7ac07a, 1);
    icon.beginPath();
    icon.moveTo(-a + 3, -a); icon.lineTo(-a, -a); icon.lineTo(-a, -a + 3);
    icon.moveTo(a - 3, -a); icon.lineTo(a, -a); icon.lineTo(a, -a + 3);
    icon.moveTo(-a + 3, a); icon.lineTo(-a, a); icon.lineTo(-a, a - 3);
    icon.moveTo(a - 3, a); icon.lineTo(a, a); icon.lineTo(a, a - 3);
    icon.strokePath();

    return [bg, icon];
  }
}

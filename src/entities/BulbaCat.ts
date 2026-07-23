import Phaser from "phaser";
import { BULBA_CAT } from "../data/bulbaCat";

const LERP = 0.18;

/**
 * Бульба Кот в мире: рисует спрайт и бейдж, сглаживает позу с сервера.
 * Маршрут и «когда ходить» живут на сервере — клиент только отображает.
 * При движении чередует два кадра (стоя / шаг).
 */
export class BulbaCat {
  private sprite: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private targetX: number;
  private targetY: number;
  private readonly targetH = BULBA_CAT.targetH;
  private moving = false;
  private walkFrame = 0;
  private walkAcc = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, facing = false) {
    this.targetX = x;
    this.targetY = y;
    const idle = BULBA_CAT.textures[0];
    const texH = scene.textures.get(idle).getSourceImage().height;
    this.sprite = scene.add
      .image(x, y, idle)
      .setScale(this.targetH / texH)
      .setOrigin(0.5, 0.5)
      .setFlipX(facing)
      .setDepth(y);
    this.label = scene.add
      .text(x, y - this.targetH * 0.72, BULBA_CAT.name, {
        fontFamily: "Trebuchet MS",
        fontSize: "11px",
        color: "#ffffff",
        backgroundColor: "#00000099",
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5)
      .setDepth(y);
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  setTarget(x: number, y: number, facing: boolean, moving: boolean): void {
    this.targetX = x;
    this.targetY = y;
    this.sprite.setFlipX(facing);
    this.setMoving(moving);
  }

  /** Остановить анимацию шага на месте (диалог), не трогая позу. */
  stopWalk(): void {
    this.targetX = this.sprite.x;
    this.targetY = this.sprite.y;
    this.setMoving(false);
  }

  /** Мгновенно поставить (первый снапшот при входе в комнату). */
  snapTo(x: number, y: number, facing: boolean, moving = false): void {
    this.targetX = x;
    this.targetY = y;
    this.sprite.setPosition(x, y).setFlipX(facing).setDepth(y);
    this.label.setPosition(x, y - this.targetH * 0.72).setDepth(y);
    this.setMoving(moving);
  }

  update(delta: number): void {
    const x = Phaser.Math.Linear(this.sprite.x, this.targetX, LERP);
    const y = Phaser.Math.Linear(this.sprite.y, this.targetY, LERP);
    this.sprite.setPosition(x, y).setDepth(y);
    this.label.setPosition(x, y - this.targetH * 0.72).setDepth(y);

    if (!this.moving) return;
    this.walkAcc += delta;
    if (this.walkAcc < BULBA_CAT.walkFrameMs) return;
    this.walkAcc = 0;
    this.walkFrame = 1 - this.walkFrame;
    this.sprite.setTexture(BULBA_CAT.textures[this.walkFrame]);
  }

  /** Якорь для речевого облачка (над головой). */
  bubbleAnchor(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y - this.targetH * 0.55 };
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
  }

  private setMoving(moving: boolean): void {
    if (this.moving === moving) return;
    this.moving = moving;
    this.walkAcc = 0;
    this.walkFrame = 0;
    this.sprite.setTexture(BULBA_CAT.textures[0]);
  }
}

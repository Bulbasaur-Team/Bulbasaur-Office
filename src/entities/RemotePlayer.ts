import Phaser from "phaser";
import { spriteScale, type SpriteKey } from "./sprites";
import { SpeechBubble } from "../ui/SpeechBubble";

const LERP = 0.2; // доля пути к целевой позиции за кадр — сглаживает рывки между move
const CHAT_HOLD_MS = 4000; // сколько держать облачко чата после печати
const EMOTE_HOLD_MS = 2500; // сколько держать реакцию
const EMOTE_FONT = 30;      // размер эмодзи-реакции

// Чужой игрок в мире: скин по роли, бейдж с логином и своё облачко для чата.
// Позиция приходит редкими move; между ними положение интерполируется в update().
export class RemotePlayer {
  private sprite: Phaser.GameObjects.Sprite;
  private label: Phaser.GameObjects.Text;
  private bubble: SpeechBubble;
  private targetX: number;
  private targetY: number;

  constructor(
    scene: Phaser.Scene,
    sprite: SpriteKey,
    login: string,
    x: number,
    y: number,
    facing: boolean,
    private targetH: number,
    bubbleDepth: number,
  ) {
    this.targetX = x;
    this.targetY = y;
    this.sprite = scene.add
      .sprite(x, y, sprite)
      .setScale(spriteScale(scene, sprite, targetH))
      .setOrigin(0.5, 0.5)
      .setFlipX(facing)
      .setDepth(y);
    this.label = scene.add
      .text(x, y - targetH * 0.7, login, {
        fontFamily: "Trebuchet MS",
        fontSize: "13px",
        color: "#ffffff",
        backgroundColor: "#00000099",
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(y);
    this.bubble = new SpeechBubble(scene, bubbleDepth);
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  // Новая цель движения (из move). Разворот применяем сразу.
  setTarget(x: number, y: number, facing: boolean): void {
    this.targetX = x;
    this.targetY = y;
    this.sprite.setFlipX(facing);
  }

  showMessage(text: string): void {
    // Якорь выше бейджа с логином (0.7), чтобы облачко его не перекрывало.
    this.bubble.show(text, this.sprite.x, this.sprite.y - this.targetH * 0.95, CHAT_HOLD_MS, () => ({
      x: this.sprite.x,
      y: this.sprite.y - this.targetH * 0.95,
    }));
  }

  showEmote(emoji: string): void {
    this.bubble.show(emoji, this.sprite.x, this.sprite.y - this.targetH * 0.95, EMOTE_HOLD_MS, () => ({
      x: this.sprite.x,
      y: this.sprite.y - this.targetH * 0.95,
    }), EMOTE_FONT);
  }

  update(): void {
    this.sprite.x += (this.targetX - this.sprite.x) * LERP;
    this.sprite.y += (this.targetY - this.sprite.y) * LERP;
    this.sprite.setDepth(this.sprite.y);
    this.label.setPosition(this.sprite.x, this.sprite.y - this.targetH * 0.7).setDepth(this.sprite.y);
    this.bubble.update();
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
    this.bubble.destroy();
  }
}

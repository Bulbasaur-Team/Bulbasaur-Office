import Phaser from "phaser";
import { spriteScale, type SpriteKey } from "./sprites";
import { SpeechBubble } from "../ui/SpeechBubble";
import { ITEM_TYPES } from "../data/items";
import { ITEM_TOP_DEPTH } from "./PhysicsItem";

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
  private held: Phaser.GameObjects.Image | null = null; // предмет в лапах, рисуется по центру спрайта

  constructor(
    private scene: Phaser.Scene,
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

  /** Облачко приглашения в аэрохоккей — висит, пока не спрячем. */
  showInvite(text: string): void {
    this.bubble.show(text, this.sprite.x, this.sprite.y - this.targetH * 0.95, undefined, () => ({
      x: this.sprite.x,
      y: this.sprite.y - this.targetH * 0.95,
    }));
  }

  hideBubble(): void {
    this.bubble.hide();
  }

  // Предмет в лапах: type — ключ ITEM_TYPES, null — руки пусты.
  setHeldItem(type: string | null): void {
    this.held?.destroy();
    this.held = null;
    const def = type ? ITEM_TYPES[type] : undefined;
    if (!def) return;
    const texW = this.scene.textures.get(def.texture).getSourceImage().width;
    this.held = this.scene.add
      .image(this.sprite.x, this.sprite.y, def.texture)
      .setScale((def.radius * 2) / texW)
      // Глубина — как у своего игрока: чашка поверх всего мира, мяч просто поверх персонажей.
      .setDepth(def.alwaysOnTop ? ITEM_TOP_DEPTH : 1_000_000);
  }

  update(): void {
    this.sprite.x += (this.targetX - this.sprite.x) * LERP;
    this.sprite.y += (this.targetY - this.sprite.y) * LERP;
    this.sprite.setDepth(this.sprite.y);
    this.label.setPosition(this.sprite.x, this.sprite.y - this.targetH * 0.7).setDepth(this.sprite.y);
    this.held?.setPosition(this.sprite.x, this.sprite.y);
    this.bubble.update();
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
    this.held?.destroy();
    this.bubble.destroy();
  }
}

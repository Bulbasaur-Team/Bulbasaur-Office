import Phaser from "phaser";
import { SpeechBubble } from "../ui/SpeechBubble";
import { ITEM_TYPES } from "../data/items";
import { CARRY_DEPTH, ITEM_TOP_DEPTH } from "./PhysicsItem";
import { PlayerAvatar } from "./PlayerAvatar";
import type { PlayerAppearance } from "../data/wardrobe";

const LERP = 0.2; // доля пути к целевой позиции за кадр — сглаживает рывки между move
const CHAT_HOLD_MS = 4000; // сколько держать облачко чата после печати
const EMOTE_HOLD_MS = 2500; // сколько держать реакцию
const EMOTE_FONT = 30;      // размер эмодзи-реакции

// Чужой игрок в мире: layered-аватар, бейдж с логином и облачко для чата.
export class RemotePlayer {
  private avatar: PlayerAvatar;
  private label: Phaser.GameObjects.Text;
  private bubble: SpeechBubble;
  private targetX: number;
  private targetY: number;
  private held: Phaser.GameObjects.Image | null = null;

  constructor(
    private scene: Phaser.Scene,
    appearance: PlayerAppearance,
    login: string,
    x: number,
    y: number,
    facing: boolean,
    private targetH: number,
  ) {
    this.targetX = x;
    this.targetY = y;
    this.avatar = new PlayerAvatar(scene, x, y, appearance, targetH);
    this.avatar.setFlipX(facing);
    this.avatar.setDepth(y);
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
    this.bubble = new SpeechBubble(scene);
  }

  get x(): number {
    return this.avatar.x;
  }

  get y(): number {
    return this.avatar.y;
  }

  setTarget(x: number, y: number, facing: boolean): void {
    this.targetX = x;
    this.targetY = y;
    this.avatar.setFlipX(facing);
  }

  setAppearance(appearance: PlayerAppearance): void {
    this.avatar.setAppearance(appearance);
  }

  showMessage(text: string): void {
    this.bubble.show(text, this.avatar.x, this.avatar.y - this.targetH * 0.95, CHAT_HOLD_MS, () => ({
      x: this.avatar.x,
      y: this.avatar.y - this.targetH * 0.95,
    }));
  }

  showEmote(emoji: string): void {
    this.bubble.show(emoji, this.avatar.x, this.avatar.y - this.targetH * 0.95, EMOTE_HOLD_MS, () => ({
      x: this.avatar.x,
      y: this.avatar.y - this.targetH * 0.95,
    }), EMOTE_FONT);
  }

  showInvite(text: string): void {
    this.bubble.show(text, this.avatar.x, this.avatar.y - this.targetH * 0.95, undefined, () => ({
      x: this.avatar.x,
      y: this.avatar.y - this.targetH * 0.95,
    }));
  }

  hideBubble(): void {
    this.bubble.hide();
  }

  setHeldItem(type: string | null): void {
    this.held?.destroy();
    this.held = null;
    const def = type ? ITEM_TYPES[type] : undefined;
    if (!def) return;
    const texW = this.scene.textures.get(def.texture).getSourceImage().width;
    this.held = this.scene.add
      .image(this.avatar.x, this.avatar.y, def.texture)
      .setScale((def.radius * 2) / texW)
      .setDepth(def.alwaysOnTop ? ITEM_TOP_DEPTH : CARRY_DEPTH);
  }

  update(): void {
    const x = this.avatar.x + (this.targetX - this.avatar.x) * LERP;
    const y = this.avatar.y + (this.targetY - this.avatar.y) * LERP;
    this.avatar.setPosition(x, y);
    this.avatar.setDepth(y);
    this.label.setPosition(x, y - this.targetH * 0.7).setDepth(y);
    this.held?.setPosition(x, y);
    this.bubble.update();
  }

  destroy(): void {
    this.avatar.destroy();
    this.label.destroy();
    this.held?.destroy();
    this.bubble.destroy();
  }
}

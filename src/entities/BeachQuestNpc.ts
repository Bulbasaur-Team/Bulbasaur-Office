import Phaser from "phaser";
import { PACKAGE_QUEST } from "../data/packageQuest";
import { ITEM_TYPES } from "../data/items";
import { spriteScale } from "./sprites";
import { ITEM_TOP_DEPTH } from "./PhysicsItem";

/**
 * Квестовый NPC на Вьетнамском пляже (только MP, lost_package).
 * После выдачи посылки уходит вправо за край экрана.
 */
export class BeachQuestNpc {
  /** Смещение коробки вниз от центра спрайта — в лапы, не на лицо. */
  private static readonly HELD_OFFSET_Y = 28;

  private sprite: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private held: Phaser.GameObjects.Image | null = null;
  private leaving = false;
  private gone = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const { sprite: key, name, targetH } = PACKAGE_QUEST.beachNpc;
    const scale = spriteScale(scene, key, targetH);
    this.sprite = scene.add
      .image(x, y, key)
      .setScale(scale)
      .setOrigin(0.5, 0.5)
      .setFlipX(false)
      .setDepth(y);
    this.label = scene.add
      .text(x, y - targetH * 0.72, name, {
        fontFamily: "Trebuchet MS",
        fontSize: "11px",
        color: "#ffffff",
        backgroundColor: "#00000099",
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5)
      .setDepth(y);

    const def = ITEM_TYPES[PACKAGE_QUEST.itemType];
    if (def && scene.textures.exists(def.texture)) {
      const texW = scene.textures.get(def.texture).getSourceImage().width;
      this.held = scene.add
        .image(x, y + BeachQuestNpc.HELD_OFFSET_Y, def.texture)
        .setScale((def.radius * 2) / texW)
        .setDepth(ITEM_TOP_DEPTH);
    }
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  get isGone(): boolean {
    return this.gone;
  }

  get isLeaving(): boolean {
    return this.leaving;
  }

  bubbleAnchor(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y - PACKAGE_QUEST.beachNpc.targetH * 0.55 };
  }

  /** Отдал посылку — коробка исчезает из лап. */
  clearHeld(): void {
    this.held?.destroy();
    this.held = null;
  }

  /** Уйти вправо за край карты. */
  leave(): void {
    this.clearHeld();
    this.leaving = true;
    this.sprite.setFlipX(false);
  }

  update(_delta: number): void {
    if (!this.leaving || this.gone) return;
    const speed = 1.6;
    this.sprite.x += speed;
    this.label.x = this.sprite.x;
    this.syncHeldPosition();
    this.sprite.setDepth(this.sprite.y);
    this.label.setDepth(this.sprite.y);
    if (this.sprite.x > 1500) {
      this.destroy();
    }
  }

  destroy(): void {
    this.gone = true;
    this.leaving = false;
    this.held?.destroy();
    this.held = null;
    this.sprite.destroy();
    this.label.destroy();
  }

  private syncHeldPosition(): void {
    this.held?.setPosition(this.sprite.x, this.sprite.y + BeachQuestNpc.HELD_OFFSET_Y);
  }
}

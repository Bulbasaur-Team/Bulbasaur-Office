import Phaser from "phaser";
import { CHARACTERS, type Character } from "../data/characters";
import { registerSpriteImages } from "../entities/sprites";
import { Dialogue } from "../ui/Dialogue";
import { SpeechBubble } from "../ui/SpeechBubble";
import { SlideViewer } from "../ui/SlideViewer";
import { Projector } from "../ui/Projector";
import { showCharacterSelect } from "../ui/CharacterSelect";

const SPEED = 250;
const INTERACT_DIST = 80;
const TARGET_H = 74;   // экранная высота персонажа в пикселях

const DEPTH = {
  prompt: 1_000_000,
  player: 1_000_001,
  doorOverlay: 2_000_000,
  bubble: 3_000_000,
} as const;

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private npcs: Character[] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private dialogue!: Dialogue;
  private bubble!: SpeechBubble;
  private slides!: SlideViewer;
  private projector!: Projector;
  private prompt!: Phaser.GameObjects.Text;
  private nearest: Character | null = null;
  private talking: Character | null = null;
  private started = false;

  constructor() {
    super("World");
  }

  create(): void {
    this.add.image(0, 0, "location").setOrigin(0);
    this.buildDoorOverlay();
    this.buildWalls();
    registerSpriteImages(this);

    this.bubble = new SpeechBubble(this, DEPTH.bubble);
    this.projector = new Projector(this, (slides, index) => {
      this.dialogue.paused = true;
      this.slides.open(slides, index);
    });
    this.slides = new SlideViewer((index) => {
      this.dialogue.paused = false;
      this.projector.setIndex(index);
    });
    this.dialogue = new Dialogue({
      onSay: (text) => {
        if (this.talking) this.bubble.show(text, this.talking.x, this.talking.y - TARGET_H / 2);
      },
      onShowSlides: (npc) => this.projector.show(npc),
      onClose: () => {
        this.bubble.hide();
        this.projector.hide();
      },
    });

    this.prompt = this.add
      .text(0, 0, "Пробел — поговорить", {
        fontFamily: "Trebuchet MS",
        fontSize: "14px",
        color: "#7ac07a",
        backgroundColor: "#000000c0",
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.prompt)
      .setVisible(false);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE") as Record<string, Phaser.Input.Keyboard.Key>;

    showCharacterSelect(CHARACTERS, (chosen) => this.startAs(chosen));
  }

  private buildDoorOverlay(): void {
    this.add.image(0, 0, "location-overlay").setOrigin(0).setDepth(DEPTH.doorOverlay);
  }

  private buildWalls(): void {
    const map = this.make.tilemap({ key: "map" });
    this.walls = this.physics.add.staticGroup();
    const layer = map.getObjectLayer("collision");
    layer?.objects.forEach((o) => {
      const w = o.width ?? 0;
      const h = o.height ?? 0;
      const rect = this.add.rectangle((o.x ?? 0) + w / 2, (o.y ?? 0) + h / 2, w, h);
      this.physics.add.existing(rect, true);
      this.walls.add(rect);
    });
  }

  private spriteScale(sprite: string): number {
    const frame = this.textures.get(sprite).getSourceImage();
    return TARGET_H / frame.height;
  }

  private startAs(chosen: Character): void {
    this.npcs = CHARACTERS.filter((c) => c.id !== chosen.id);
    for (const c of this.npcs) {
      this.add
        .image(c.x, c.y, c.sprite)
        .setScale(this.spriteScale(c.sprite))
        .setOrigin(0.5, 0.5)
        .setFlipX(!!c.faceRight)
        .setDepth(c.y);
      this.add
        .text(c.x, c.y - TARGET_H * 0.62, c.name, {
          fontFamily: "Trebuchet MS",
          fontSize: "13px",
          color: "#ffffff",
          backgroundColor: "#00000099",
          padding: { x: 5, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(c.y);
    }

    this.player = this.physics.add.sprite(chosen.x, chosen.y, chosen.sprite);
    this.player.setScale(this.spriteScale(chosen.sprite)).setDepth(DEPTH.player);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);

    this.started = true;
  }

  update(): void {
    if (!this.started) return;

    if (this.dialogue.isOpen) {
      this.player.setVelocity(0);
      this.prompt.setVisible(false);
      return;
    }

    this.player.setVelocity(0);
    if (this.cursors.left.isDown || this.keys.A.isDown) {
      this.player.setVelocityX(-SPEED);
      this.player.setFlipX(false);
    } else if (this.cursors.right.isDown || this.keys.D.isDown) {
      this.player.setVelocityX(SPEED);
      this.player.setFlipX(true);
    }
    if (this.cursors.up.isDown || this.keys.W.isDown) this.player.setVelocityY(-SPEED);
    else if (this.cursors.down.isDown || this.keys.S.isDown) this.player.setVelocityY(SPEED);
    this.player.body.velocity.normalize().scale(SPEED);

    this.nearest = null;
    let best = INTERACT_DIST;
    for (const c of this.npcs) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, c.x, c.y);
      if (d < best) {
        best = d;
        this.nearest = c;
      }
    }

    if (this.nearest) {
      this.prompt.setPosition(this.nearest.x, this.nearest.y - TARGET_H * 0.85).setVisible(true);
      if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
        this.talking = this.nearest;
        this.dialogue.open(this.nearest);
      }
    } else {
      this.prompt.setVisible(false);
    }
  }
}

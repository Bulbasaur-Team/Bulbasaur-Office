import Phaser from "phaser";
import { CHARACTERS, type Character } from "../data/characters";
import { LOCATIONS, type ExitDef } from "../data/locations";
import { registerSpriteImages } from "../entities/sprites";
import { Dialogue } from "../ui/Dialogue";
import { SpeechBubble } from "../ui/SpeechBubble";
import { SlideViewer } from "../ui/SlideViewer";
import { Projector } from "../ui/Projector";
import { LocationMenu } from "../ui/LocationMenu";
import { showCharacterSelect } from "../ui/CharacterSelect";

const SPEED = 400;
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

  private chosen!: Character;
  private locIndex = 0;
  private atParking = false;
  private scenery: Phaser.GameObjects.GameObject[] = []; // фон, overlay, NPC текущей локации
  private menu!: LocationMenu;
  private exitBtn = document.getElementById("exitBtn") as HTMLButtonElement;
  private exitLabel = document.getElementById("exitLabel") as HTMLSpanElement;
  private currentExit: ExitDef | null = null;

  constructor() {
    super("World");
  }

  create(): void {
    registerSpriteImages(this);
    this.walls = this.physics.add.staticGroup();

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

    this.menu = new LocationMenu((to, spawn) => this.goTo(to, spawn));
    const triggerExit = () => {
      if (this.currentExit) this.goTo(this.currentExit.to, this.currentExit.spawn);
    };
    this.exitBtn.onclick = triggerExit;
    window.addEventListener("keydown", (e) => {
      if (e.code === "Enter") triggerExit();
    });

    showCharacterSelect(CHARACTERS, (chosen) => this.startAs(chosen));
  }

  private spriteScale(sprite: string): number {
    const frame = this.textures.get(sprite).getSourceImage();
    return TARGET_H / frame.height;
  }

  private startAs(chosen: Character): void {
    this.chosen = chosen;
    this.player = this.physics.add.sprite(chosen.x, chosen.y, chosen.sprite);
    this.player.setScale(this.spriteScale(chosen.sprite)).setDepth(DEPTH.player);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);

    this.loadLocation(0, { x: chosen.x, y: chosen.y });
    this.started = true;
  }

  // Строит локацию index, снося предыдущую, и ставит игрока в spawn.
  private loadLocation(index: number, spawn: { x: number; y: number }): void {
    const cfg = LOCATIONS[index];
    this.locIndex = index;
    this.atParking = !!cfg.isParking;

    this.scenery.forEach((o) => o.destroy());
    this.scenery = [];
    this.walls.clear(true, true);

    this.scenery.push(this.add.image(0, 0, cfg.bg).setOrigin(0).setDepth(0));

    if (cfg.overlay && this.textures.exists(cfg.overlay)) {
      this.scenery.push(this.add.image(0, 0, cfg.overlay).setOrigin(0).setDepth(DEPTH.doorOverlay));
    }

    if (cfg.map && this.cache.tilemap.exists(cfg.map)) {
      const map = this.make.tilemap({ key: cfg.map });
      map.getObjectLayer("collision")?.objects.forEach((o) => {
        const w = o.width ?? 0;
        const h = o.height ?? 0;
        const rect = this.add.rectangle((o.x ?? 0) + w / 2, (o.y ?? 0) + h / 2, w, h);
        this.physics.add.existing(rect, true);
        this.walls.add(rect);
      });
    }

    this.npcs = this.atParking
      ? []
      : CHARACTERS.filter((c) => (c.location ?? 1) === index + 1 && c.id !== this.chosen.id);
    for (const c of this.npcs) {
      this.scenery.push(
        this.add
          .image(c.x, c.y, c.sprite)
          .setScale(this.spriteScale(c.sprite))
          .setOrigin(0.5, 0.5)
          .setFlipX(!!c.faceRight)
          .setDepth(c.y),
      );
      this.scenery.push(
        this.add
          .text(c.x, c.y - TARGET_H * 0.62, c.name, {
            fontFamily: "Trebuchet MS",
            fontSize: "13px",
            color: "#ffffff",
            backgroundColor: "#00000099",
            padding: { x: 5, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(c.y),
      );
    }

    // На парковке ходить нельзя — прячем игрока и показываем меню локаций.
    this.player.setVisible(!this.atParking);
    if (this.atParking) {
      this.player.setVelocity(0);
      this.menu.show(cfg);
    } else {
      this.menu.hide();
      this.player.setPosition(spawn.x, spawn.y);
    }
  }

  private goTo(to: number, spawn: { x: number; y: number }): void {
    this.showExit(null);
    this.loadLocation(to, spawn);
  }

  private showExit(exit: ExitDef | null): void {
    if (exit === this.currentExit) return;
    this.currentExit = exit;
    if (exit) {
      this.exitLabel.textContent = LOCATIONS[exit.to].enterLabel;
      this.exitBtn.classList.remove("hidden");
    } else {
      this.exitBtn.classList.add("hidden");
    }
  }

  // Первый выход, в зоне которого находится игрок.
  private findExit(): ExitDef | null {
    for (const exit of LOCATIONS[this.locIndex].exits) {
      const z = exit.zone;
      if (
        this.player.x >= z.x &&
        this.player.x <= z.x + z.w &&
        this.player.y >= z.y &&
        this.player.y <= z.y + z.h
      ) {
        return exit;
      }
    }
    return null;
  }

  update(): void {
    if (!this.started) return;

    // На парковке управление недоступно — работает только меню.
    if (this.atParking) {
      this.player.setVelocity(0);
      this.prompt.setVisible(false);
      this.showExit(null);
      return;
    }

    if (this.dialogue.isOpen) {
      this.player.setVelocity(0);
      this.prompt.setVisible(false);
      this.showExit(null);
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

    this.showExit(this.findExit());
  }
}

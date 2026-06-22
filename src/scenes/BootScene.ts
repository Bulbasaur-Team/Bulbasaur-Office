import Phaser from "phaser";
import { ALL_SPRITES, SPRITE_FILES } from "../entities/sprites";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    this.load.image("location", "assets/location.png");
    this.load.image("location-overlay", "assets/location-overlay.png");
    this.load.tilemapTiledJSON("map", "assets/office.tmj");
    for (const key of ALL_SPRITES) {
      this.load.image(key, `assets/${SPRITE_FILES[key]}`);
    }
  }

  create(): void {
    this.scene.start("World");
  }
}

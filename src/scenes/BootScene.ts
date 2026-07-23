import Phaser from "phaser";
import { ALL_SPRITES, SPRITE_FILES } from "../entities/sprites";
import { CLOCK_ASSETS } from "../entities/WallClock";
import { LOCATIONS } from "../data/locations";
import { ITEM_TYPES } from "../data/items";
import { publicPath } from "../publicPath";
import { setBootProgress } from "../ui/BootLoader";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    // overlay и коллизии могут появиться позже — их отсутствие не фатально.
    this.load.on("loaderror", () => {});
    this.load.on("progress", (value: number) => setBootProgress(value));

    for (const loc of LOCATIONS) {
      // Парковка — не локация, а способ перемещения: её фон лежит в корне assets.
      if (loc.isParking) {
        this.load.image(loc.bg, publicPath("assets/fastTravel.png"));
        continue;
      }

      // Ассеты каждой локации лежат в assets/locations/<id>/.
      const dir = publicPath(`assets/locations/${loc.id}`);
      this.load.image(loc.bg, `${dir}/background.png`);
      if (loc.overlay) {
        this.load.image(loc.overlay, `${dir}/overlay.png`);
      }
      if (loc.map) {
        this.load.tilemapTiledJSON(loc.map, `${dir}/collisions.tmj`);
      }
    }

    for (const key of ALL_SPRITES) {
      this.load.image(key, publicPath(`assets/${SPRITE_FILES[key]}`));
    }
    this.load.image("bulba-cat", publicPath("assets/characters/bulba-cat.png"));
    this.load.image("bulba-cat-walk", publicPath("assets/characters/bulba-cat-walk.png"));

    for (const def of Object.values(ITEM_TYPES)) {
      this.load.image(def.texture, publicPath(`assets/items/${def.file}`));
    }

    for (const { key, file } of CLOCK_ASSETS) {
      this.load.image(key, publicPath(`assets/${file}`));
    }
  }

  create(): void {
    this.scene.start("World");
  }
}

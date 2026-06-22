import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { WorldScene } from "./scenes/WorldScene";

new Phaser.Game({
  type: Phaser.AUTO,
  width: 1408,
  height: 768,
  parent: "game",
  backgroundColor: "#11141a",
  pixelArt: true,
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, WorldScene],
});

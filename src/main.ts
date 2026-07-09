import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { WorldScene } from "./scenes/WorldScene";
import { isTouch } from "./ui/TouchControls";
import { initOrientation, onStageChange, stage } from "./ui/orientation";

const GW = 1408;
const GH = 768;
const touch = isTouch();

initOrientation();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: GW,
  height: GH,
  parent: "game",
  backgroundColor: "#11141a",
  pixelArt: true,
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  // Десктоп: штатный FIT. Мобилки: масштабируем канвас сами (см. ниже), потому что
  // FIT меряет родителя через getBoundingClientRect и ломается при повороте сцены.
  scale: {
    mode: touch ? Phaser.Scale.NONE : Phaser.Scale.FIT,
    autoCenter: touch ? Phaser.Scale.NO_CENTER : Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, WorldScene],
});

// Мобильный ручной масштаб: канвас вписывается в сцену, поворот берёт на себя #stage.
if (touch) {
  const layout = (): void => {
    const canvas = game.canvas;
    if (!canvas) return;
    const scale = Math.min(stage.width / GW, stage.height / GH);
    canvas.style.position = "fixed";
    canvas.style.left = "50%";
    canvas.style.top = "50%";
    canvas.style.margin = "0";
    canvas.style.width = `${GW}px`;
    canvas.style.height = `${GH}px`;
    canvas.style.transformOrigin = "center center";
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  game.events.once(Phaser.Core.Events.READY, layout);
  onStageChange(layout);
}

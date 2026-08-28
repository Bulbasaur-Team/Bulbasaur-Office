import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { WorldScene } from "./scenes/WorldScene";
import { backgroundMusic } from "./ui/BackgroundMusic";
import { isTouch } from "./ui/TouchControls";
import { initOrientation, onStageChange, stage } from "./ui/orientation";

const GW = 1408;
const GH = 768;
const touch = isTouch();

initOrientation();
backgroundMusic.install();

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
  // Десктоп: штатный FIT. Мобилки: масштабируем канвас сами в letterbox сцены.
  scale: {
    mode: touch ? Phaser.Scale.NONE : Phaser.Scale.FIT,
    autoCenter: touch ? Phaser.Scale.NO_CENTER : Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, WorldScene],
});

// Мобильный ручной масштаб: канвас вписывается в letterbox сцены.
if (touch) {
  const layout = (): void => {
    const canvas = game.canvas;
    if (!canvas) return;
    const scale = Math.min(stage.width / GW, stage.height / GH);
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.margin = "0";
    canvas.style.width = `${GW}px`;
    canvas.style.height = `${GH}px`;
    canvas.style.transformOrigin = "0 0";
    canvas.style.transform = `scale(${scale})`;
  };
  game.events.once(Phaser.Core.Events.READY, () => {
    layout();
    patchPointerTransform();
  });
  onStageChange(layout);
}

// Штатный transformPointer Phaser переводит экранные координаты в игровые как
// (pageX - canvasBounds.left) * displayScale. Канвас масштабируется CSS-transform,
// поэтому считаем от центра кадра и текущего scale сцены.
function patchPointerTransform(): void {
  game.input.transformPointer = (
    pointer: Phaser.Input.Pointer,
    pageX: number,
    pageY: number,
    wasMove: boolean,
  ): void => {
    const prev = pointer.prevPosition;
    const pos = pointer.position;
    prev.x = pos.x;
    prev.y = pos.y;

    const rect = game.canvas.getBoundingClientRect();
    const scale = Math.min(stage.width / GW, stage.height / GH);
    const localX = pageX - window.scrollX - (rect.left + rect.width / 2);
    const localY = pageY - window.scrollY - (rect.top + rect.height / 2);
    const x = localX / scale + GW / 2;
    const y = localY / scale + GH / 2;

    const smooth = pointer.smoothFactor;
    if (!wasMove || smooth === 0) {
      pos.x = x;
      pos.y = y;
    } else {
      pos.x = x * smooth + prev.x * (1 - smooth);
      pos.y = y * smooth + prev.y * (1 - smooth);
    }
  };
}

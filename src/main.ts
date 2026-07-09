import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { WorldScene } from "./scenes/WorldScene";
import { isTouch } from "./ui/TouchControls";
import { initOrientation, onStageChange, screenToStage, stage } from "./ui/orientation";

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
  game.events.once(Phaser.Core.Events.READY, () => {
    layout();
    patchPointerTransform();
  });
  onStageChange(layout);
}

// Штатный transformPointer Phaser переводит экранные координаты в игровые как
// (pageX - canvasBounds.left) * displayScale — плоское преобразование, которое не знает
// про поворот сцены. Из-за этого на телефоне интерактивные объекты (кнопка проектора,
// экран TV) ловили тап не в том месте. Считаем сами: bounding box повёрнутого канваса
// осецентричен, поэтому его центр — настоящий центр кадра.
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
    const local = screenToStage(
      pageX - window.scrollX - (rect.left + rect.width / 2),
      pageY - window.scrollY - (rect.top + rect.height / 2),
    );
    const x = local.x / scale + GW / 2;
    const y = local.y / scale + GH / 2;

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

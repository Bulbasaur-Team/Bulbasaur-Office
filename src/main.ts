import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { WorldScene } from "./scenes/WorldScene";
import { isTouch } from "./ui/TouchControls";

const GW = 1408;
const GH = 768;
const touch = isTouch();

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
  // Десктоп: штатный FIT. Мобилки: масштабируем и поворачиваем канвас сами (см. ниже),
  // потому что FIT меряет родителя через getBoundingClientRect и ломается при CSS-повороте.
  scale: {
    mode: touch ? Phaser.Scale.NONE : Phaser.Scale.FIT,
    autoCenter: touch ? Phaser.Scale.NO_CENTER : Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, WorldScene],
});

// Мобильный ручной масштаб: мир всегда «горизонтальный». В портрете канвас повёрнут на
// 90° и вписан по длинной стороне экрана; в ландшафте — просто вписан. Оси джойстика при
// повороте компенсируются в WorldScene.
if (touch) {
  const layout = (): void => {
    const canvas = game.canvas;
    if (!canvas) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const portrait = vh > vw;
    const scale = portrait ? Math.min(vh / GW, vw / GH) : Math.min(vw / GW, vh / GH);
    canvas.style.position = "fixed";
    canvas.style.left = "50%";
    canvas.style.top = "50%";
    canvas.style.margin = "0";
    canvas.style.width = `${GW}px`;
    canvas.style.height = `${GH}px`;
    canvas.style.transformOrigin = "center center";
    canvas.style.transform = `translate(-50%, -50%) rotate(${portrait ? 90 : 0}deg) scale(${scale})`;
  };
  game.events.once(Phaser.Core.Events.READY, layout);
  window.addEventListener("resize", layout);
  window.addEventListener("orientationchange", () => setTimeout(layout, 200));
}

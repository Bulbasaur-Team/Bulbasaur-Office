import Phaser from "phaser";

/** Ключи текстур настенных часов (циферблат и стрелки отдельно — циферблат можно подменить). */
export const CLOCK_FACE = "clock-face";
export const CLOCK_HOUR = "clock-hour";
export const CLOCK_MINUTE = "clock-minute";
export const CLOCK_SECOND = "clock-second";

export const CLOCK_ASSETS: { key: string; file: string }[] = [
  { key: CLOCK_FACE, file: "clock/face.png" },
  { key: CLOCK_HOUR, file: "clock/hand-hour.png" },
  { key: CLOCK_MINUTE, file: "clock/hand-minute.png" },
  { key: CLOCK_SECOND, file: "clock/hand-second.png" },
];

// Стрелки в ассетах нарисованы на 12 часов (вверх) → угол Phaser 0 = 12:00.
export class WallClock {
  private root: Phaser.GameObjects.Container;
  private hour: Phaser.GameObjects.Image;
  private minute: Phaser.GameObjects.Image;
  private second: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const scale = 1.3;
    this.hour = scene.add.image(0, 0, CLOCK_HOUR).setOrigin(0.5).setScale(scale);
    this.minute = scene.add.image(0, 0, CLOCK_MINUTE).setOrigin(0.5).setScale(scale);
    this.second = scene.add.image(0, 0, CLOCK_SECOND).setOrigin(0.5).setScale(scale);

    this.root = scene.add
      .container(x, y, [
        scene.add.image(0, 0, CLOCK_FACE).setOrigin(0.5).setScale(scale),
        this.hour,
        this.minute,
        this.second,
      ])
      // На стене: ниже персонажей в этой комнате (у них depth ≈ y ног).
      .setDepth(y);

    this.sync();
  }

  /** Выставляем стрелки по локальному времени браузера. */
  sync(): void {
    const now = new Date();
    const s = now.getSeconds(); // целые секунды — секундная стрелка тикает раз в секунду
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;

    this.hour.setAngle(h * 30);
    this.minute.setAngle(m * 6);
    this.second.setAngle(s * 6);
  }

  destroy(): void {
    this.root.destroy(true);
  }
}

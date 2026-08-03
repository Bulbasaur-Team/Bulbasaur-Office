import Phaser from "phaser";
import {
  BODY_FILE,
  BODY_TEXTURE,
  LAYER_ORDER,
  textureKeyForItem,
  WARDROBE_ITEMS,
  type PlayerAppearance,
} from "../data/wardrobe";
import { publicPath } from "../publicPath";

/**
 * Слоистый аватар мультиплеера: тело + одежда в Phaser Container.
 */
export class PlayerAvatar {
  readonly container: Phaser.GameObjects.Container;
  private layers = new Map<string, Phaser.GameObjects.Image>();
  private appearance: PlayerAppearance;
  private baseScale: number;
  private flipped = false;

  constructor(
    private scene: Phaser.Scene,
    x: number,
    y: number,
    appearance: PlayerAppearance,
    private targetH: number,
  ) {
    this.appearance = appearance;
    this.container = scene.add.container(x, y);
    this.baseScale = this.computeScale();
    this.rebuild();
  }

  get x(): number {
    return this.container.x;
  }

  get y(): number {
    return this.container.y;
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  setFlipX(flip: boolean): void {
    this.flipped = flip;
    for (const img of this.layers.values()) {
      img.setFlipX(flip);
    }
  }

  setDepth(depth: number): void {
    this.container.setDepth(depth);
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  setAppearance(appearance: PlayerAppearance): void {
    this.appearance = appearance;
    this.rebuild();
  }

  getAppearance(): PlayerAppearance {
    return this.appearance;
  }

  destroy(): void {
    this.container.destroy(true);
    this.layers.clear();
  }

  private computeScale(): number {
    const tex = this.scene.textures.get(BODY_TEXTURE);
    const src = tex.getSourceImage() as HTMLImageElement;
    return this.targetH / src.height;
  }

  private rebuild(): void {
    for (const img of this.layers.values()) {
      img.destroy();
    }
    this.layers.clear();
    this.container.removeAll(true);

    let z = 0;
    for (const slot of LAYER_ORDER) {
      const key = slot === "body" ? BODY_TEXTURE : this.textureForSlot(slot);
      if (!key || !this.scene.textures.exists(key)) continue;
      const img = this.scene.add
        .image(0, 0, key)
        .setScale(this.baseScale)
        .setOrigin(0.5, 0.5)
        .setFlipX(this.flipped);
      this.container.addAt(img, z++);
      this.layers.set(slot, img);
    }
  }

  private textureForSlot(slot: keyof PlayerAppearance): string | null {
    const code = this.appearance[slot];
    return code ? textureKeyForItem(code) : null;
  }
}

/** Рисует layered-аватар в DOM-canvas (гардероб, сообщество). */
export function drawAppearance(
  ctx: CanvasRenderingContext2D,
  size: number,
  appearance: PlayerAppearance,
  images: Map<string, HTMLImageElement>,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  const draw = (img: HTMLImageElement | undefined) => {
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const scale = Math.min(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  };
  draw(images.get(BODY_TEXTURE));
  for (const slot of ["bottom", "top", "shoes", "hat", "glasses"] as const) {
    const code = appearance[slot];
    if (code) draw(images.get(textureKeyForItem(code)));
  }
}

/** Предзагрузка картинок гардероба для DOM-канвасов. */
export function loadWardrobeDomImages(): Promise<Map<string, HTMLImageElement>> {
  const map = new Map<string, HTMLImageElement>();
  const jobs: Promise<void>[] = [];
  const add = (key: string, file: string) => {
    jobs.push(new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { map.set(key, img); resolve(); };
      img.onerror = () => resolve();
      img.src = publicPath(`assets/${file}`);
    }));
  };
  add(BODY_TEXTURE, BODY_FILE);
  for (const item of WARDROBE_ITEMS) {
    add(textureKeyForItem(item.code), item.file);
  }
  return Promise.all(jobs).then(() => map);
}

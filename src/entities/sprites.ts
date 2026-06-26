import Phaser from "phaser";

export type SpriteKey =
  | "dev"
  | "dev-fe"
  | "analyst"
  | "owner"
  | "lead"
  | "qa"
  | "designer";

// Ключ спрайта -> имя файла в public/assets/characters.
export const SPRITE_FILES: Record<SpriteKey, string> = {
  dev: "characters/dev.png",
  "dev-fe": "characters/dev-fe.png",
  analyst: "characters/analyst.png",
  owner: "characters/product-owner.png",
  lead: "characters/lead.png",
  qa: "characters/qa.png",
  designer: "characters/desinger.png",
};

export const ALL_SPRITES = Object.keys(SPRITE_FILES) as SpriteKey[];

// Картинки уже с прозрачным фоном. Кэшируем их, чтобы портреты в DOM-канвасах
// (Dialogue, CharacterSelect) могли рисоваться без доступа к сцене.
const images = new Map<SpriteKey, HTMLImageElement>();

export function registerSpriteImages(scene: Phaser.Scene): void {
  for (const key of ALL_SPRITES) {
    images.set(key, scene.textures.get(key).getSourceImage() as HTMLImageElement);
  }
}

export const getSpriteImage = (k: SpriteKey) => images.get(k)!;

// Рисует картинку по центру квадрата size x size с сохранением пропорций.
export function drawContain(ctx: CanvasRenderingContext2D, src: HTMLImageElement, size: number): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  const scale = Math.min(size / src.width, size / src.height);
  const w = src.width * scale;
  const h = src.height * scale;
  ctx.drawImage(src, (size - w) / 2, (size - h) / 2, w, h);
}

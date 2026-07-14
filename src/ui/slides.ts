import { CHARACTERS, type Character } from "../data/characters";
import { publicPath } from "../publicPath";

// Запасные слайды — показываются в сюжетном диалоге с NPC, если своих файлов нет.
export const SAMPLE_SLIDES = [
  publicPath("assets/slides/sample_1.png"),
  publicPath("assets/slides/sample_2.png"),
  publicPath("assets/slides/sample_3.png"),
];

// Пути к слайдам персонажа. Если slideCount === 0 — сразу образцы; если файлов
// по этим путям нет на диске, фолбэк на образцы делает загрузчик (onerror).
export function slidePaths(npc: Character): string[] {
  if (npc.slideCount <= 0) return SAMPLE_SLIDES;
  return Array.from({ length: npc.slideCount }, (_, i) =>
    publicPath(`assets/slides/${npc.id}_${i + 1}.png`),
  );
}

/** Пути по id владельца колоды (для синка проектора). null — неизвестный / без слайдов. */
export function slidePathsByOwnerId(ownerId: string): string[] | null {
  const owner = CHARACTERS.find((c) => c.id === ownerId);
  if (!owner || owner.slideCount <= 0) return null;
  return slidePaths(owner);
}

import type { Character } from "../data/characters";
import { publicPath } from "../publicPath";

// Запасные слайды — показываются, если у персонажа нет ни одного своего файла.
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

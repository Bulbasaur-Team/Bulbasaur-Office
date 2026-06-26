import type { Character } from "../data/characters";

// Запасные слайды — показываются, если у персонажа нет ни одного своего файла.
export const SAMPLE_SLIDES = ["assets/slides/sample_1.png", "assets/slides/sample_2.png", "assets/slides/sample_3.png"];

export function slidePaths(npc: Character): string[] {
  const own = Array.from({ length: npc.slideCount }, (_, i) => `assets/slides/${npc.id}_${i + 1}.png`);
  return own.length > 0 ? own : SAMPLE_SLIDES;
}

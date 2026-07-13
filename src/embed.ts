import { publicPath } from "./publicPath";

// Компьютер в дата-центре открывает эту же сборку в iframe — игра внутри игры.
// depth — уровень вложенности: 0 у обычной вкладки, +1 на каждый iframe. На MAX_DEPTH
// компьютер перестаёт быть интерактивным, иначе рекурсию было бы нечем оборвать.
const MAX_DEPTH = 2;

function readDepth(): number {
  const raw = Number(new URLSearchParams(window.location.search).get("depth"));
  if (!Number.isInteger(raw) || raw < 0) return 0;
  return Math.min(raw, MAX_DEPTH);
}

export const depth = readDepth();

// Игра запущена внутри компьютера: только одиночный режим, мини-игры недоступны.
export const embedded = depth > 0;

// Компьютер интерактивен, пока есть куда углубляться.
export const computerEnabled = depth < MAX_DEPTH;

// Адрес вложенной копии: та же сборка уровнем глубже.
export function nestedUrl(): string {
  return `${publicPath("")}?depth=${depth + 1}`;
}

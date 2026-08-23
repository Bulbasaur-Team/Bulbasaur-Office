// Компьютер в дата-центре открывает эту же сборку в iframe — игра внутри игры.
// depth — уровень вложенности: 0 у обычной вкладки, +1 на каждый iframe. На MAX_DEPTH
// компьютер перестаёт быть интерактивным, иначе рекурсию было бы нечем оборвать.
const MAX_DEPTH = 10;

function queryDepth(): number {
  const raw = Number(new URLSearchParams(window.location.search).get("depth"));
  if (!Number.isInteger(raw) || raw < 0) return 0;
  return Math.min(raw, MAX_DEPTH);
}

/** Сколько iframe-родителей до верхней вкладки. Надёжнее query: `?depth=` иногда теряется. */
function iframeNesting(): number {
  let n = 0;
  try {
    let w: Window = window;
    while (w.parent !== w) {
      n += 1;
      if (n >= MAX_DEPTH) break;
      w = w.parent;
    }
  } catch {
    return Math.max(n, 1);
  }
  return n;
}

export const depth = Math.min(MAX_DEPTH, Math.max(queryDepth(), iframeNesting()));

// Игра запущена внутри компьютера: только одиночный режим, мини-игры недоступны.
export const embedded = depth > 0;

// Компьютер интерактивен, пока есть куда углубляться.
export const computerEnabled = depth < MAX_DEPTH;

// Адрес вложенной копии: та же страница уровнем глубже.
export function nestedUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set("depth", String(depth + 1));
  return url.toString();
}

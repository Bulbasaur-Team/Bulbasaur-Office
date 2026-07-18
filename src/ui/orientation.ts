import { isTouch } from "./TouchControls";

export type Orient = "portrait" | "landscape";

// Экраны с фиксированной ориентацией. Порядок = приоритет: если открыто несколько,
// побеждает последний видимый в списке (он же лежит выше по z-index).
const SCREENS: ReadonlyArray<readonly [string, Orient]> = [
  ["select", "landscape"],
  ["roleSelect", "landscape"],
  ["modeSelect", "portrait"],
  ["bulbajump", "portrait"],
  ["bulbapacker", "portrait"],
  ["bulbaparking", "portrait"],
  ["bulbatanks", "portrait"],
  ["bulbaguess", "portrait"],
  ["bulbawordle", "portrait"],
  ["bulbacolors", "portrait"],
  ["bulbasurki", "portrait"],
  ["airhockey", "portrait"],
  ["auth", "portrait"],
];

// Ориентация мира: её же наследуют экраны без своей записи (лидерборд, слайды, HUD-меню).
const WORLD: Orient = "landscape";

// Логический размер сцены в CSS-пикселях: при повороте стороны меняются местами.
// Вся вёрстка меряется от него, а не от window.innerWidth/innerHeight.
// rotated — сцена повёрнута на 90° по часовой; экранные координаты события в
// координаты сцены переводит screenToStage().
export const stage = { width: window.innerWidth, height: window.innerHeight, rotated: false };

// Обратное преобразование поворота сцены: локальный вектор (lx, ly) виден на экране
// как (-ly, lx), значит из экранного (sx, sy) получаем (sy, -sx).
export function screenToStage(sx: number, sy: number): { x: number; y: number } {
  return stage.rotated ? { x: sy, y: -sx } : { x: sx, y: sy };
}

const listeners = new Set<() => void>();

export function onStageChange(fn: () => void): void {
  listeners.add(fn);
}

function wanted(): Orient {
  let orient = WORLD;
  for (const [id, screenOrient] of SCREENS) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains("hidden")) orient = screenOrient;
  }
  return orient;
}

// Разворачиваем сцену на 90°, если физическая ориентация не совпадает с нужной.
// Поэтому поворот телефона визуально ничего не меняет: компенсация пересчитывается.
function apply(): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const physical: Orient = vh >= vw ? "portrait" : "landscape";
  const rotate = isTouch() && physical !== wanted();

  stage.rotated = rotate;
  stage.width = rotate ? vh : vw;
  stage.height = rotate ? vw : vh;

  const root = document.documentElement;
  root.dataset.rot = rotate ? "1" : "0";
  root.style.setProperty("--sw", `${stage.width}px`);
  root.style.setProperty("--sh", `${stage.height}px`);
  // Брейкпоинты считаем от ширины сцены, а не окна: media-запросы про поворот не знают.
  root.classList.toggle("bp-640", stage.width <= 640);
  root.classList.toggle("bp-560", stage.width <= 560);
  root.classList.toggle("bp-400", stage.width <= 400);

  for (const fn of listeners) fn();
}

export function initOrientation(): void {
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", () => setTimeout(apply, 200));
  // На мобильных высота вьюпорта доезжает до финальной уже после первого кадра
  // (сворачивается адресная строка) — иначе сцена так и осталась бы посчитанной
  // по завышенной высоте до первого поворота телефона.
  window.addEventListener("load", apply);
  window.visualViewport?.addEventListener("resize", apply);

  // Экраны показываются/прячутся через класс hidden — следим за ним, чтобы не
  // дёргать ориентацию вручную из каждого open()/close().
  const observer = new MutationObserver(apply);
  for (const [id] of SCREENS) {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributes: true, attributeFilter: ["class"] });
  }
}

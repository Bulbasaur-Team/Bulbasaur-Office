import { isTouch } from "./device";

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
  ["bulbaquiz", "portrait"],
  ["airhockey", "portrait"],
  ["auth", "portrait"],
  // Телефон в телефоне: вертикальный UI поверх landscape-мира.
  ["bulbaPhone", "portrait"],
  // Ноутбук / BulbaTalk: тоже вертикально, иначе сетка звонка на телефоне схлопывается.
  ["laptop", "portrait"],
];

// Ориентация мира: её же наследуют экраны без своей записи (лидерборд, слайды, HUD-меню).
const WORLD: Orient = "landscape";
const WORLD_ASPECT = 1408 / 768;
/** Узкие поля под контролы — только когда телефон уже в нужной ориентации. */
const TOUCH_SIDE_GUTTER = 76;
const TOUCH_BOTTOM_GUTTER = 56;

// Логический размер сцены в CSS-пикселях. При несовпадении с телефоном стороны
// меняются местами, а #stage крутится на 90° — автоповорот визуально ничего не меняет.
// rotated — сцена повёрнута на 90° по часовой; экранные координаты → screenToStage().
export const stage = { width: window.innerWidth, height: window.innerHeight, rotated: false };

// Обратное преобразование поворота: локальный (lx, ly) на экране виден как (-ly, lx),
// значит из экранного (sx, sy) получаем (sy, -sx).
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

function fitBox(aspect: number, maxW: number, maxH: number): { w: number; h: number } {
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w, h };
}

function publish(sw: number, sh: number, sx: number, sy: number, sb: number, rotate: boolean): void {
  stage.rotated = rotate;
  stage.width = sw;
  stage.height = sh;

  const root = document.documentElement;
  root.dataset.rot = rotate ? "1" : "0";
  root.style.setProperty("--sw", `${sw}px`);
  root.style.setProperty("--sh", `${sh}px`);
  root.style.setProperty("--sx", `${sx}px`);
  root.style.setProperty("--sy", `${sy}px`);
  root.style.setProperty("--sb", `${sb}px`);
  root.classList.toggle("bp-640", stage.width <= 640);
  root.classList.toggle("bp-560", stage.width <= 560);
  root.classList.toggle("bp-400", stage.width <= 400);
  root.classList.toggle("bp-short", stage.height <= 480);

  for (const fn of listeners) fn();
}

// Разворачиваем сцену на 90°, если физическая ориентация не совпадает с нужной.
// Поэтому поворот телефона визуально ничего не меняет: компенсация пересчитывается.
function apply(): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const touch = isTouch();
  const want = wanted();
  const physical: Orient = vh >= vw ? "portrait" : "landscape";
  const rotate = touch && physical !== want;

  if (!touch) {
    publish(vw, vh, 0, 0, 0, false);
    return;
  }

  if (rotate) {
    // Логический кадр = окно с переставленными сторонами. CSS rotate(90) заполнит экран.
    publish(vh, vw, 0, 0, 0, true);
    return;
  }

  if (want === "landscape") {
    const maxW = Math.max(160, vw - TOUCH_SIDE_GUTTER * 2);
    const maxH = Math.max(120, vh - TOUCH_BOTTOM_GUTTER);
    const box = fitBox(WORLD_ASPECT, maxW, maxH);
    const sx = (vw - box.w) / 2;
    const sy = Math.max(0, (vh - TOUCH_BOTTOM_GUTTER - box.h) / 2);
    const sb = Math.max(TOUCH_BOTTOM_GUTTER, vh - sy - box.h);
    publish(box.w, box.h, sx, sy, sb, false);
    return;
  }

  publish(vw, vh, 0, 0, 0, false);
}

export function initOrientation(): void {
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", () => setTimeout(apply, 200));
  window.addEventListener("load", apply);
  window.visualViewport?.addEventListener("resize", apply);

  const observer = new MutationObserver(apply);
  for (const [id] of SCREENS) {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributes: true, attributeFilter: ["class"] });
  }
}

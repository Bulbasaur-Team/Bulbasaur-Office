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
const PORTRAIT_ASPECT = 9 / 16;
/** Узкие поля под контролы: не раздувать letterbox сверх этого. */
const TOUCH_SIDE_GUTTER = 76;
const TOUCH_BOTTOM_GUTTER = 56;

// Логический размер сцены в CSS-пикселях. На телефоне это letterbox нужной ориентации:
// поворот устройства только меняет поля, сам кадр не крутится.
// rotated оставлен для старых вызовов screenToStage(); больше не выставляется в true.
export const stage = { width: window.innerWidth, height: window.innerHeight, rotated: false };

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

function apply(): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const touch = isTouch();
  const want = wanted();

  let sw: number;
  let sh: number;
  if (!touch) {
    sw = vw;
    sh = vh;
  } else if (want === "portrait") {
    const box = fitBox(PORTRAIT_ASPECT, vw, vh);
    sw = box.w;
    sh = box.h;
  } else {
    const maxW = Math.max(160, vw - TOUCH_SIDE_GUTTER * 2);
    const maxH = Math.max(120, vh - TOUCH_BOTTOM_GUTTER);
    const box = fitBox(WORLD_ASPECT, maxW, maxH);
    sw = box.w;
    sh = box.h;
  }

  stage.rotated = false;
  stage.width = sw;
  stage.height = sh;

  const sx = (vw - sw) / 2;
  let sy: number;
  let sb: number;
  if (touch && want === "landscape") {
    // Кадр по центру области над нижней полоской — полоска всегда тонкая.
    sy = Math.max(0, (vh - TOUCH_BOTTOM_GUTTER - sh) / 2);
    sb = Math.max(TOUCH_BOTTOM_GUTTER, vh - sy - sh);
  } else {
    sy = (vh - sh) / 2;
    sb = 0;
  }

  const root = document.documentElement;
  root.dataset.rot = "0";
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

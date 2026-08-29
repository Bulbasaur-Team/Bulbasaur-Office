/** Соответствие игровых координат (1408×768) и CSS-пикселей канваса Phaser. */

import { stage } from "./orientation";

export const GAME_W = 1408;
export const GAME_H = 768;

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function canvasStageScale(): number {
  return Math.min(stage.width / GAME_W, stage.height / GAME_H);
}

export function gameViewport(canvas: HTMLCanvasElement): { left: number; top: number; scaleX: number; scaleY: number } {
  if (stage.rotated) {
    const scale = canvasStageScale();
    return { left: 0, top: 0, scaleX: scale, scaleY: scale };
  }
  const rect = canvas.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    scaleX: rect.width / GAME_W,
    scaleY: rect.height / GAME_H,
  };
}

export function gamePointToViewport(x: number, y: number, canvas: HTMLCanvasElement): { left: number; top: number } {
  const local = gamePointToStage(x, y, canvas);
  return stageToViewport(local.left, local.top);
}

/** Игровые координаты → left/top внутри #stage. */
export function gamePointToStage(x: number, y: number, canvas: HTMLCanvasElement): { left: number; top: number } {
  if (stage.rotated) {
    const scale = canvasStageScale();
    return { left: x * scale, top: y * scale };
  }
  const vp = gameViewport(canvas);
  return viewportToStage(vp.left + x * vp.scaleX, vp.top + y * vp.scaleY);
}

export function gameRectToViewport(
  r: { x: number; y: number; w: number; h: number },
  canvas: HTMLCanvasElement,
): ViewportRect {
  const box = gameRectToStage(r, canvas);
  const tl = stageToViewport(box.left, box.top);
  const br = stageToViewport(box.left + box.width, box.top + box.height);
  return {
    left: Math.min(tl.left, br.left),
    top: Math.min(tl.top, br.top),
    width: Math.abs(br.left - tl.left),
    height: Math.abs(br.top - tl.top),
  };
}

/** Игровой прямоугольник → CSS-пиксели внутри #stage (без AABB после rotate). */
export function gameRectToStage(
  r: { x: number; y: number; w: number; h: number },
  canvas: HTMLCanvasElement,
): ViewportRect {
  if (stage.rotated) {
    const scale = canvasStageScale();
    return { left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale };
  }
  const vp = gameViewport(canvas);
  const local = viewportToStage(vp.left + r.x * vp.scaleX, vp.top + r.y * vp.scaleY);
  return { left: local.left, top: local.top, width: r.w * vp.scaleX, height: r.h * vp.scaleY };
}

/** Stage-local → viewport. Учитывает CSS rotate(90) вокруг центра окна. */
export function stageToViewport(left: number, top: number): { left: number; top: number } {
  if (!stage.rotated) {
    const stageEl = document.getElementById("stage");
    if (!stageEl) return { left, top };
    const cs = getComputedStyle(stageEl);
    if (cs.display === "contents" || cs.transform === "none") return { left, top };
    const r = stageEl.getBoundingClientRect();
    return { left: r.left + left, top: r.top + top };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const lx = left - stage.width / 2;
  const ly = top - stage.height / 2;
  // CSS rotate(90deg), y вниз: (x, y) → (-y, x).
  return { left: vw / 2 - ly, top: vh / 2 + lx };
}

/** Viewport → координаты внутри #stage (там position:fixed считается от сцены). */
export function viewportToStage(left: number, top: number): { left: number; top: number } {
  const stageEl = document.getElementById("stage");
  if (!stageEl) return { left, top };
  const cs = getComputedStyle(stageEl);
  if (cs.display === "contents") return { left, top };

  if (!stage.rotated) {
    if (cs.transform === "none") return { left, top };
    const r = stageEl.getBoundingClientRect();
    return { left: left - r.left, top: top - r.top };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dx = left - vw / 2;
  const dy = top - vh / 2;
  // Обратное к (x, y) → (-y, x): (dx, dy) → (dy, -dx).
  return { left: dy + stage.width / 2, top: -dx + stage.height / 2 };
}

/** Соответствие игровых координат (1408×768) и viewport-пикселей канваса Phaser. */

export const GAME_W = 1408;
export const GAME_H = 768;

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function gameViewport(canvas: HTMLCanvasElement): { left: number; top: number; scaleX: number; scaleY: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    scaleX: rect.width / GAME_W,
    scaleY: rect.height / GAME_H,
  };
}

export function gamePointToViewport(x: number, y: number, canvas: HTMLCanvasElement): { left: number; top: number } {
  const vp = gameViewport(canvas);
  return {
    left: vp.left + x * vp.scaleX,
    top: vp.top + y * vp.scaleY,
  };
}

/** Игровые координаты → left/top внутри #stage (position:fixed от сцены на таче). */
export function gamePointToStage(x: number, y: number, canvas: HTMLCanvasElement): { left: number; top: number } {
  const p = gamePointToViewport(x, y, canvas);
  return viewportToStage(p.left, p.top);
}

export function gameRectToViewport(
  r: { x: number; y: number; w: number; h: number },
  canvas: HTMLCanvasElement,
): ViewportRect {
  const vp = gameViewport(canvas);
  return {
    left: vp.left + r.x * vp.scaleX,
    top: vp.top + r.y * vp.scaleY,
    width: r.w * vp.scaleX,
    height: r.h * vp.scaleY,
  };
}

/** Viewport → координаты внутри #stage (там position:fixed считается от сцены). */
export function viewportToStage(left: number, top: number): { left: number; top: number } {
  const stageEl = document.getElementById("stage");
  if (!stageEl) return { left, top };
  const cs = getComputedStyle(stageEl);
  if (cs.display === "contents" || cs.transform === "none") return { left, top };
  const r = stageEl.getBoundingClientRect();
  return { left: left - r.left, top: top - r.top };
}

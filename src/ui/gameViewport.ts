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

// Тач-управление для мобильных браузеров: виртуальный джойстик + кнопка действия
// для мира и панель удержания кнопок для аркад. Показывается только на тач-устройствах.

export function isTouch(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

// Виртуальный аналоговый джойстик (мир) + круглая кнопка действия.
export class Joystick {
  // Направление в диапазоне [-1..1] по каждой оси; читается в игровом цикле.
  readonly vector = { x: 0, y: 0 };
  onAction: (() => void) | null = null;

  private wrap = div("touch-joy hidden");
  private base = div("touch-joy-base");
  private knob = div("touch-joy-knob");
  private action = document.createElement("button");
  private pid: number | null = null;
  private readonly radius = 52;
  private readonly dead = 0.18; // мёртвая зона, чтобы лёгкое касание не двигало

  constructor() {
    this.base.appendChild(this.knob);
    this.wrap.appendChild(this.base);
    this.action.className = "touch-action hidden";
    this.action.setAttribute("aria-label", "действие");
    this.action.textContent = "✦";
    document.body.appendChild(this.wrap);
    document.body.appendChild(this.action);

    this.base.addEventListener("pointerdown", this.onDown);
    this.base.addEventListener("pointermove", this.onMove);
    this.base.addEventListener("pointerup", this.onUp);
    this.base.addEventListener("pointercancel", this.onUp);
    this.action.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onAction?.();
    });
    this.action.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  setVisible(v: boolean): void {
    this.wrap.classList.toggle("hidden", !v);
    this.action.classList.toggle("hidden", !v);
    if (!v) this.reset();
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.pid = e.pointerId;
    this.base.setPointerCapture(e.pointerId);
    this.move(e);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.pid !== e.pointerId) return;
    e.preventDefault();
    this.move(e);
  };

  private onUp = (e: PointerEvent): void => {
    if (this.pid !== e.pointerId) return;
    this.pid = null;
    this.reset();
  };

  private move(e: PointerEvent): void {
    const r = this.base.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > this.radius) {
      dx = (dx / dist) * this.radius;
      dy = (dy / dist) * this.radius;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / this.radius;
    const ny = dy / this.radius;
    this.vector.x = Math.abs(nx) < this.dead ? 0 : nx;
    this.vector.y = Math.abs(ny) < this.dead ? 0 : ny;
  }

  private reset(): void {
    this.vector.x = 0;
    this.vector.y = 0;
    this.knob.style.transform = "translate(0,0)";
  }
}

export interface PadButton {
  label: string;
  code: string;
}

// Панель тач-кнопок для аркады. Кнопки работают «на удержание»: pressKey(code, true/false)
// дёргает те же обработчики, что и клавиатура (с таймерами/рестартом внутри игры).
// Видима только на тач-устройствах (CSS), поэтому на десктопе безвредна.
export function attachArcadePad(
  frame: HTMLElement,
  press: (code: string, down: boolean) => void,
  groups: { left: PadButton[]; right?: PadButton[] },
): void {
  const bar = div("touch-pad");
  bar.appendChild(group(groups.left, press));
  bar.appendChild(group(groups.right ?? [], press));
  frame.appendChild(bar);
}

function group(buttons: PadButton[], press: (code: string, down: boolean) => void): HTMLDivElement {
  const g = div("touch-pad-group");
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.className = "touch-pad-btn";
    btn.textContent = b.label;
    btn.setAttribute("aria-label", b.label);
    bindHold(btn, () => press(b.code, true), () => press(b.code, false));
    g.appendChild(btn);
  }
  return g;
}

function bindHold(el: HTMLElement, onDown: () => void, onUp: () => void): void {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    onDown();
  });
  el.addEventListener("pointerup", (e) => {
    e.preventDefault();
    onUp();
  });
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("pointerleave", onUp);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

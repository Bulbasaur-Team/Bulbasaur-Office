/** Замок и запрос пароля для комнат poker/retro. */

let wired = false;
let pending: ((password: string | null) => void) | null = null;

function dialogRoot(): HTMLElement {
  return document.getElementById("roomPassword")!;
}

function finish(password: string | null): void {
  dialogRoot().classList.add("hidden");
  const resolve = pending;
  pending = null;
  resolve?.(password);
}

function ensureDialog(): void {
  if (wired) return;
  wired = true;
  const root = dialogRoot();
  const form = document.getElementById("roomPasswordForm") as HTMLFormElement;
  const input = document.getElementById("roomPasswordInput") as HTMLInputElement;
  const error = document.getElementById("roomPasswordError")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!input.value.trim()) {
      error.textContent = "Введите пароль.";
      input.focus();
      return;
    }
    finish(input.value);
  });
  document.getElementById("roomPasswordCancel")!.addEventListener("click", () => finish(null));
  root.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.code === "Escape") finish(null);
  });
  root.addEventListener("click", (e) => {
    if (e.target === root) finish(null);
  });
}

export function isRoomPasswordDialogOpen(): boolean {
  return pending !== null;
}

export function cancelRoomPassword(): void {
  if (pending) finish(null);
}

/** null — игрок закрыл диалог. Строка может содержать пробелы по краям: их срежет сервер. */
export function askRoomPassword(): Promise<string | null> {
  ensureDialog();
  if (pending) finish(null);
  const root = dialogRoot();
  const input = document.getElementById("roomPasswordInput") as HTMLInputElement;
  const error = document.getElementById("roomPasswordError")!;
  input.value = "";
  error.textContent = "";
  root.classList.remove("hidden");
  input.focus();
  return new Promise((resolve) => {
    pending = resolve;
  });
}

function svgEl(name: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** granted — пароль уже введён: замок с зелёной галочкой. Иначе просто замок. */
export function setRoomTitle(title: HTMLElement, name: string, locked: boolean, granted = false): void {
  title.replaceChildren();
  if (locked) {
    const svg = svgEl("svg", {
      class: granted ? "room-lock is-granted" : "room-lock",
      viewBox: "0 0 30 24",
      "aria-hidden": "true",
    });
    svg.append(
      svgEl("rect", { x: "2.2", y: "11", width: "13", height: "9", rx: "1.5" }),
      svgEl("path", { d: "M5.2 11V8a4 4 0 0 1 8 0v3" }),
    );
    if (granted) {
      const check = "M16.4 15.4l2.8 3 6.4-7.2";
      svg.append(
        svgEl("path", { class: "room-lock-check-outline", d: check }),
        svgEl("path", { class: "room-lock-check", d: check }),
      );
    }
    title.append(svg);
  }
  title.append(document.createTextNode(name));
}

import { publicPath } from "../publicPath";
import type { PhoneCaller } from "./BulbaPhone";

const RING_MS = 30_000;

export interface IncomingCallPopupHandlers {
  onAccept: () => void;
  onDecline: () => void;
}

/** Неблокирующий попап входящего, в духе попапа ачивки. */
export class IncomingCallPopup {
  private root = document.getElementById("callPopup")!;
  private avatar = document.getElementById("callPopupAvatar") as HTMLImageElement;
  private nameEl = document.getElementById("callPopupName")!;
  private acceptBtn = document.getElementById("callPopupAccept")!;
  private declineBtn = document.getElementById("callPopupDecline")!;
  private timer = 0;
  isOpen = false;

  constructor(private handlers: IncomingCallPopupHandlers) {
    this.acceptBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.finish("accept");
    };
    this.declineBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.finish("decline");
    };
  }

  show(caller: PhoneCaller): void {
    this.hide();
    this.isOpen = true;
    const photo = caller.photo ? publicPath(caller.photo) : "";
    this.avatar.classList.toggle("hidden", !photo);
    if (photo) this.avatar.src = photo;
    this.nameEl.textContent = caller.name;
    this.root.classList.remove("hidden");
    this.root.classList.remove("call-popup-in");
    void this.root.offsetWidth;
    this.root.classList.add("call-popup-in");
    this.timer = window.setTimeout(() => this.finish("decline"), RING_MS);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.isOpen = false;
    this.root.classList.add("hidden");
    this.root.classList.remove("call-popup-in");
  }

  private finish(kind: "accept" | "decline"): void {
    if (!this.isOpen) return;
    this.hide();
    if (kind === "accept") this.handlers.onAccept();
    else this.handlers.onDecline();
  }
}

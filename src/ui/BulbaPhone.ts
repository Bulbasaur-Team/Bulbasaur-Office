import { publicPath } from "../publicPath";
import type { KeyConsumer } from "./KeyboardRouter";

export type PhoneMode = "incoming" | "call";

export interface PhoneCaller {
  name: string;
  photo: string;
}

interface BulbaPhoneHandlers {
  onAccept: () => void;
  onDecline: () => void;
  /** Крестик / сброс: входящий, активный звонок или экран «завершён». */
  onHangup: () => void;
}

/** iPhone-оверлей: входящий звонок и экран активного разговора. */
export class BulbaPhone implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("bulbaPhone")!;
  private incoming = document.getElementById("bpIncoming")!;
  private call = document.getElementById("bpCall")!;
  private incomingAvatar = document.getElementById("bpIncomingAvatar") as HTMLImageElement;
  private callAvatar = document.getElementById("bpCallAvatar") as HTMLImageElement;
  private incomingName = document.getElementById("bpIncomingName")!;
  private callName = document.getElementById("bpCallName")!;
  private endedSub = document.getElementById("bpEndedSub")!;

  constructor(private handlers: BulbaPhoneHandlers) {
    document.getElementById("bpAccept")!.onclick = () => this.handlers.onAccept();
    document.getElementById("bpDecline")!.onclick = () => this.handlers.onDecline();
    const closeBtn = document.getElementById("bulbaPhoneClose")!;
    closeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handlers.onHangup();
    };
    document.getElementById("bpHangup")!.onclick = () => this.handlers.onHangup();
  }

  setCaller(caller: PhoneCaller): void {
    const photo = publicPath(caller.photo);
    this.incomingAvatar.src = photo;
    this.callAvatar.src = photo;
    this.incomingName.textContent = caller.name;
    this.callName.textContent = caller.name;
    this.endedSub.textContent = `${caller.name} сбросил трубку`;
  }

  showIncoming(caller?: PhoneCaller): void {
    if (caller) this.setCaller(caller);
    this.isOpen = true;
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    this.incoming.classList.remove("hidden");
    this.call.classList.add("hidden");
    this.call.classList.remove("is-ended");
  }

  showCall(): void {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    this.incoming.classList.add("hidden");
    this.call.classList.remove("hidden");
    this.call.classList.remove("is-ended");
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add("hidden");
    this.root.setAttribute("aria-hidden", "true");
    this.incoming.classList.add("hidden");
    this.call.classList.add("hidden");
    this.call.classList.remove("is-ended");
  }

  mode(): PhoneMode | null {
    if (!this.isOpen) return null;
    return this.call.classList.contains("hidden") ? "incoming" : "call";
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (e.code === "Escape") {
      this.handlers.onHangup();
      return true;
    }
    return false;
  }
}

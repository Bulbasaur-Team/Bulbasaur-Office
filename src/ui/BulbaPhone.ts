import { publicPath } from "../publicPath";
import { backgroundMusic } from "./BackgroundMusic";
import type { KeyConsumer } from "./KeyboardRouter";

export type PhoneMode = "home" | "incoming" | "call";

export interface PhoneCaller {
  name: string;
  photo: string;
}

interface BulbaPhoneHandlers {
  onAccept: () => void;
  onDecline: () => void;
  /** Крестик / сброс: справочник, входящий, активный звонок или экран «завершён». */
  onHangup: () => void;
  /** С экрана «звонок завершён» — обратно в справочник. */
  onBackToContacts: () => void;
}

/** iPhone-оверлей: справочник, входящий и экран разговора. */
export class BulbaPhone implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("bulbaPhone")!;
  private home = document.getElementById("bpHome")!;
  private incoming = document.getElementById("bpIncoming")!;
  private call = document.getElementById("bpCall")!;
  private incomingAvatar = document.getElementById("bpIncomingAvatar") as HTMLImageElement;
  private callAvatar = document.getElementById("bpCallAvatar") as HTMLImageElement;
  private incomingName = document.getElementById("bpIncomingName")!;
  private callName = document.getElementById("bpCallName")!;
  private endedSub = document.getElementById("bpEndedSub")!;
  private dialing = document.getElementById("bpDialing")!;
  private sfxHint = document.getElementById("bpSfxHint")!;
  private current: PhoneMode | null = null;

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
    document.getElementById("bpBackToContacts")!.onclick = () => this.handlers.onBackToContacts();
    this.sfxHint.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      backgroundMusic.setSfxEnabled(true);
    };
    backgroundMusic.onSfxChange(() => this.syncSfxHint());
  }

  setCaller(caller: PhoneCaller): void {
    const photo = caller.photo ? publicPath(caller.photo) : "";
    this.incomingAvatar.classList.toggle("hidden", !photo);
    this.callAvatar.classList.toggle("hidden", !photo);
    if (photo) {
      this.incomingAvatar.src = photo;
      this.callAvatar.src = photo;
    }
    this.incomingName.textContent = caller.name;
    this.callName.textContent = caller.name;
    this.endedSub.textContent = `${caller.name} сбросил трубку`;
  }

  showHome(): void {
    this.isOpen = true;
    this.current = "home";
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    this.home.classList.remove("hidden");
    this.incoming.classList.add("hidden");
    this.call.classList.add("hidden");
    this.call.classList.remove("is-ended");
    this.showConnected();
    this.syncSfxHint();
  }

  showIncoming(caller?: PhoneCaller): void {
    if (caller) this.setCaller(caller);
    this.isOpen = true;
    this.current = "incoming";
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    this.home.classList.add("hidden");
    this.incoming.classList.remove("hidden");
    this.call.classList.add("hidden");
    this.call.classList.remove("is-ended");
    this.showConnected();
    this.syncSfxHint();
  }

  showCall(): void {
    this.isOpen = true;
    this.current = "call";
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    this.home.classList.add("hidden");
    this.incoming.classList.add("hidden");
    this.call.classList.remove("hidden");
    this.call.classList.remove("is-ended");
    this.showConnected();
    this.syncSfxHint();
  }

  showDialing(): void {
    this.dialing.classList.remove("hidden");
  }

  showConnected(): void {
    this.dialing.classList.add("hidden");
  }

  close(): void {
    this.isOpen = false;
    this.current = null;
    this.root.classList.add("hidden");
    this.root.setAttribute("aria-hidden", "true");
    this.home.classList.add("hidden");
    this.incoming.classList.add("hidden");
    this.call.classList.add("hidden");
    this.call.classList.remove("is-ended");
    this.showConnected();
    this.syncSfxHint();
  }

  mode(): PhoneMode | null {
    if (!this.isOpen) return null;
    return this.current;
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

  private syncSfxHint(): void {
    const duringCall = this.isOpen && (this.current === "call" || this.current === "incoming");
    const show = duringCall && !backgroundMusic.isSfxOn();
    this.sfxHint.classList.toggle("hidden", !show);
  }
}

import { nestedUrl } from "../embed";
import { publicPath } from "../publicPath";
import { spriteForRole } from "../data/roles";
import { SPRITE_FILES } from "../entities/sprites";
import { PACKAGE_WAYBILL_TEXT, matchesPackageFilePassword } from "../data/packageQuest";
import { isTouch } from "./TouchControls";

interface ComputerOpts {
  /** Показывать ярлык накладной (квест lost_package IN_PROGRESS). */
  showWaybill?: () => boolean;
  onWaybillUnlocked?: () => void;
}

// Компьютер в дата-центре: корпус с экраном, на экране — рабочий стол в духе Windows XP.
export class Computer {
  isOpen = false;

  private root = document.getElementById("computer")!;
  private shortcut = document.getElementById("xpShortcut")!;
  private waybillShortcut = document.getElementById("xpWaybillShortcut")!;
  private windowEl = document.getElementById("xpWindow")!;
  private windowBody = document.getElementById("xpWindowBody")!;
  private windowTitle = document.querySelector("#xpWindow .xp-titlebar-name") as HTMLElement;
  private notepad = document.getElementById("xpNotepad")!;
  private notepadBody = document.getElementById("xpNotepadBody")!;
  private passDlg = document.getElementById("xpPassDlg")!;
  private passInput = document.getElementById("xpPassInput") as HTMLInputElement;
  private passError = document.getElementById("xpPassError")!;
  private startMenu = document.getElementById("xpStartMenu")!;
  private clock = document.getElementById("xpClock")!;
  private frame: HTMLIFrameElement | null = null;
  private clockTimer = 0;
  private mode: "idle" | "office" | "pass" | "notepad" = "idle";

  constructor(private opts: ComputerOpts = {}) {
    const icon = document.getElementById("xpShortcutImg") as HTMLImageElement;
    icon.src = publicPath(`assets/${SPRITE_FILES[spriteForRole("")]}`);

    if (isTouch()) this.shortcut.onclick = () => this.launchOffice();
    else this.shortcut.ondblclick = () => this.launchOffice();

    if (isTouch()) this.waybillShortcut.onclick = () => this.openWaybill();
    else this.waybillShortcut.ondblclick = () => this.openWaybill();

    document.getElementById("xpWindowClose")!.onclick = () => this.closeApp();
    document.getElementById("xpNotepadClose")!.onclick = () => this.closeApp();
    document.getElementById("xpPassOk")!.onclick = () => this.submitPassword();
    document.getElementById("xpPassCancel")!.onclick = () => this.closePassDlg();
    this.passInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.submitPassword();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.closePassDlg();
      }
    });

    document.getElementById("xpStart")!.onclick = () => this.toggleStartMenu();
    document.getElementById("xpShutdown")!.onclick = () => this.close();
    document.getElementById("pcPower")!.onclick = () => this.close();
  }

  open(): void {
    this.isOpen = true;
    this.syncWaybillShortcut();
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    this.tickClock();
    this.clockTimer = window.setInterval(() => this.tickClock(), 30_000);
  }

  close(): void {
    this.isOpen = false;
    this.closeApp();
    this.closePassDlg();
    this.startMenu.classList.add("hidden");
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
    window.clearInterval(this.clockTimer);
  }

  syncWaybillShortcut(): void {
    const show = !!this.opts.showWaybill?.();
    this.waybillShortcut.classList.toggle("hidden", !show);
  }

  private launchOffice(): void {
    if (this.frame) return;
    this.closePassDlg();
    this.notepad.classList.add("hidden");
    this.mode = "office";
    this.windowTitle.textContent = "Bulba Office";
    this.frame = document.createElement("iframe");
    this.frame.className = "xp-frame";
    this.frame.setAttribute("allow", "");
    this.frame.src = nestedUrl();
    this.windowBody.replaceChildren(this.frame);
    this.windowEl.classList.remove("hidden");
    this.startMenu.classList.add("hidden");
  }

  private openWaybill(): void {
    if (!this.opts.showWaybill?.()) return;
    this.closeApp();
    this.mode = "pass";
    this.passError.textContent = "";
    this.passInput.value = "";
    this.passDlg.classList.remove("hidden");
    this.passInput.focus();
    this.startMenu.classList.add("hidden");
  }

  private submitPassword(): void {
    if (this.mode !== "pass") return;
    if (!matchesPackageFilePassword(this.passInput.value)) {
      this.passError.textContent = "Неверный пароль";
      this.passInput.select();
      return;
    }
    this.closePassDlg();
    this.showNotepad(PACKAGE_WAYBILL_TEXT);
    this.opts.onWaybillUnlocked?.();
  }

  private showNotepad(text: string): void {
    this.mode = "notepad";
    this.notepadBody.textContent = text;
    this.notepad.classList.remove("hidden");
  }

  private closePassDlg(): void {
    this.passDlg.classList.add("hidden");
    this.passInput.value = "";
    this.passError.textContent = "";
    if (this.mode === "pass") this.mode = "idle";
  }

  // Снести iframe / блокнот.
  private closeApp(): void {
    this.frame?.remove();
    this.frame = null;
    this.windowEl.classList.add("hidden");
    this.windowBody.replaceChildren();
    this.notepad.classList.add("hidden");
    this.mode = "idle";
  }

  private toggleStartMenu(): void {
    this.startMenu.classList.toggle("hidden");
  }

  private tickClock(): void {
    this.clock.textContent = new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (this.mode === "pass") {
        this.closePassDlg();
        return;
      }
      if (this.mode === "notepad" || this.mode === "office") {
        this.closeApp();
        return;
      }
      this.close();
    }
  };
}

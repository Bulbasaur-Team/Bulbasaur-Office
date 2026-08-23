import {
  ALERT_ACCEPT_ANSWER,
  ALERT_ACCEPT_PROMPT,
  ALERT_COLORS,
  ALERT_GREEN_HEX,
  ALERT_HELP_ANSWER,
  ALERT_HELP_PROMPT,
  ALERT_NOT_GREEN,
  ALERT_QUEST,
  ALERT_RED_HEX,
  ALERT_SCREEN_ANSWER,
  ALERT_SCREEN_PROMPT,
  ALERT_SHOW_PROMPT,
  ALERT_SUCCESS,
  ALERT_WORK_PROMPT,
  alertGreeting,
  isAlertGreen,
} from "../data/alertQuest";
import { typeWithVoice } from "./CharacterVoice";
import { dialTone } from "./DialTone";

const CHAR_DELAY = Math.round(22 * 2.5);
const AFTER_PLAYER_MS = 400;
const LINE_HOLD_MS = ALERT_QUEST.timings.lineHoldMs;
const HANGUP_HOLD_MS = 1_000;

export interface AlertQuestCallHandlers {
  onBriefingAccepted: () => void;
  onBriefingComplete: () => void;
  onBriefingAbort: () => void;
  onWorkRemoteHangup: () => void;
  onWorkAbort: () => void;
  onSubmitGreen: () => Promise<boolean>;
  onQuestCompleted: () => void;
  onDismissEnded: () => void;
}

/** Звонок техлида: скрин в модалке, заливка графика, «показать начальнику». */
export class AlertQuestCall {
  private callEl = document.getElementById("bpCall")!;
  private bubble = document.getElementById("bpBubble")!;
  private bubbleText = document.getElementById("bpBubbleText")!;
  private playerLine = document.getElementById("bpPlayerLine")!;
  private repliesEl = document.getElementById("bpReplies")!;
  private wrapEl = document.getElementById("bpAlertWrap")!;
  private openBtn = document.getElementById("bpAlertOpen") as HTMLButtonElement;
  private thumb = document.getElementById("bpAlertThumb") as HTMLCanvasElement;
  private thumbCtx = this.thumb.getContext("2d")!;
  private modal = document.getElementById("alertShotModal")!;
  private box = document.getElementById("alertShotBox")!;
  private canvas = document.getElementById("alertShotCanvas") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;
  private fillBtn = document.getElementById("alertShotFill") as HTMLButtonElement;
  private colorsEl = document.getElementById("alertShotColors")!;
  private sendBtn = document.getElementById("alertShotSend") as HTMLButtonElement;

  private mode: "idle" | "briefing" | "work" | "ended" = "idle";
  private askedHelp = false;
  private askedScreen = false;
  private cancelTyping: (() => void) | null = null;
  private lineTimer = 0;
  private token = 0;
  private briefingAccepted = false;
  private fillOn = false;
  private pickedHex: string | null = null;
  private fillHex = ALERT_RED_HEX;
  private showing = false;
  private modalOpen = false;

  constructor(private handlers: AlertQuestCallHandlers) {
    this.openBtn.onclick = () => this.openModal();
    document.getElementById("alertShotClose")!.onclick = () => this.closeModal();
    this.modal.addEventListener("click", () => this.closeModal());
    this.box.addEventListener("click", (e) => e.stopPropagation());
    this.fillBtn.onclick = () => this.toggleFill();
    this.sendBtn.onclick = () => void this.showToBoss();
    this.canvas.addEventListener("pointerdown", (e) => this.onCanvasPointer(e));
    this.renderColors();
  }

  get isBusy(): boolean {
    return this.mode !== "idle";
  }

  get isEnded(): boolean {
    return this.mode === "ended";
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.modalOpen) return false;
    if (e.code === "Escape") this.closeModal();
    return true;
  }

  startBriefing(playerName: string): void {
    this.resetUi();
    this.fillHex = ALERT_RED_HEX;
    this.mode = "briefing";
    this.askedHelp = false;
    this.askedScreen = false;
    this.briefingAccepted = false;
    this.say(alertGreeting(playerName), () => this.showBriefingReplies(), { awaitReply: true });
  }

  startWork(): void {
    this.resetUi();
    this.mode = "work";
    this.showThumb();
    this.say(ALERT_WORK_PROMPT, () => this.showShowButton(), { awaitReply: true });
  }

  hangupByPlayer(): void {
    if (this.mode === "ended") {
      this.dismissEnded();
      return;
    }
    if (this.mode === "briefing") {
      const accepted = this.briefingAccepted;
      this.stop();
      if (accepted) this.handlers.onBriefingComplete();
      else this.handlers.onBriefingAbort();
      return;
    }
    if (this.mode === "work") {
      this.stop();
      this.handlers.onWorkAbort();
    }
  }

  dismissEnded(): void {
    if (this.mode !== "ended") return;
    this.stop();
    this.handlers.onDismissEnded();
  }

  stop(): void {
    this.token++;
    window.clearTimeout(this.lineTimer);
    this.cancelTyping?.();
    this.cancelTyping = null;
    this.mode = "idle";
    this.briefingAccepted = false;
    this.showing = false;
    this.resetUi();
  }

  private resetUi(): void {
    this.callEl.classList.remove("is-ended", "has-alert");
    this.hideBubble();
    this.playerLine.textContent = "";
    this.hideReplies();
    this.hideThumb();
    this.closeModal();
    this.fillOn = false;
    this.pickedHex = null;
    this.syncFillUi();
    this.refreshColorSel();
    document.getElementById("bpPinWrap")?.classList.add("hidden");
  }

  private enterEnded(from: "briefing" | "work" | "completed"): void {
    this.token++;
    window.clearTimeout(this.lineTimer);
    this.cancelTyping?.();
    this.cancelTyping = null;
    this.showing = false;
    this.hideReplies();
    this.hideThumb();
    this.closeModal();
    this.playerLine.textContent = "";
    this.mode = "ended";
    this.callEl.classList.add("is-ended");
    this.callEl.classList.remove("has-alert");
    dialTone.playHangup();

    if (from === "briefing") this.handlers.onBriefingComplete();
    else if (from === "completed") this.handlers.onQuestCompleted();
    else this.handlers.onWorkRemoteHangup();
  }

  private showBriefingReplies(): void {
    if (this.mode !== "briefing") return;
    this.repliesEl.replaceChildren();
    if (!this.askedHelp) {
      this.addReply(ALERT_HELP_PROMPT, () => this.askHelp());
    }
    if (!this.askedScreen) {
      this.addReply(ALERT_SCREEN_PROMPT, () => this.askScreen());
    }
    if (this.askedScreen) {
      this.addReply(ALERT_ACCEPT_PROMPT, () => this.acceptBriefing());
    }
    this.repliesEl.classList.remove("hidden");
  }

  private addReply(label: string, onClick: () => void): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bp-reply";
    btn.textContent = label;
    btn.onclick = onClick;
    this.repliesEl.appendChild(btn);
  }

  private askHelp(): void {
    if (this.mode !== "briefing") return;
    this.hideReplies();
    this.askedHelp = true;
    this.playerLine.textContent = ALERT_HELP_PROMPT;
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      this.say(ALERT_HELP_ANSWER, () => this.showBriefingReplies(), { awaitReply: true });
    }, AFTER_PLAYER_MS);
  }

  private askScreen(): void {
    if (this.mode !== "briefing") return;
    this.hideReplies();
    this.askedScreen = true;
    this.playerLine.textContent = ALERT_SCREEN_PROMPT;
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      this.showThumb();
      this.say(ALERT_SCREEN_ANSWER, () => this.showBriefingReplies(), { awaitReply: true });
    }, AFTER_PLAYER_MS);
  }

  private acceptBriefing(): void {
    if (this.mode !== "briefing") return;
    this.hideReplies();
    this.playerLine.textContent = ALERT_ACCEPT_PROMPT;
    this.briefingAccepted = true;
    this.handlers.onBriefingAccepted();
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      this.mode = "work";
      this.showThumb();
      this.syncSend();
      this.say(ALERT_ACCEPT_ANSWER, () => this.showShowButton(), { awaitReply: true });
    }, AFTER_PLAYER_MS);
  }

  private showShowButton(): void {
    if (this.mode !== "work") return;
    this.syncSend();
    this.repliesEl.replaceChildren();
    this.addReply(ALERT_SHOW_PROMPT, () => void this.showToBoss());
    this.repliesEl.classList.remove("hidden");
  }

  private async showToBoss(): Promise<void> {
    if (this.mode !== "work" || this.showing) return;
    this.showing = true;
    this.closeModal();
    this.hideReplies();
    this.syncSend();
    this.playerLine.textContent = ALERT_SHOW_PROMPT;
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      void this.afterShow();
    }, AFTER_PLAYER_MS);
  }

  private async afterShow(): Promise<void> {
    if (this.mode !== "work") return;
    if (!isAlertGreen(this.fillHex)) {
      this.showing = false;
      this.say(ALERT_NOT_GREEN, () => this.showShowButton(), { awaitReply: true });
      return;
    }
    const ok = await this.handlers.onSubmitGreen();
    if (this.mode !== "work") return;
    if (!ok) {
      this.showing = false;
      this.say(ALERT_NOT_GREEN, () => this.showShowButton(), { awaitReply: true });
      return;
    }
    this.say(ALERT_SUCCESS, () => this.enterEnded("completed"), { hangup: true });
  }

  private toggleFill(): void {
    if (!this.modalOpen) return;
    this.fillOn = !this.fillOn;
    this.syncFillUi();
  }

  private syncFillUi(): void {
    this.fillBtn.classList.toggle("sel", this.fillOn);
    this.canvas.classList.toggle("is-fill", this.fillOn);
    this.colorsEl.classList.toggle("hidden", !this.fillOn);
  }

  private pickColor(hex: string): void {
    if (!this.modalOpen) return;
    this.pickedHex = hex;
    this.refreshColorSel();
  }

  private onCanvasPointer(e: PointerEvent): void {
    if (!this.modalOpen || !this.fillOn || !this.pickedHex) return;
    e.preventDefault();
    this.fillHex = this.pickedHex;
    this.drawAll();
  }

  private openModal(): void {
    if (this.wrapEl.classList.contains("hidden")) return;
    this.modalOpen = true;
    this.modal.classList.remove("hidden");
    this.syncSend();
    this.syncFillUi();
    this.refreshColorSel();
    this.layoutAndDraw(this.canvas, this.ctx);
    requestAnimationFrame(() => this.layoutAndDraw(this.canvas, this.ctx));
  }

  private closeModal(): void {
    this.modalOpen = false;
    this.modal.classList.add("hidden");
    this.canvas.classList.remove("is-fill");
  }

  private syncSend(): void {
    this.sendBtn.classList.toggle("hidden", this.mode !== "work" || this.showing);
  }

  private showThumb(): void {
    this.callEl.classList.add("has-alert");
    this.wrapEl.classList.remove("hidden");
    this.syncSend();
    this.layoutAndDraw(this.thumb, this.thumbCtx);
    requestAnimationFrame(() => this.layoutAndDraw(this.thumb, this.thumbCtx));
  }

  private hideThumb(): void {
    this.wrapEl.classList.add("hidden");
    this.callEl.classList.remove("has-alert");
  }

  private drawAll(): void {
    this.layoutAndDraw(this.thumb, this.thumbCtx);
    if (this.modalOpen) this.layoutAndDraw(this.canvas, this.ctx);
  }

  private renderColors(): void {
    this.colorsEl.replaceChildren();
    for (const color of ALERT_COLORS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "alert-shot-swatch";
      btn.style.background = color.hex;
      btn.title = color.label;
      btn.setAttribute("aria-label", color.label);
      btn.onclick = () => this.pickColor(color.hex);
      this.colorsEl.appendChild(btn);
    }
    this.refreshColorSel();
  }

  private refreshColorSel(): void {
    [...this.colorsEl.children].forEach((el, i) => {
      const color = ALERT_COLORS[i];
      el.classList.toggle("sel", !!color && color.hex === this.pickedHex);
    });
  }

  private layoutAndDraw(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    const fallbackH = canvas === this.thumb ? 88 : 320;
    const w = Math.max(180, Math.floor(canvas.clientWidth || this.wrapEl.clientWidth || 280));
    const h = Math.max(80, Math.floor(canvas.clientHeight || fallbackH));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawChart(ctx, w, h);
  }

  private drawChart(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#141820";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#1c222c";
    ctx.fillRect(8, 8, w - 16, h - 16);

    const titleSize = h < 120 ? 10 : 13;
    ctx.fillStyle = "#e8edf4";
    ctx.font = `bold ${titleSize}px Trebuchet MS, sans-serif`;
    ctx.fillText("prod / error_rate", 16, Math.round(h * 0.16));

    const badge = this.fillHex === ALERT_GREEN_HEX ? "OK" : "ALERT";
    ctx.font = `bold ${Math.max(9, titleSize - 1)}px Trebuchet MS, sans-serif`;
    const bw = ctx.measureText(badge).width + 12;
    const badgeY = 12;
    ctx.fillStyle = this.fillHex;
    ctx.fillRect(w - 16 - bw, badgeY, bw, 16);
    ctx.fillStyle = "#141820";
    ctx.fillText(badge, w - 16 - bw + 6, badgeY + 12);

    const left = 28;
    const right = w - 18;
    const top = Math.round(h * 0.26);
    const bottom = h - 22;

    ctx.strokeStyle = "#2c3340";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = top + ((bottom - top) * i) / 3;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    const points: { x: number; y: number }[] = [];
    const n = 18;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = left + (right - left) * t;
      const rise = t * t;
      const wobble = Math.sin(t * 9.5) * 0.04;
      const y = bottom - (bottom - top) * Math.min(0.92, 0.12 + rise * 0.82 + wobble);
      points.push({ x, y });
    }

    ctx.beginPath();
    ctx.moveTo(points[0]!.x, bottom);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.lineTo(points[points.length - 1]!.x, bottom);
    ctx.closePath();
    ctx.fillStyle = this.hexAlpha(this.fillHex, 0.38);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
    ctx.strokeStyle = this.fillHex;
    ctx.lineWidth = h < 120 ? 2 : 2.8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.fillStyle = "#8b95a5";
    ctx.font = "9px Trebuchet MS, sans-serif";
    ctx.fillText("15:00", left, h - 8);
    ctx.fillText("сейчас", right - 32, h - 8);
  }

  private hexAlpha(hex: string, alpha: number): string {
    const n = hex.replace("#", "");
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private say(text: string, onDone: () => void, opts?: { awaitReply?: boolean; hangup?: boolean }): void {
    const token = ++this.token;
    this.cancelTyping?.();
    this.bubble.classList.remove("hidden");
    this.cancelTyping = typeWithVoice(
      this.bubbleText,
      text,
      "bulbatech",
      () => {
        this.cancelTyping = null;
        if (token !== this.token) return;
        if (opts?.awaitReply) {
          onDone();
          return;
        }
        this.lineTimer = window.setTimeout(() => {
          if (token !== this.token) return;
          onDone();
        }, opts?.hangup ? HANGUP_HOLD_MS : LINE_HOLD_MS);
      },
      CHAR_DELAY,
    );
  }

  private hideBubble(): void {
    this.bubble.classList.add("hidden");
    this.bubbleText.textContent = "";
  }

  private hideReplies(): void {
    this.repliesEl.classList.add("hidden");
    this.repliesEl.replaceChildren();
  }
}

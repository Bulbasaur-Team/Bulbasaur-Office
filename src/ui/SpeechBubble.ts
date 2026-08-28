import Phaser from "phaser";
import { meowify } from "../data/bulbaCat";
import { VOICES, type VoiceId } from "../data/voices";
import { characterVoice, pauseAfterChar } from "./CharacterVoice";
import { gamePointToViewport } from "./gameViewport";

const CHAR_DELAY = 25;
const TAIL_H = 12;

export class SpeechBubble {
  private root: HTMLDivElement;
  private textEl: HTMLDivElement;
  private translateBtn: HTMLButtonElement;
  private timer?: Phaser.Time.TimerEvent;
  private hideTimer?: Phaser.Time.TimerEvent;
  private follow?: () => { x: number; y: number };
  private russianText = "";
  private translated = false;
  private catMode = false;
  private murmuring = false;

  constructor(private scene: Phaser.Scene) {
    this.root = document.createElement("div");
    this.root.className = "npc-speech hidden";
    this.root.setAttribute("aria-live", "polite");
    this.textEl = document.createElement("div");
    this.textEl.className = "npc-speech-text";
    this.root.appendChild(this.textEl);

    this.translateBtn = document.createElement("button");
    this.translateBtn.type = "button";
    this.translateBtn.className = "cat-translate hidden";
    this.translateBtn.textContent = "Перевести";
    this.translateBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onTranslateClick();
    });

    const host = document.getElementById("stage") ?? document.body;
    host.appendChild(this.root);
    host.appendChild(this.translateBtn);
  }

  show(fullText: string, x: number, y: number, autoHideMs?: number, follow?: () => { x: number; y: number }, fontSize = 14, voice?: VoiceId): void {
    this.catMode = false;
    this.russianText = "";
    this.translated = false;
    this.hideTranslateBtn();
    this.startType(fullText, x, y, autoHideMs, follow, fontSize, voice);
  }

  /** Реплика кота: печатает мяуканье; «Перевести» сразу над облачком, один раз. */
  showCat(russian: string, x: number, y: number, follow?: () => { x: number; y: number }): void {
    this.catMode = true;
    this.russianText = russian;
    this.translated = false;
    this.translateBtn.textContent = "Перевести";
    this.translateBtn.disabled = false;
    this.startType(meowify(russian), x, y, undefined, follow, 14, "cat");
    this.translateBtn.classList.remove("hidden");
    this.positionTranslateBtn();
  }

  update(): void {
    if (this.follow && !this.root.classList.contains("hidden")) {
      const p = this.follow();
      this.place(p.x, p.y);
    }
    if (this.catMode && !this.root.classList.contains("hidden") && !this.translateBtn.classList.contains("hidden")) {
      this.positionTranslateBtn();
    }
  }

  hide(): void {
    this.stopMurmur();
    this.timer?.remove();
    this.hideTimer?.remove();
    this.follow = undefined;
    this.catMode = false;
    this.russianText = "";
    this.translated = false;
    this.hideTranslateBtn();
    this.root.classList.add("hidden");
    this.textEl.textContent = "";
  }

  destroy(): void {
    this.stopMurmur();
    this.timer?.remove();
    this.hideTimer?.remove();
    this.translateBtn.remove();
    this.root.remove();
  }

  private startType(
    fullText: string,
    x: number,
    y: number,
    autoHideMs: number | undefined,
    follow: (() => { x: number; y: number }) | undefined,
    fontSize: number,
    voice?: VoiceId,
  ): void {
    this.timer?.remove();
    this.hideTimer?.remove();
    this.follow = follow;
    this.textEl.style.fontSize = `${fontSize}px`;
    this.place(x, y);
    this.root.classList.remove("hidden");
    this.textEl.textContent = "";

    let shown = 0;
    this.startMurmur(voice);
    const intervalMs = voice ? VOICES[voice].intervalMs : 100;
    const typeNext = (): void => {
      if (this.translated) {
        this.stopMurmur();
        return;
      }
      shown++;
      const ch = fullText[shown - 1] ?? "";
      this.textEl.textContent = fullText.slice(0, shown);
      if (voice) characterVoice.tick(ch);
      if (shown >= fullText.length) {
        this.stopMurmur();
        if (autoHideMs != null) this.hideTimer = this.scene.time.delayedCall(autoHideMs, () => this.hide());
        return;
      }
      const wait = voice
        ? pauseAfterChar(fullText, shown - 1, CHAR_DELAY, intervalMs, voice)
        : CHAR_DELAY;
      this.timer = this.scene.time.delayedCall(wait, typeNext);
    };
    this.timer = this.scene.time.delayedCall(0, typeNext);
  }

  private startMurmur(voice?: VoiceId): void {
    this.stopMurmur();
    if (!voice) return;
    this.murmuring = true;
    characterVoice.speak(voice);
  }

  private stopMurmur(): void {
    if (!this.murmuring) return;
    this.murmuring = false;
    characterVoice.stop();
  }

  canTranslate(): boolean {
    return this.catMode && !!this.russianText && !this.translated
      && !this.translateBtn.classList.contains("hidden");
  }

  tryTranslate(): boolean {
    if (!this.canTranslate()) return false;
    this.translated = true;
    this.stopMurmur();
    this.timer?.remove();
    this.textEl.textContent = this.russianText;
    this.hideTranslateBtn();
    if (this.follow) {
      const p = this.follow();
      this.place(p.x, p.y);
    }
    return true;
  }

  private onTranslateClick(): void {
    this.tryTranslate();
  }

  private positionTranslateBtn(): void {
    const box = this.root.getBoundingClientRect();
    this.translateBtn.style.left = `${box.left + box.width / 2}px`;
    this.translateBtn.style.top = `${box.top}px`;
  }

  private hideTranslateBtn(): void {
    this.translateBtn.classList.add("hidden");
  }

  private place(x: number, y: number): void {
    const canvas = this.scene.game.canvas;
    if (!canvas) return;
    const p = gamePointToViewport(x, y, canvas);
    this.root.style.left = `${p.left}px`;
    this.root.style.top = `${p.top}px`;
    this.root.style.transform = `translate(-50%, calc(-100% - ${TAIL_H}px))`;
  }
}

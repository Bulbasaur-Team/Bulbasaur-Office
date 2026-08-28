import * as api from "../net/api";
import { DAY_X_QUEST, type DayXBubbleId } from "../data/dayXQuest";
import {
  DAY_X_CLOSING,
  DAY_X_CLOSING_FAIL,
  DAY_X_GREETINGS,
  DAY_X_QUESTIONS,
  DAY_X_WARDROBE,
  DAY_X_WRONG_DECK_AFTER,
  DAY_X_WRONG_DECK_BOSS_RANT,
  DAY_X_WRONG_DECK_COMMENTS,
  DAY_X_WRONG_DECK_SILENCE,
  slideScript,
  type DayXLine,
  type DayXReply,
} from "../data/dayXScripts";
import { dayXWardrobeComment } from "../data/dayXWardrobe";
import { SLIDE_IDS, slideAsset, type SlideId } from "../data/presentationSlides";
import { defaultAppearance, type PlayerAppearance } from "../data/wardrobe";
import { isPunctuationOnly, typeText, typeWithVoice } from "./CharacterVoice";
import { GAME_H, GAME_W, gamePointToViewport, gameRectToViewport, gameViewport } from "./gameViewport";
import { publicPath } from "../publicPath";
import { stage } from "./orientation";
import type { VoiceId } from "../data/voices";
import type { KeyConsumer } from "./KeyboardRouter";
import type { Rect } from "../scenes/LocationLoader";

export interface DayXLayout {
  bubbles: Partial<Record<DayXBubbleId, { x: number; y: number }>>;
}

export interface DayXHallOpts {
  login: () => string;
  appearance: () => PlayerAppearance;
  playerVoice: () => VoiceId;
  projectorRect: () => Rect | null;
  onWatching: (watching: boolean) => void;
  onFinished: () => Promise<void>;
}

type Phase =
  | "intro"
  | "greeting"
  | "wardrobe"
  | "desktop"
  | "wrongDeck"
  | "presentation"
  | "thanks"
  | "qa"
  | "closing"
  | "congrats"
  | "failed";

const BUBBLE_CHAR_MS = Math.round(22 * 2.5);
const CHOICE_CHAR_MS = 22;
const LINE_HOLD_MS = 700;
const PARALLEL_HOLD_MS = 3000;
const WRONG_DECK_INITIAL_PAUSE_MS = 3000;
const PARALLEL_STAGGER_MS = 130;
const MODAL_DELAY_MS = 3000;
const CONFETTI_COLORS = ["#f94144", "#f8961e", "#f9c74f", "#90be6d", "#43aa8b", "#577590", "#ff70a6"];

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
}

function shuffleReplies(replies: DayXReply[]): DayXReply[] {
  const out = replies.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

const DAY_X_VOICES: Record<DayXLine["speaker"], VoiceId> = {
  bulbov: "bulbov",
  boss1: "bulbov",
  boss2: "bulbikov",
  boss3: "bulbul",
  boss4: "bulbatech",
  inv1: "driver",
  inv2: "bulbikov",
  inv3: "egor",
};

const PROJECTOR_FALLBACK: Rect = { x: 347, y: 78, w: 705, h: 285 };

const OVERLAY_SRC = {
  normal: () => publicPath("assets/locations/day-x-hall/overlay.png"),
  watching: () => publicPath("assets/locations/day-x-hall/overlay-watching.png"),
};

function bubbleAnchor(line: DayXLine): DayXBubbleId {
  return line.speaker === "bulbov" ? "boss1" : line.speaker;
}

/** Сцена «День X» в конференц-зале: диалоги, проектор, Q&A. */
export class DayXHall implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("dayXHall")!;
  private projectorEl = document.getElementById("dayXProjector") as HTMLDivElement;
  private projectorMedia = document.getElementById("dayXProjectorMedia") as HTMLDivElement;
  private overlayEl = document.getElementById("dayXOverlay") as HTMLImageElement;
  private meterEl = document.getElementById("dayXInvestorMeter")!;
  private meterFillEl = document.getElementById("dayXMeterFill")!;
  private meterValueEl = document.getElementById("dayXMeterValue")!;
  private bubbleLayer = document.getElementById("dayXBubbles")!;
  private dialogueEl = document.getElementById("dayXDialogue")!;
  private optionsEl = document.getElementById("dayXDlgOptions")!;
  private congratsEl = document.getElementById("dayXCongrats")!;
  private failEl = document.getElementById("dayXFail")!;
  private confetti = document.getElementById("dayXConfetti") as HTMLCanvasElement;
  private confettiCtx = this.confetti.getContext("2d")!;
  private desktopEl = document.getElementById("dayXDesktop")!;
  private explorerEl = document.getElementById("dayXExplorer")!;
  private winClockEl = document.getElementById("dayXWinClock")!;

  private layout: DayXLayout | null = null;
  private opts: DayXHallOpts | null = null;
  private phase: Phase = "intro";
  private deck: SlideId[] = [];
  private slideIndex = 0;
  private wrongBlocked = false;
  private qaIndex = 0;
  private satisfaction = DAY_X_QUEST.investorSatisfaction.initial;
  private autoTimer = 0;
  private lineTimer = 0;
  private staggerTimers: number[] = [];
  private started = false;
  private cancelTyping: (() => void) | null = null;
  private choiceIndex = 0;
  private choiceReplies: DayXReply[] = [];
  private onChoicePick: ((reply: DayXReply) => void) | null = null;
  private confettiParticles: ConfettiParticle[] = [];
  private confettiRaf = 0;
  private confettiLast = 0;
  private onResize = () => this.relayout();

  constructor() {
    document.getElementById("dayXCongratsOk")!.onclick = () => void this.afterCongrats();
    document.getElementById("dayXFailRetry")!.onclick = () => this.retryFromIntro();
    document.getElementById("dayXDesktopWrong")!.onclick = () => this.openDeck("wrong");
    document.getElementById("dayXDesktopFolderBtn")!.onclick = () => this.openExplorer();
    document.getElementById("dayXDesktopRightInFolder")!.onclick = () => this.openDeck("right");
    document.getElementById("dayXExplorerClose")!.onclick = () => this.closeExplorer();
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (this.phase === "congrats" && (e.code === "Enter" || e.code === "Space")) {
      void this.afterCongrats();
      return true;
    }
    if (!this.choiceReplies.length) return false;
    const n = this.choiceReplies.length;
    const left = e.code === "ArrowLeft" || e.code === "KeyA";
    const right = e.code === "ArrowRight" || e.code === "KeyD";
    if (left) {
      this.choiceIndex = (this.choiceIndex + n - 1) % n;
      this.refreshChoiceSel();
      return true;
    }
    if (right) {
      this.choiceIndex = (this.choiceIndex + 1) % n;
      this.refreshChoiceSel();
      return true;
    }
    if (e.code === "Enter" || e.code === "Space") {
      this.pickChoice(this.choiceIndex);
      return true;
    }
    return false;
  }

  async begin(layout: DayXLayout, opts: DayXHallOpts): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.layout = layout;
    this.opts = opts;
    this.isOpen = true;
    this.root.classList.remove("hidden");
    this.congratsEl.classList.add("hidden");
    this.failEl.classList.add("hidden");
    this.desktopEl.classList.add("hidden");
    this.hideInvestorMeter();
    this.satisfaction = DAY_X_QUEST.investorSatisfaction.initial;
    this.hideChoices();
    this.clearProjector();
    this.setWatching(false);
    this.overlayEl.classList.remove("hidden");
    this.layoutOverlay();
    window.addEventListener("resize", this.onResize);

    try {
      const deckRes = await api.fetchPresentationDeck();
      const ids = deckRes.slideIds.filter((id): id is SlideId => SLIDE_IDS.includes(id as SlideId));
      this.deck = ids.length > 0 ? ids : (["pain", "miracle", "ai", "ask"] as SlideId[]);
    } catch {
      this.deck = ["pain", "miracle", "ai", "ask"] as SlideId[];
    }

    this.runIntro();
  }

  stop(): void {
    window.removeEventListener("resize", this.onResize);
    this.stopTyping();
    window.clearTimeout(this.autoTimer);
    window.clearTimeout(this.lineTimer);
    this.autoTimer = 0;
    this.lineTimer = 0;
    this.started = false;
    this.isOpen = false;
    this.phase = "intro";
    this.root.classList.add("hidden");
    this.bubbleLayer.replaceChildren();
    this.hideChoices();
    this.hideInvestorMeter();
    this.stopConfetti();
    this.failEl.classList.add("hidden");
    this.clearProjector();
    this.overlayEl.classList.add("hidden");
    this.setWatching(false);
    this.opts = null;
    this.layout = null;
  }

  private runIntro(): void {
    this.phase = "intro";
    this.queueLines(
      [{
        speaker: "bulbov",
        text: `Господа инвесторы, это ${this.name()} — наш самый перспективный сотрудник. Сегодня он проведет для вас презентацию.`,
      }],
      () => this.showChoices(DAY_X_GREETINGS, (reply) => {
        this.speakPlayer(reply.full, () => this.afterGreeting());
      }),
    );
  }

  private afterGreeting(): void {
    this.phase = "greeting";
    this.queueLines(
      [
        { speaker: "inv1", text: "Добрый день!" },
        { speaker: "inv2", text: "Рады знакомству." },
        { speaker: "inv3", text: "Начинайте, мы слушаем." },
      ],
      () => this.runWardrobe(),
    );
  }

  private runWardrobe(): void {
    this.phase = "wardrobe";
    const kind = dayXWardrobeComment(this.opts?.appearance() ?? defaultAppearance());
    this.queueLines(DAY_X_WARDROBE[kind], () => this.runDesktopPrompt());
  }

  private runDesktopPrompt(): void {
    this.phase = "desktop";
    this.queueLines(
      [
        { speaker: "bulbov", text: "Включай компьютер. Там файл с презентацией." },
        { speaker: "bulbov", text: "Открывай презентацию и приступай к докладу." },
      ],
      () => this.showDesktop(),
    );
  }

  private showDesktop(): void {
    this.updateWinClock();
    this.closeExplorer();
    this.desktopEl.classList.remove("hidden");
    const wrongBtn = document.getElementById("dayXDesktopWrong") as HTMLButtonElement;
    wrongBtn.disabled = this.wrongBlocked;
    wrongBtn.classList.toggle("hidden", this.wrongBlocked);
  }

  private openExplorer(): void {
    this.explorerEl.classList.remove("hidden");
  }

  private closeExplorer(): void {
    this.explorerEl.classList.add("hidden");
  }

  private updateWinClock(): void {
    const now = new Date();
    this.winClockEl.textContent = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  private openDeck(which: "wrong" | "right"): void {
    if (which === "wrong" && this.wrongBlocked) return;
    this.desktopEl.classList.add("hidden");
    this.closeExplorer();
    if (which === "wrong") {
      this.wrongBlocked = true;
      this.phase = "wrongDeck";
      this.setWatching(true);
      this.showSlide("diy", "history");
      this.scheduleAfter(WRONG_DECK_INITIAL_PAUSE_MS, () => {
        this.showStaggeredBubbles(DAY_X_WRONG_DECK_SILENCE, () => {
          this.showStaggeredBubbles(DAY_X_WRONG_DECK_BOSS_RANT, () => {
            this.bubbleLayer.replaceChildren();
            this.queueLines(DAY_X_WRONG_DECK_COMMENTS, () => {
              this.queueLines(DAY_X_WRONG_DECK_AFTER, () => {
                this.clearProjector();
                this.setWatching(false);
                this.showDesktop();
              });
            });
          }, "replace");
        }, "new");
      });
      return;
    }
    this.phase = "presentation";
    this.slideIndex = 0;
    this.qaIndex = 0;
    this.satisfaction = DAY_X_QUEST.investorSatisfaction.initial;
    this.showInvestorMeter();
    this.setWatching(true);
    this.showCurrentSlide();
  }

  private showCurrentSlide(): void {
    if (this.slideIndex >= this.deck.length) {
      this.finishPresentation();
      return;
    }
    const id = this.deck[this.slideIndex]!;
    this.showSlide("claude", id);
    const script = slideScript(id);
    this.showChoices(script.replies, (reply) => {
      this.applyReplyTone(reply.tone);
      this.speakPlayer(reply.full, () => {
        const extras = reply.tone === "bad" ? script.reactions.bad : script.reactions.good;
        this.queueLines(extras, () => {
          this.autoTimer = window.setTimeout(() => {
            this.slideIndex += 1;
            this.showCurrentSlide();
          }, DAY_X_QUEST.timings.autoAdvanceMs);
        });
      });
    });
  }

  private finishPresentation(): void {
    this.setWatching(false);
    this.phase = "thanks";
    this.queueLines(
      [{ speaker: "bulbov", text: "Спасибо за презентацию. Есть ли вопросы?" }],
      () => this.runQa(),
    );
  }

  private runQa(): void {
    this.phase = "qa";
    this.qaIndex = 0;
    this.askNextQuestion();
  }

  private askNextQuestion(): void {
    const q = DAY_X_QUESTIONS[this.qaIndex];
    if (!q) {
      this.runClosing();
      return;
    }
    this.queueLines([q.ask], () => {
      this.showChoices(q.replies, (reply) => {
        this.applyReplyTone(reply.tone);
        this.speakPlayer(reply.full, () => {
          const answerText = reply.tone === "bad" ? q.answerBad : q.answerGood;
          this.queueLines([{ speaker: q.ask.speaker, text: answerText }], () => {
            this.qaIndex += 1;
            this.askNextQuestion();
          });
        });
      });
    });
  }

  private runClosing(): void {
    this.phase = "closing";
    this.hideInvestorMeter();
    const success = this.satisfaction >= DAY_X_QUEST.investorSatisfaction.success;
    this.queueLines(success ? DAY_X_CLOSING : DAY_X_CLOSING_FAIL, () => {
      this.scheduleAfter(MODAL_DELAY_MS, () => {
        if (success) this.showCongrats();
        else this.showFail();
      });
    });
  }

  private showCongrats(): void {
    this.phase = "congrats";
    this.bubbleLayer.replaceChildren();
    this.hideChoices();
    this.congratsEl.classList.remove("hidden");
    this.launchConfetti();
  }

  private showFail(): void {
    this.phase = "failed";
    this.bubbleLayer.replaceChildren();
    this.hideChoices();
    this.failEl.classList.remove("hidden");
  }

  private retryFromIntro(): void {
    window.clearTimeout(this.autoTimer);
    this.autoTimer = 0;
    this.stopTyping();
    this.failEl.classList.add("hidden");
    this.congratsEl.classList.add("hidden");
    this.desktopEl.classList.add("hidden");
    this.closeExplorer();
    this.clearProjector();
    this.setWatching(false);
    this.bubbleLayer.replaceChildren();
    this.hideChoices();
    this.hideInvestorMeter();
    this.stopConfetti();
    this.wrongBlocked = false;
    this.slideIndex = 0;
    this.qaIndex = 0;
    this.satisfaction = DAY_X_QUEST.investorSatisfaction.initial;
    this.runIntro();
  }

  private async afterCongrats(): Promise<void> {
    if (!this.opts) return;
    this.congratsEl.classList.add("hidden");
    this.stopConfetti();
    try {
      await api.completeQuest(DAY_X_QUEST.code);
    } catch (e) {
      console.error("Не удалось закрыть квест Дня X:", e);
    }
    await this.opts.onFinished();
    this.stop();
  }

  private showSlide(source: "diy" | "claude", id: SlideId): void {
    if (!this.layout) return;
    this.projectorEl.classList.remove("hidden");
    this.layoutProjector();
    this.projectorMedia.replaceChildren();
    if (source === "claude") {
      const iframe = document.createElement("iframe");
      iframe.className = "dayx-slide-media dayx-slide-iframe";
      iframe.src = slideAsset(source, id);
      iframe.tabIndex = -1;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.dispatchEvent(new Event("resize"));
        } catch {
          /* cross-origin */
        }
      };
      this.projectorMedia.appendChild(iframe);
      return;
    }
    const img = document.createElement("img");
    img.className = "dayx-slide-media dayx-slide-img";
    img.src = slideAsset(source, id);
    img.alt = id;
    this.projectorMedia.appendChild(img);
  }

  private clearProjector(): void {
    this.projectorMedia.replaceChildren();
    this.projectorEl.classList.add("hidden");
  }

  private setWatching(watching: boolean): void {
    this.overlayEl.src = watching ? OVERLAY_SRC.watching() : OVERLAY_SRC.normal();
    this.opts?.onWatching(watching);
  }

  private relayout(): void {
    if (!this.isOpen || !this.layout) return;
    this.layoutProjector();
    this.layoutOverlay();
    this.layoutDialogue();
    this.layoutInvestorMeter();
  }

  private layoutProjector(): void {
    const canvas = document.getElementById("game")?.querySelector("canvas");
    if (!canvas) return;
    const projector = this.opts?.projectorRect() ?? PROJECTOR_FALLBACK;
    const vp = gameRectToViewport(projector, canvas);
    this.projectorEl.style.left = `${vp.left}px`;
    this.projectorEl.style.top = `${vp.top}px`;
    this.projectorEl.style.width = `${vp.width}px`;
    this.projectorEl.style.height = `${vp.height}px`;
    this.layoutBubbles(canvas);
  }

  private layoutOverlay(): void {
    const canvas = document.getElementById("game")?.querySelector("canvas");
    if (!canvas) return;
    const vp = gameViewport(canvas);
    this.overlayEl.style.left = `${vp.left}px`;
    this.overlayEl.style.top = `${vp.top}px`;
    this.overlayEl.style.width = `${vp.scaleX * GAME_W}px`;
    this.overlayEl.style.height = `${vp.scaleY * GAME_H}px`;
  }

  private layoutDialogue(): void {
    const canvas = document.getElementById("game")?.querySelector("canvas");
    if (!canvas || this.dialogueEl.classList.contains("hidden")) return;
    const vp = gameViewport(canvas);
    this.dialogueEl.style.left = `${vp.left}px`;
    this.dialogueEl.style.top = `${vp.top}px`;
    this.dialogueEl.style.width = `${vp.scaleX * GAME_W}px`;
    this.dialogueEl.style.height = `${vp.scaleY * GAME_H}px`;
  }

  private layoutInvestorMeter(): void {
    const canvas = document.getElementById("game")?.querySelector("canvas");
    if (!canvas || this.meterEl.classList.contains("hidden")) return;
    const vp = gameViewport(canvas);
    this.meterEl.style.left = `${vp.left}px`;
    this.meterEl.style.top = `${vp.top + 10}px`;
    this.meterEl.style.width = `${vp.scaleX * GAME_W}px`;
  }

  private showInvestorMeter(): void {
    this.meterEl.classList.remove("hidden");
    this.meterEl.setAttribute("aria-hidden", "false");
    this.updateInvestorMeter();
    this.layoutInvestorMeter();
  }

  private hideInvestorMeter(): void {
    this.meterEl.classList.add("hidden");
    this.meterEl.setAttribute("aria-hidden", "true");
  }

  private updateInvestorMeter(flash?: "good" | "bad"): void {
    const pct = Math.max(0, Math.min(100, this.satisfaction));
    this.meterFillEl.style.width = `${pct}%`;
    this.meterValueEl.textContent = `${pct}%`;
    this.meterFillEl.classList.remove("dayx-meter-good", "dayx-meter-bad");
    if (flash) {
      this.meterFillEl.classList.add(flash === "good" ? "dayx-meter-good" : "dayx-meter-bad");
      window.setTimeout(() => {
        this.meterFillEl.classList.remove("dayx-meter-good", "dayx-meter-bad");
      }, 500);
    }
  }

  private applyReplyTone(tone: DayXReply["tone"]): void {
    const { goodDelta, badDelta } = DAY_X_QUEST.investorSatisfaction;
    if (tone === "bad") {
      this.satisfaction += badDelta;
      this.updateInvestorMeter("bad");
      return;
    }
    this.satisfaction += goodDelta;
    this.updateInvestorMeter("good");
  }

  private layoutBubbles(canvas: HTMLCanvasElement): void {
    if (!this.layout) return;
    for (const el of this.bubbleLayer.querySelectorAll<HTMLElement>("[data-anchor]")) {
      const id = el.dataset.anchor as DayXBubbleId;
      const pt = this.layout.bubbles[id];
      if (!pt) continue;
      const pos = gamePointToViewport(pt.x, pt.y, canvas);
      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
    }
  }

  private stopTyping(): void {
    this.cancelTyping?.();
    this.cancelTyping = null;
    this.clearStaggerTimers();
    window.clearTimeout(this.lineTimer);
    this.lineTimer = 0;
  }

  private clearStaggerTimers(): void {
    for (const id of this.staggerTimers) window.clearTimeout(id);
    this.staggerTimers = [];
  }

  private scheduleAfter(ms: number, fn: () => void): void {
    const id = window.setTimeout(fn, ms);
    this.staggerTimers.push(id);
  }

  private queueLines(lines: DayXLine[], done: () => void): void {
    let idx = 0;
    const next = (): void => {
      const line = lines[idx];
      if (!line) {
        done();
        return;
      }
      idx += 1;
      this.speakLine(line, next);
    };
    next();
  }

  /** Несколько облачков почти одновременно (лёгкий сдвиг); после печати — пауза PARALLEL_HOLD_MS. */
  private showStaggeredBubbles(
    lines: DayXLine[],
    done: () => void,
    mode: "new" | "replace",
  ): void {
    this.stopTyping();
    this.hideChoices();
    if (!this.layout) {
      done();
      return;
    }

    if (mode === "new") this.bubbleLayer.replaceChildren();

    const cancels: (() => void)[] = [];
    let finished = 0;
    let pending = 0;

    const onOneDone = (): void => {
      finished += 1;
      if (finished >= pending) {
        this.cancelTyping = null;
        this.clearStaggerTimers();
        this.lineTimer = window.setTimeout(done, PARALLEL_HOLD_MS);
      }
    };

    lines.forEach((line, index) => {
      const anchorId = bubbleAnchor(line);
      const anchor = this.layout!.bubbles[anchorId];
      if (!anchor) return;

      let textEl: HTMLElement;
      if (mode === "replace") {
        const found = this.bubbleLayer.querySelector(
          `[data-anchor="${anchorId}"] .dayx-bubble-text`,
        ) as HTMLElement | null;
        if (!found) return;
        textEl = found;
      } else {
        const bubble = document.createElement("div");
        bubble.className = "dayx-bubble";
        bubble.dataset.anchor = anchorId;
        textEl = document.createElement("div");
        textEl.className = "dayx-bubble-text";
        bubble.appendChild(textEl);
        this.bubbleLayer.appendChild(bubble);
        this.positionBubble(bubble, anchor);
      }

      pending += 1;
      const delay = index * PARALLEL_STAGGER_MS;
      this.scheduleAfter(delay, () => {
        textEl.textContent = "";
        cancels.push(typeText(textEl, line.text, onOneDone, BUBBLE_CHAR_MS));
      });
    });

    if (pending === 0) {
      done();
      return;
    }

    this.cancelTyping = () => {
      for (const c of cancels) c();
      this.clearStaggerTimers();
      window.clearTimeout(this.lineTimer);
    };
  }

  private speakLine(line: DayXLine, onDone: () => void): void {
    this.speakAt(bubbleAnchor(line), line.text, DAY_X_VOICES[line.speaker], onDone);
  }

  private speakPlayer(text: string, onDone: () => void): void {
    const voice = this.opts?.playerVoice() ?? "npc-male";
    this.speakAt("speaker", text, voice, onDone);
  }

  private speakAt(anchorId: DayXBubbleId, text: string, voice: VoiceId, onDone: () => void): void {
    this.stopTyping();
    this.hideChoices();
    const anchor = this.layout?.bubbles[anchorId];
    if (!anchor) {
      onDone();
      return;
    }

    this.bubbleLayer.replaceChildren();
    const bubble = document.createElement("div");
    bubble.className = anchorId === "speaker" ? "dayx-bubble dayx-bubble-speaker" : "dayx-bubble";
    bubble.dataset.anchor = anchorId;
    const textEl = document.createElement("div");
    textEl.className = "dayx-bubble-text";
    bubble.appendChild(textEl);
    this.bubbleLayer.appendChild(bubble);
    this.positionBubble(bubble, anchor);

    const done = (): void => {
      this.cancelTyping = null;
      this.lineTimer = window.setTimeout(onDone, LINE_HOLD_MS);
    };

    if (isPunctuationOnly(text)) {
      this.cancelTyping = typeText(textEl, text, done, BUBBLE_CHAR_MS);
      return;
    }

    this.cancelTyping = typeWithVoice(textEl, text, voice, done, BUBBLE_CHAR_MS);
  }

  private positionBubble(bubble: HTMLElement, anchor: { x: number; y: number }): void {
    const canvas = document.getElementById("game")?.querySelector("canvas");
    if (!canvas) return;
    const pos = gamePointToViewport(anchor.x, anchor.y, canvas);
    bubble.style.left = `${pos.left}px`;
    bubble.style.top = `${pos.top}px`;
  }

  private hideChoices(): void {
    this.choiceReplies = [];
    this.onChoicePick = null;
    this.choiceIndex = 0;
    this.optionsEl.replaceChildren();
    this.dialogueEl.classList.add("hidden");
  }

  private showChoices(replies: DayXReply[], onPick: (reply: DayXReply) => void): void {
    this.choiceReplies = shuffleReplies(replies);
    this.onChoicePick = onPick;
    this.choiceIndex = 0;
    this.optionsEl.replaceChildren();
    this.dialogueEl.classList.remove("hidden");
    this.layoutDialogue();

    this.choiceReplies.forEach((reply, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "opt" + (i === 0 ? " sel" : "");
      btn.onclick = () => this.pickChoice(i);
      this.optionsEl.appendChild(btn);
      typeText(btn, reply.label, () => {}, CHOICE_CHAR_MS);
    });
  }

  private refreshChoiceSel(): void {
    [...this.optionsEl.children].forEach((el, i) =>
      el.classList.toggle("sel", i === this.choiceIndex),
    );
  }

  private pickChoice(i: number): void {
    const reply = this.choiceReplies[i];
    const pick = this.onChoicePick;
    if (!reply || !pick) return;
    this.hideChoices();
    pick(reply);
  }

  private launchConfetti(): void {
    const w = (this.confetti.width = stage.width);
    const h = (this.confetti.height = stage.height);
    this.confettiParticles = [];
    const cx = w / 2;
    const cy = h * 0.38;
    for (let i = 0; i < 180; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 9;
      this.confettiParticles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.4,
        size: 6 + Math.random() * 6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
      });
    }
    this.confettiLast = performance.now();
    cancelAnimationFrame(this.confettiRaf);
    this.confettiLoop();
  }

  private confettiLoop = (): void => {
    if (this.congratsEl.classList.contains("hidden")) return;
    const now = performance.now();
    const frame = Math.min((now - this.confettiLast) / 16.67, 3);
    this.confettiLast = now;
    const ctx = this.confettiCtx;
    const { width: w, height: h } = this.confetti;
    ctx.clearRect(0, 0, w, h);
    const alive: ConfettiParticle[] = [];
    for (const p of this.confettiParticles) {
      p.vy += 0.3 * frame;
      p.vx *= 0.99;
      p.x += p.vx * frame;
      p.y += p.vy * frame;
      p.rot += p.vrot * frame;
      if (p.y - p.size > h) continue;
      alive.push(p);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    this.confettiParticles = alive;
    if (alive.length) this.confettiRaf = requestAnimationFrame(this.confettiLoop);
    else ctx.clearRect(0, 0, w, h);
  };

  private stopConfetti(): void {
    cancelAnimationFrame(this.confettiRaf);
    this.confettiRaf = 0;
    this.confettiParticles = [];
    this.confettiCtx.clearRect(0, 0, this.confetti.width, this.confetti.height);
  }

  private name(): string {
    return this.opts?.login() ?? "коллега";
  }
}

export function dayXLayoutFromMap(
  points: Map<string, { x: number; y: number }>,
): DayXLayout {
  return {
    bubbles: {
      boss1: points.get("bubble-boss1") ?? { x: 170, y: 430 },
      boss2: points.get("bubble-boss2") ?? { x: 300, y: 400 },
      boss3: points.get("bubble-boss3") ?? { x: 430, y: 420 },
      boss4: points.get("bubble-boss4") ?? { x: 560, y: 390 },
      inv1: points.get("bubble-inv1") ?? { x: 780, y: 390 },
      inv2: points.get("bubble-inv2") ?? { x: 920, y: 410 },
      inv3: points.get("bubble-inv3") ?? { x: 1060, y: 400 },
      speaker: points.get("bubble-speaker") ?? { x: 640, y: 620 },
    },
  };
}

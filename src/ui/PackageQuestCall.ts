import {
  PACKAGE_BRIEFING_ACCEPT,
  PACKAGE_BRIEFING_CLOSING,
  PACKAGE_BRIEFING_HELP,
  PACKAGE_BRIEFING_INTRO,
  PACKAGE_BRIEFING_QUESTIONS,
  PACKAGE_FINALE,
  PACKAGE_QUEST,
  packageGreeting,
  type PackageBriefingQuestion,
} from "../data/packageQuest";

const CHAR_DELAY = Math.round(22 * 2.5);
const AFTER_PLAYER_MS = 400;
const LINE_HOLD_MS = PACKAGE_QUEST.timings.lineHoldMs;

function typeText(el: HTMLElement, text: string, onDone: () => void, delay = CHAR_DELAY): () => void {
  let shown = 0;
  el.textContent = "";
  const timer = window.setInterval(() => {
    shown++;
    el.textContent = text.slice(0, shown);
    if (shown >= text.length) {
      window.clearInterval(timer);
      onDone();
    }
  }, delay);
  return () => window.clearInterval(timer);
}

export interface PackageQuestCallHandlers {
  onBriefingAccepted: () => void;
  onBriefingComplete: () => void;
  onBriefingAbort: () => void;
  onFinaleComplete: () => void;
  onFinaleAbort: () => void;
  onDismissEnded: () => void;
}

/** Диалог Бульбикова: брифинг в начале и финальная благодарность. Без статус-звонков. */
export class PackageQuestCall {
  private callEl = document.getElementById("bpCall")!;
  private bubble = document.getElementById("bpBubble")!;
  private bubbleText = document.getElementById("bpBubbleText")!;
  private playerLine = document.getElementById("bpPlayerLine")!;
  private repliesEl = document.getElementById("bpReplies")!;
  private pinWrap = document.getElementById("bpPinWrap")!;

  private mode: "idle" | "briefing" | "finale" | "ended" = "idle";
  private asked = new Set<PackageBriefingQuestion["id"]>();
  private cancelTyping: (() => void) | null = null;
  private lineTimer = 0;
  private token = 0;
  private briefingAccepted = false;

  constructor(private handlers: PackageQuestCallHandlers) {}

  get isBusy(): boolean {
    return this.mode !== "idle";
  }

  get isEnded(): boolean {
    return this.mode === "ended";
  }

  startBriefing(playerName: string): void {
    this.resetUi();
    this.mode = "briefing";
    this.asked.clear();
    this.briefingAccepted = false;
    this.say(packageGreeting(playerName), () => this.showHelpPrompt(), { awaitReply: true });
  }

  startFinale(): void {
    this.resetUi();
    this.mode = "finale";
    this.say(PACKAGE_FINALE, () => this.enterEnded("finale"));
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
    if (this.mode === "finale") {
      this.stop();
      this.handlers.onFinaleAbort();
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
    this.resetUi();
  }

  private resetUi(): void {
    this.callEl.classList.remove("is-ended");
    this.hideBubble();
    this.playerLine.textContent = "";
    this.hideReplies();
    this.pinWrap.classList.add("hidden");
  }

  private enterEnded(from: "briefing" | "finale"): void {
    this.token++;
    window.clearTimeout(this.lineTimer);
    this.cancelTyping?.();
    this.cancelTyping = null;
    this.hideReplies();
    this.playerLine.textContent = "";
    this.mode = "ended";
    this.callEl.classList.add("is-ended");
    if (from === "briefing") this.handlers.onBriefingComplete();
    else this.handlers.onFinaleComplete();
  }

  private showHelpPrompt(): void {
    if (this.mode !== "briefing") return;
    this.repliesEl.replaceChildren();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bp-reply";
    btn.textContent = PACKAGE_BRIEFING_HELP;
    btn.onclick = () => this.askHelp();
    this.repliesEl.appendChild(btn);
    this.repliesEl.classList.remove("hidden");
  }

  private askHelp(): void {
    if (this.mode !== "briefing") return;
    this.hideReplies();
    this.playerLine.textContent = PACKAGE_BRIEFING_HELP;
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      this.say(PACKAGE_BRIEFING_INTRO, () => this.showBriefingReplies(), { awaitReply: true });
    }, AFTER_PLAYER_MS);
  }

  private showBriefingReplies(): void {
    if (this.mode !== "briefing") return;
    const left = PACKAGE_BRIEFING_QUESTIONS.filter((q) => !this.asked.has(q.id));
    if (left.length === 0) {
      this.showAcceptPrompt();
      return;
    }
    this.repliesEl.replaceChildren();
    for (const q of left) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bp-reply";
      btn.textContent = q.label;
      btn.onclick = () => this.askBriefing(q);
      this.repliesEl.appendChild(btn);
    }
    this.repliesEl.classList.remove("hidden");
  }

  private showAcceptPrompt(): void {
    if (this.mode !== "briefing") return;
    this.repliesEl.replaceChildren();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bp-reply";
    btn.textContent = PACKAGE_BRIEFING_ACCEPT;
    btn.onclick = () => this.acceptBriefing();
    this.repliesEl.appendChild(btn);
    this.repliesEl.classList.remove("hidden");
  }

  private acceptBriefing(): void {
    if (this.mode !== "briefing") return;
    this.hideReplies();
    this.playerLine.textContent = PACKAGE_BRIEFING_ACCEPT;
    this.briefingAccepted = true;
    this.handlers.onBriefingAccepted();
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      this.say(PACKAGE_BRIEFING_CLOSING, () => this.enterEnded("briefing"));
    }, AFTER_PLAYER_MS);
  }

  private askBriefing(q: PackageBriefingQuestion): void {
    if (this.mode !== "briefing") return;
    this.hideReplies();
    this.playerLine.textContent = q.label;
    this.asked.add(q.id);
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      this.say(q.answer, () => this.showBriefingReplies(), { awaitReply: true });
    }, AFTER_PLAYER_MS);
  }

  private say(text: string, onDone: () => void, opts?: { awaitReply?: boolean }): void {
    const token = ++this.token;
    this.cancelTyping?.();
    this.bubble.classList.remove("hidden");
    this.cancelTyping = typeText(this.bubbleText, text, () => {
      this.cancelTyping = null;
      if (token !== this.token) return;
      if (opts?.awaitReply) {
        onDone();
        return;
      }
      this.lineTimer = window.setTimeout(() => {
        if (token !== this.token) return;
        onDone();
      }, LINE_HOLD_MS);
    });
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

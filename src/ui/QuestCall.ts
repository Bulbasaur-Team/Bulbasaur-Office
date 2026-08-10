import {
  BRIEFING_ACCEPT_PROMPT,
  BRIEFING_CLOSING,
  BRIEFING_HELP_PROMPT,
  BRIEFING_INTRO_FOLLOWUP,
  BRIEFING_QUESTIONS,
  FRIDGE_QUEST,
  STATUS_SUCCESS,
  STATUS_WRONG_PIN,
  greeting,
  pickStatusInProgressReply,
  pickStatusPrompt,
  type BriefingQuestion,
} from "../data/quests";

/** В 2.5 раза медленнее исходных 22 мс. */
const CHAR_DELAY = Math.round(22 * 2.5);
const AFTER_PLAYER_MS = 400;
const LINE_HOLD_MS = FRIDGE_QUEST.timings.lineHoldMs;

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

export interface QuestCallHandlers {
  /** Брифинг завершён Бульбовым (экран «звонок завершён» уже показан). */
  onBriefingComplete: () => void;
  /** Игрок сбросил трубку до завершения брифинга. */
  onBriefingAbort: () => void;
  /** Статус-звонок завершён Бульбовым (экран ended). */
  onStatusRemoteHangup: () => void;
  /** Игрок сбросил статус-звонок. */
  onStatusAbort: () => void;
  /** Вернуть Promise: true — пин принят сервером. */
  onSubmitPin: (pin: string) => Promise<boolean>;
  /** Квест пройден (экран ended). */
  onQuestCompleted: () => void;
  /** Игрок закрыл экран завершённого звонка. */
  onDismissEnded: () => void;
}

/** Диалог внутри BulbaPhone: брифинг и статус-звонки. */
export class QuestCall {
  private callEl = document.getElementById("bpCall")!;
  private bubble = document.getElementById("bpBubble")!;
  private bubbleText = document.getElementById("bpBubbleText")!;
  private playerLine = document.getElementById("bpPlayerLine")!;
  private repliesEl = document.getElementById("bpReplies")!;
  private pinWrap = document.getElementById("bpPinWrap")!;
  private pinInput = document.getElementById("bpPinInput") as HTMLInputElement;
  private pinSubmit = document.getElementById("bpPinSubmit")!;

  private mode: "idle" | "briefing" | "status" | "ended" = "idle";
  private asked = new Set<BriefingQuestion["id"]>();
  private cancelTyping: (() => void) | null = null;
  private lineTimer = 0;
  private token = 0;
  private awaitingPin = false;

  constructor(private handlers: QuestCallHandlers) {
    this.pinSubmit.onclick = () => void this.submitPin();
    this.pinInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return;
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        void this.submitPin();
      }
    });
  }

  get isBusy(): boolean {
    return this.mode !== "idle";
  }

  get isEnded(): boolean {
    return this.mode === "ended";
  }

  get isBriefing(): boolean {
    return this.mode === "briefing";
  }

  startBriefing(playerName: string): void {
    this.resetUi();
    this.mode = "briefing";
    this.asked.clear();
    // После приветствия ждём вопрос игрока — иначе вторая реплика сменит первую слишком рано.
    this.say(greeting(playerName), () => this.showHelpPrompt(), { awaitReply: true });
  }

  startStatus(): void {
    this.resetUi();
    this.mode = "status";
    this.awaitingPin = false;
    this.say(pickStatusPrompt(), () => this.showStatusReplies(), { awaitReply: true });
  }

  /** Крестик / сброс игроком. */
  hangupByPlayer(): void {
    if (this.mode === "ended") {
      this.dismissEnded();
      return;
    }
    if (this.mode === "briefing") {
      this.stop();
      this.handlers.onBriefingAbort();
      return;
    }
    if (this.mode === "status") {
      this.stop();
      this.handlers.onStatusAbort();
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
    this.awaitingPin = false;
    this.resetUi();
  }

  private resetUi(): void {
    this.callEl.classList.remove("is-ended");
    this.hideBubble();
    this.playerLine.textContent = "";
    this.hideReplies();
    this.hidePin();
  }

  private enterEnded(from: "briefing" | "status" | "completed"): void {
    this.token++;
    window.clearTimeout(this.lineTimer);
    this.cancelTyping?.();
    this.cancelTyping = null;
    this.awaitingPin = false;
    this.hideReplies();
    this.hidePin();
    this.playerLine.textContent = "";
    // Последняя реплика остаётся на экране вместе с «Звонок завершён».
    this.mode = "ended";
    this.callEl.classList.add("is-ended");

    if (from === "briefing") this.handlers.onBriefingComplete();
    else if (from === "completed") this.handlers.onQuestCompleted();
    else this.handlers.onStatusRemoteHangup();
  }

  private showHelpPrompt(): void {
    if (this.mode !== "briefing") return;
    this.repliesEl.replaceChildren();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bp-reply";
    btn.textContent = BRIEFING_HELP_PROMPT;
    btn.onclick = () => this.askHelp();
    this.repliesEl.appendChild(btn);
    this.repliesEl.classList.remove("hidden");
  }

  private askHelp(): void {
    if (this.mode !== "briefing") return;
    this.hideReplies();
    this.playerLine.textContent = BRIEFING_HELP_PROMPT;
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      this.say(BRIEFING_INTRO_FOLLOWUP, () => this.showBriefingReplies(), { awaitReply: true });
    }, AFTER_PLAYER_MS);
  }

  private showBriefingReplies(): void {
    if (this.mode !== "briefing") return;
    const left = BRIEFING_QUESTIONS.filter((q) => !this.asked.has(q.id));
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
    btn.textContent = BRIEFING_ACCEPT_PROMPT;
    btn.onclick = () => this.acceptBriefing();
    this.repliesEl.appendChild(btn);
    this.repliesEl.classList.remove("hidden");
  }

  private acceptBriefing(): void {
    if (this.mode !== "briefing") return;
    this.hideReplies();
    this.playerLine.textContent = BRIEFING_ACCEPT_PROMPT;
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      this.say(BRIEFING_CLOSING, () => this.enterEnded("briefing"));
    }, AFTER_PLAYER_MS);
  }

  private askBriefing(q: BriefingQuestion): void {
    if (this.mode !== "briefing") return;
    this.hideReplies();
    this.playerLine.textContent = q.label;
    this.asked.add(q.id);
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      // После любой реплики ждём следующий клик игрока (вопросы или «выясню пин-код»).
      this.say(q.answer, () => this.showBriefingReplies(), { awaitReply: true });
    }, AFTER_PLAYER_MS);
  }

  private showStatusReplies(): void {
    if (this.mode !== "status") return;
    this.repliesEl.replaceChildren();
    const work = document.createElement("button");
    work.type = "button";
    work.className = "bp-reply";
    work.textContent = "В работе";
    work.onclick = () => this.chooseInProgress();

    const know = document.createElement("button");
    know.type = "button";
    know.className = "bp-reply";
    know.textContent = "Я знаю пин-код";
    know.onclick = () => this.chooseKnowPin();

    this.repliesEl.append(work, know);
    this.repliesEl.classList.remove("hidden");
  }

  private chooseInProgress(): void {
    if (this.mode !== "status") return;
    this.hideReplies();
    this.playerLine.textContent = "В работе";
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      this.say(pickStatusInProgressReply(), () => this.enterEnded("status"));
    }, AFTER_PLAYER_MS);
  }

  private chooseKnowPin(): void {
    if (this.mode !== "status") return;
    this.hideReplies();
    this.playerLine.textContent = "Я знаю пин-код";
    this.awaitingPin = true;
    this.pinWrap.classList.remove("hidden");
    this.pinInput.value = "";
    this.pinInput.focus();
  }

  private async submitPin(): Promise<void> {
    if (this.mode !== "status" || !this.awaitingPin) return;
    const pin = this.pinInput.value.trim();
    if (!/^\d{6}$/.test(pin)) {
      this.pinInput.focus();
      return;
    }
    this.pinSubmit.setAttribute("disabled", "true");
    try {
      const ok = await this.handlers.onSubmitPin(pin);
      this.hidePin();
      this.awaitingPin = false;
      if (ok) {
        this.say(STATUS_SUCCESS, () => this.enterEnded("completed"));
      } else {
        this.say(STATUS_WRONG_PIN, () => this.enterEnded("status"));
      }
    } finally {
      this.pinSubmit.removeAttribute("disabled");
    }
  }

  /**
   * @param awaitReply — после печати текст остаётся, onDone сразу (ждём ответ игрока).
   * Иначе после печати ждём LINE_HOLD_MS (3 с), затем onDone (обычно → ended).
   */
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

  private hidePin(): void {
    this.pinWrap.classList.add("hidden");
    this.pinInput.value = "";
  }
}

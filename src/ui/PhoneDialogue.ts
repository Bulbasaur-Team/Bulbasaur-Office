import type { PhoneNode, PhoneReply, PhoneScript } from "../data/phoneScripts";
import type { VoiceId } from "../data/voices";
import { FRIDGE_QUEST } from "../data/quests";
import { typeWithVoice } from "./CharacterVoice";
import { dialTone } from "./DialTone";

const CHAR_DELAY = Math.round(22 * 2.5);
const AFTER_PLAYER_MS = 400;
const LINE_HOLD_MS = FRIDGE_QUEST.timings.lineHoldMs;
/** После финальной реплики — сразу кладём трубку, без длинной паузы. */
const HANGUP_HOLD_MS = 1_000;

function fillName(text: string, playerName: string): string {
  return text.split("{имя}").join(playerName);
}

export interface PhoneDialogueHandlers {
  /** Скрипт дошёл до финальной реплики, собеседник кладёт трубку. */
  onRemoteHangup: () => void;
  /** Игрок сбросил до конца разговора. */
  onAbort: () => void;
  onDismissEnded: () => void;
}

/** Универсальный диалог на экране звонка Bulba-Phone. */
export class PhoneDialogue {
  private callEl = document.getElementById("bpCall")!;
  private bubble = document.getElementById("bpBubble")!;
  private bubbleText = document.getElementById("bpBubbleText")!;
  private playerLine = document.getElementById("bpPlayerLine")!;
  private repliesEl = document.getElementById("bpReplies")!;
  private pinWrap = document.getElementById("bpPinWrap")!;

  private mode: "idle" | "talk" | "ended" = "idle";
  private cancelTyping: (() => void) | null = null;
  private lineTimer = 0;
  private token = 0;
  private script: PhoneScript | null = null;
  private playerName = "";
  private speaker: VoiceId = "hr";
  private finished = false;
  private askedOnce = new Set<string>();

  constructor(private handlers: PhoneDialogueHandlers) {}

  get isBusy(): boolean {
    return this.mode !== "idle";
  }

  get isEnded(): boolean {
    return this.mode === "ended";
  }

  /** Разговор дошёл до финальной реплики (квест можно закрывать). */
  get didFinish(): boolean {
    return this.finished;
  }

  start(script: PhoneScript, playerName: string, speaker: VoiceId, opts?: { again?: boolean }): void {
    this.resetUi();
    this.mode = "talk";
    this.finished = false;
    this.askedOnce.clear();
    this.script = script;
    this.playerName = playerName;
    this.speaker = speaker;
    const nodeId = opts?.again && script.again ? script.again : script.start;
    this.enterNode(nodeId);
  }

  hangupByPlayer(): void {
    if (this.mode === "ended") {
      this.dismissEnded();
      return;
    }
    if (this.mode === "talk") {
      const done = this.finished;
      this.stop();
      if (done) this.handlers.onRemoteHangup();
      else this.handlers.onAbort();
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
    this.script = null;
    this.askedOnce.clear();
    this.resetUi();
  }

  private resetUi(): void {
    this.callEl.classList.remove("is-ended");
    this.hideBubble();
    this.playerLine.textContent = "";
    this.hideReplies();
    this.pinWrap.classList.add("hidden");
  }

  private enterNode(id: string): void {
    if (this.mode !== "talk" || !this.script) return;
    const node = this.script.nodes[id];
    if (!node) {
      this.enterEnded();
      return;
    }
    const delay = node.delayMs ?? 0;
    const token = ++this.token;
    const go = () => {
      if (token !== this.token || this.mode !== "talk") return;
      this.playNode(node);
    };
    if (delay > 0) this.lineTimer = window.setTimeout(go, delay);
    else go();
  }

  private playNode(node: PhoneNode): void {
    const text = node.say ? fillName(node.say, this.playerName) : "";
    if (node.hangup) this.finished = true;

    const afterSay = () => {
      if (this.mode !== "talk") return;
      if (node.resumeOrHangup) {
        if (this.hasRemainingOnce(node.resumeOrHangup)) this.enterNode(node.resumeOrHangup);
        else if (node.done) this.enterNode(node.done);
        else {
          this.finished = true;
          this.enterEnded();
        }
        return;
      }
      if (node.hangup) {
        this.enterEnded();
        return;
      }
      if (node.replies && node.replies.length > 0) {
        this.showReplies(node);
        return;
      }
      if (node.autoNext) {
        this.enterNode(node.autoNext);
        return;
      }
      this.enterEnded();
    };

    if (!text) {
      afterSay();
      return;
    }
    const awaitReply = !!(node.replies && node.replies.length > 0);
    const lastQuestion = !!node.resumeOrHangup && !this.hasRemainingOnce(node.resumeOrHangup) && !node.done;
    this.say(text, afterSay, { awaitReply, hangupHold: !!node.hangup || lastQuestion });
  }

  private visibleReplies(node: PhoneNode): PhoneReply[] {
    return (node.replies ?? []).filter((reply) => !reply.once || !this.askedOnce.has(reply.id));
  }

  private hasRemainingOnce(nodeId: string): boolean {
    const node = this.script?.nodes[nodeId];
    if (!node?.replies) return false;
    return node.replies.some((reply) => reply.once && !this.askedOnce.has(reply.id));
  }

  private showReplies(node: PhoneNode): void {
    if (this.mode !== "talk") return;
    const replies = this.visibleReplies(node);
    if (replies.length === 0) {
      this.finished = true;
      this.enterEnded();
      return;
    }
    this.repliesEl.replaceChildren();
    for (const reply of replies) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bp-reply";
      btn.textContent = reply.label;
      btn.onclick = () => this.choose(node, reply.id, reply.label);
      this.repliesEl.appendChild(btn);
    }
    this.repliesEl.classList.remove("hidden");
  }

  private choose(node: PhoneNode, replyId: string, label: string): void {
    if (this.mode !== "talk" || !this.script) return;
    const reply = node.replies?.find((item) => item.id === replyId);
    if (reply?.once) this.askedOnce.add(replyId);
    this.hideReplies();
    this.playerLine.textContent = label;
    const nextId = node.next?.[replyId] ?? node.next?.["*"];
    const token = ++this.token;
    this.lineTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.playerLine.textContent = "";
      if (nextId) this.enterNode(nextId);
      else this.enterEnded();
    }, AFTER_PLAYER_MS);
  }

  private enterEnded(): void {
    this.token++;
    window.clearTimeout(this.lineTimer);
    this.cancelTyping?.();
    this.cancelTyping = null;
    this.hideReplies();
    this.playerLine.textContent = "";
    this.mode = "ended";
    this.callEl.classList.add("is-ended");
    dialTone.playHangup();
    this.handlers.onRemoteHangup();
  }

  private say(
    text: string,
    onDone: () => void,
    opts?: { awaitReply?: boolean; hangupHold?: boolean },
  ): void {
    const token = ++this.token;
    this.cancelTyping?.();
    this.bubble.classList.remove("hidden");
    this.cancelTyping = typeWithVoice(this.bubbleText, text, this.speaker, () => {
      this.cancelTyping = null;
      if (token !== this.token) return;
      if (opts?.awaitReply) {
        onDone();
        return;
      }
      const hold = opts?.hangupHold ? HANGUP_HOLD_MS : LINE_HOLD_MS;
      this.lineTimer = window.setTimeout(() => {
        if (token !== this.token) return;
        onDone();
      }, hold);
    }, CHAR_DELAY);
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

import * as api from "../net/api";
import { FRIDGE_QUEST, type QuestApiStatus } from "../data/quests";
import { BulbaPhone } from "./BulbaPhone";
import { QuestCall } from "./QuestCall";
import type { KeyConsumer } from "./KeyboardRouter";

interface QuestControllerOpts {
  onBalance: (balance: number) => void;
  /** Можно ли сейчас показывать входящий (нет других модалок). */
  canRing: () => boolean;
}

/**
 * Мультиплеер-квест fridge_pin: таймеры звонков + BulbaPhone/QuestCall.
 * Статус и награда — через REST.
 */
export class QuestController implements KeyConsumer {
  private phone: BulbaPhone;
  private call: QuestCall;
  private status: QuestApiStatus = "LOCKED";
  private timer = 0;
  private pendingKind: "intro" | "status" | null = null;
  private started = false;
  /** Уже ставили таймер intro в этой сессии (чтобы не дёргать повторно при refresh). */
  private introScheduled = false;

  constructor(private opts: QuestControllerOpts) {
    this.phone = new BulbaPhone({
      onAccept: () => this.acceptIncoming(),
      onDecline: () => this.declineIncoming(),
      onHangup: () => this.hangup(),
    });
    this.call = new QuestCall({
      onBriefingAccepted: () => void this.afterBriefingAccepted(),
      onBriefingComplete: () => this.afterBriefingCallEnded(),
      onBriefingAbort: () => this.afterBriefingAbort(),
      onStatusRemoteHangup: () => this.afterStatusRemoteHangup(),
      onStatusAbort: () => this.afterStatusAbort(),
      onSubmitPin: (pin) => this.submitPin(pin),
      onQuestCompleted: () => this.afterQuestCompleted(),
      onDismissEnded: () => this.afterDismissEnded(),
    });
  }

  get isOpen(): boolean {
    return this.phone.isOpen;
  }

  get questStatus(): QuestApiStatus {
    return this.status;
  }

  isActive(): boolean {
    return this.phone.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    return this.phone.handleKey(e);
  }

  /** Запуск после входа в MP. */
  async start(): Promise<void> {
    this.stop();
    this.started = true;
    await this.refreshFromServer({ initial: true });
  }

  /**
   * Перечитать статус с сервера. После новой ачивки квест мог только что
   * открыться (LOCKED → AVAILABLE) — тогда планируем первый звонок.
   */
  async refreshFromServer(opts?: { initial?: boolean }): Promise<void> {
    if (!this.started) return;
    const prev = this.status;
    try {
      const list = await api.fetchQuests();
      const row = list.quests.find((q) => q.code === FRIDGE_QUEST.code);
      this.status = row?.status ?? "LOCKED";
    } catch (e) {
      console.error("Не удалось загрузить квесты:", e);
      if (opts?.initial) this.status = "LOCKED";
      return;
    }
    if (!this.started) return;

    if (this.status === "COMPLETED") {
      window.clearTimeout(this.timer);
      this.timer = 0;
      this.pendingKind = null;
      return;
    }

    if (this.status === "LOCKED") return;

    if (this.status === "IN_PROGRESS") {
      if (!this.timer && !this.phone.isOpen && !this.call.isBusy) {
        this.schedule("status", FRIDGE_QUEST.timings.statusIntervalMs);
      }
      return;
    }

    // AVAILABLE
    const justUnlocked = prev === "LOCKED" && !opts?.initial;
    if (!this.introScheduled && !this.phone.isOpen && !this.call.isBusy) {
      this.introScheduled = true;
      this.schedule(
        "intro",
        justUnlocked ? 3_000 : FRIDGE_QUEST.timings.introDelayMs,
      );
    }
  }

  stop(): void {
    this.started = false;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.pendingKind = null;
    this.introScheduled = false;
    this.call.stop();
    this.phone.close();
  }

  private schedule(kind: "intro" | "status", delayMs: number): void {
    window.clearTimeout(this.timer);
    this.pendingKind = kind;
    this.timer = window.setTimeout(() => this.tryRing(kind), delayMs);
  }

  private tryRing(kind: "intro" | "status"): void {
    this.timer = 0;
    if (!this.started || this.status === "COMPLETED" || this.status === "LOCKED") return;
    if (this.phone.isOpen || this.call.isBusy) {
      this.schedule(kind, 5_000);
      return;
    }
    if (!this.opts.canRing()) {
      this.schedule(kind, 5_000);
      return;
    }
    this.pendingKind = kind;
    this.phone.showIncoming();
  }

  private acceptIncoming(): void {
    const kind = this.pendingKind ?? (this.status === "IN_PROGRESS" ? "status" : "intro");
    this.pendingKind = null;
    this.phone.showCall();
    if (kind === "intro" && this.status === "AVAILABLE") {
      this.call.startBriefing(api.getLogin() ?? "Игрок");
      return;
    }
    this.call.startStatus();
  }

  private declineIncoming(): void {
    this.phone.close();
    if (this.status === "IN_PROGRESS") {
      this.schedule("status", FRIDGE_QUEST.timings.statusIntervalMs);
      return;
    }
    this.schedule("intro", FRIDGE_QUEST.timings.declineRetryMs);
  }

  private hangup(): void {
    if (!this.phone.isOpen) return;
    if (this.phone.mode() === "incoming") {
      this.declineIncoming();
      return;
    }
    if (this.call.isEnded) {
      this.call.dismissEnded();
      return;
    }
    this.call.hangupByPlayer();
    if (this.phone.isOpen) this.phone.close();
  }

  private async afterBriefingAccepted(): Promise<void> {
    try {
      const res = await api.startQuest(FRIDGE_QUEST.code);
      this.status = res.status;
    } catch (e) {
      console.error("Не удалось стартовать квест:", e);
      this.status = "IN_PROGRESS";
    }
  }

  /** Трубка сброшена после принятия квеста — запускаем цикл статус-звонков. */
  private afterBriefingCallEnded(): void {
    if (this.status === "COMPLETED") return;
    if (this.status !== "IN_PROGRESS") this.status = "IN_PROGRESS";
    this.schedule("status", FRIDGE_QUEST.timings.statusIntervalMs);
  }

  private afterBriefingAbort(): void {
    this.phone.close();
    this.status = "AVAILABLE";
    this.schedule("intro", FRIDGE_QUEST.timings.declineRetryMs);
  }

  private afterStatusRemoteHangup(): void {
    if (this.status === "COMPLETED") return;
    this.schedule("status", FRIDGE_QUEST.timings.statusIntervalMs);
  }

  private afterStatusAbort(): void {
    this.phone.close();
    if (this.status === "COMPLETED") return;
    this.schedule("status", FRIDGE_QUEST.timings.statusIntervalMs);
  }

  private async submitPin(pin: string): Promise<boolean> {
    try {
      const res = await api.completeQuest(FRIDGE_QUEST.code, pin);
      this.opts.onBalance(res.bulbaCoinBalance);
      this.status = res.status;
      return res.status === "COMPLETED";
    } catch {
      return false;
    }
  }

  private afterQuestCompleted(): void {
    this.status = "COMPLETED";
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.pendingKind = null;
  }

  private afterDismissEnded(): void {
    this.phone.close();
  }
}

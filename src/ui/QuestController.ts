import * as api from "../net/api";
import { FRIDGE_QUEST, type QuestApiStatus } from "../data/quests";
import { PACKAGE_QUEST } from "../data/packageQuest";
import { BulbaPhone } from "./BulbaPhone";
import { QuestCall } from "./QuestCall";
import { PackageQuestCall } from "./PackageQuestCall";
import type { KeyConsumer } from "./KeyboardRouter";

type RingKind = "fridgeIntro" | "fridgeStatus" | "packageIntro" | "packageFinale";

interface QuestControllerOpts {
  onBalance: (balance: number) => void;
  /** Можно ли сейчас показывать входящий (нет других модалок). */
  canRing: () => boolean;
  /** Локальный прогресс посылки сброшен / обновлён — сцена может переспавнить NPC. */
  onPackageProgress?: () => void;
}

/**
 * Мультиплеер-квесты: fridge_pin (со статус-звонками) и lost_package (только intro + finale).
 */
export class QuestController implements KeyConsumer {
  private phone: BulbaPhone;
  private fridgeCall: QuestCall;
  private packageCall: PackageQuestCall;

  private fridgeStatus: QuestApiStatus = "LOCKED";
  private packageStatus: QuestApiStatus = "LOCKED";

  private timer = 0;
  private pendingKind: RingKind | null = null;
  private started = false;

  /** Клиентский прогресс lost_package (персистится в localStorage на время IN_PROGRESS). */
  private driverBriefed = false;
  private waybillRead = false;
  private hasPackage = false;

  constructor(private opts: QuestControllerOpts) {
    this.phone = new BulbaPhone({
      onAccept: () => this.acceptIncoming(),
      onDecline: () => this.declineIncoming(),
      onHangup: () => this.hangup(),
    });
    this.fridgeCall = new QuestCall({
      onBriefingAccepted: () => void this.afterFridgeBriefingAccepted(),
      onBriefingComplete: () => this.afterFridgeBriefingCallEnded(),
      onBriefingAbort: () => this.afterFridgeBriefingAbort(),
      onStatusRemoteHangup: () => this.afterFridgeStatusRemoteHangup(),
      onStatusAbort: () => this.afterFridgeStatusAbort(),
      onSubmitPin: (pin) => this.submitFridgePin(pin),
      onQuestCompleted: () => this.afterFridgeQuestCompleted(),
      onDismissEnded: () => this.afterDismissEnded(),
    });
    this.packageCall = new PackageQuestCall({
      onBriefingAccepted: () => void this.afterPackageBriefingAccepted(),
      onBriefingComplete: () => this.afterPackageBriefingCallEnded(),
      onBriefingAbort: () => this.afterPackageBriefingAbort(),
      onFinaleComplete: () => this.afterPackageFinaleComplete(),
      onFinaleAbort: () => this.afterPackageFinaleAbort(),
      onDismissEnded: () => this.afterDismissEnded(),
    });
  }

  get isOpen(): boolean {
    return this.phone.isOpen;
  }

  /** @deprecated используй fridgeQuestStatus — для кота fridge_pin. */
  get questStatus(): QuestApiStatus {
    return this.fridgeStatus;
  }

  get fridgeQuestStatus(): QuestApiStatus {
    return this.fridgeStatus;
  }

  get packageQuestStatus(): QuestApiStatus {
    return this.packageStatus;
  }

  get packageInProgress(): boolean {
    return this.packageStatus === "IN_PROGRESS";
  }

  get packageWaybillRead(): boolean {
    return this.waybillRead;
  }

  get packageHasItem(): boolean {
    return this.hasPackage;
  }

  get packageDriverBriefed(): boolean {
    return this.driverBriefed;
  }

  isActive(): boolean {
    return this.phone.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    return this.phone.handleKey(e);
  }

  async start(): Promise<void> {
    this.stop();
    this.started = true;
    await this.refreshFromServer({ initial: true });
  }

  async refreshFromServer(opts?: { initial?: boolean }): Promise<void> {
    if (!this.started) return;
    const prevFridge = this.fridgeStatus;
    const prevPackage = this.packageStatus;
    try {
      const list = await api.fetchQuests();
      this.fridgeStatus =
        list.quests.find((q) => q.code === FRIDGE_QUEST.code)?.status ?? "LOCKED";
      this.packageStatus =
        list.quests.find((q) => q.code === PACKAGE_QUEST.code)?.status ?? "LOCKED";
    } catch (e) {
      console.error("Не удалось загрузить квесты:", e);
      if (opts?.initial) {
        this.fridgeStatus = "LOCKED";
        this.packageStatus = "LOCKED";
      }
      return;
    }
    if (!this.started) return;

    if (this.packageStatus === "IN_PROGRESS") {
      this.loadPackageProgress();
    } else {
      this.resetPackageProgress({ clearStorage: true });
    }

    if (this.fridgeStatus === "COMPLETED" && this.packageStatus === "COMPLETED") {
      // Не сбрасывать таймер финального звонка Бульбикова.
      if (
        this.pendingKind === "packageFinale" ||
        this.packageCall.isBusy ||
        this.phone.isOpen
      ) {
        return;
      }
      window.clearTimeout(this.timer);
      this.timer = 0;
      this.pendingKind = null;
      return;
    }

    const justFridgeUnlock = prevFridge === "LOCKED" && !opts?.initial;
    const justPackageUnlock = prevPackage === "LOCKED" && !opts?.initial;
    this.ensureRingScheduled({
      initial: !!opts?.initial,
      justFridgeUnlock,
      justPackageUnlock,
    });
  }

  /**
   * Поставить входящий в очередь, если квест доступен/в процессе и сейчас никто не говорит.
   * Вызывается и после закрытия трубки — чтобы не потерять звонок, пока был открыт телефон/модалка.
   */
  private ensureRingScheduled(opts?: {
    initial?: boolean;
    justFridgeUnlock?: boolean;
    justPackageUnlock?: boolean;
  }): void {
    if (!this.started) return;
    if (this.phone.isOpen || this.anyCallBusy()) return;
    // Уже ждём конкретный звонок — не сбрасываем таймер.
    if (this.timer && this.pendingKind) return;

    if (this.fridgeStatus === "IN_PROGRESS") {
      this.schedule("fridgeStatus", FRIDGE_QUEST.timings.statusIntervalMs);
      return;
    }

    if (this.fridgeStatus === "AVAILABLE") {
      this.schedule(
        "fridgeIntro",
        opts?.justFridgeUnlock ? 3_000 : FRIDGE_QUEST.timings.introDelayMs,
      );
      return;
    }

    if (this.packageStatus === "AVAILABLE") {
      const delay = opts?.justPackageUnlock
        ? 3_000
        : opts?.initial
          ? PACKAGE_QUEST.timings.introDelayMs
          : 3_000;
      this.schedule("packageIntro", delay);
    }
  }

  stop(): void {
    this.started = false;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.pendingKind = null;
    // Память сбрасываем, localStorage оставляем — после F5 восстановим по IN_PROGRESS.
    this.driverBriefed = false;
    this.waybillRead = false;
    this.hasPackage = false;
    this.fridgeCall.stop();
    this.packageCall.stop();
    this.phone.close();
  }

  markDriverBriefed(): void {
    this.driverBriefed = true;
    this.savePackageProgress();
  }

  markWaybillRead(): void {
    if (this.waybillRead) return;
    this.waybillRead = true;
    this.savePackageProgress();
    this.opts.onPackageProgress?.();
  }

  markPackageReceived(): void {
    this.hasPackage = true;
    this.savePackageProgress();
    this.opts.onPackageProgress?.();
  }

  /** Сдать посылку водителю → complete API + финальный звонок. */
  async deliverPackageToDriver(): Promise<{ ok: boolean; line: string }> {
    if (!this.hasPackage || this.packageStatus !== "IN_PROGRESS") {
      return { ok: false, line: "Посылки пока нет." };
    }
    try {
      const res = await api.completeQuest(PACKAGE_QUEST.code, PACKAGE_QUEST.secretCode);
      this.opts.onBalance(res.bulbaCoinBalance);
      this.packageStatus = res.status;
      this.hasPackage = false;
      this.resetPackageProgress({ clearStorage: true });
      this.opts.onPackageProgress?.();
      if (res.status === "COMPLETED") {
        this.schedule("packageFinale", PACKAGE_QUEST.timings.finaleDelayMs);
      }
      return { ok: true, line: "" };
    } catch {
      return { ok: false, line: "Не удалось сдать посылку. Попробуй ещё раз." };
    }
  }

  private packageProgressKey(): string {
    const login = api.getLogin() ?? "_";
    return `bulba_quest_${PACKAGE_QUEST.code}_${login}`;
  }

  private savePackageProgress(): void {
    try {
      localStorage.setItem(
        this.packageProgressKey(),
        JSON.stringify({
          driverBriefed: this.driverBriefed,
          waybillRead: this.waybillRead,
          hasPackage: this.hasPackage,
        }),
      );
    } catch {
      /* ignore quota / private mode */
    }
  }

  private loadPackageProgress(): void {
    try {
      const raw = localStorage.getItem(this.packageProgressKey());
      if (!raw) return;
      const data = JSON.parse(raw) as {
        driverBriefed?: boolean;
        waybillRead?: boolean;
        hasPackage?: boolean;
      };
      this.driverBriefed = !!data.driverBriefed;
      this.waybillRead = !!data.waybillRead;
      this.hasPackage = !!data.hasPackage;
    } catch {
      /* ignore */
    }
    this.opts.onPackageProgress?.();
  }

  private resetPackageProgress(opts?: { clearStorage?: boolean }): void {
    this.driverBriefed = false;
    this.waybillRead = false;
    this.hasPackage = false;
    if (opts?.clearStorage) {
      try {
        localStorage.removeItem(this.packageProgressKey());
      } catch {
        /* ignore */
      }
    }
  }

  private anyCallBusy(): boolean {
    return this.fridgeCall.isBusy || this.packageCall.isBusy;
  }

  private schedule(kind: RingKind, delayMs: number): void {
    window.clearTimeout(this.timer);
    this.pendingKind = kind;
    this.timer = window.setTimeout(() => this.tryRing(kind), delayMs);
  }

  private tryRing(kind: RingKind): void {
    this.timer = 0;
    if (!this.started) return;
    if (kind.startsWith("fridge") && this.fridgeStatus === "COMPLETED") return;
    if (kind.startsWith("fridge") && this.fridgeStatus === "LOCKED") return;
    if (kind === "packageIntro" && this.packageStatus !== "AVAILABLE") return;
    if (kind === "packageFinale" && this.packageStatus !== "COMPLETED") return;

    if (this.phone.isOpen || this.anyCallBusy()) {
      this.schedule(kind, 5_000);
      return;
    }
    if (!this.opts.canRing()) {
      this.schedule(kind, 5_000);
      return;
    }
    this.pendingKind = kind;
    const caller =
      kind.startsWith("package") ? PACKAGE_QUEST.caller : FRIDGE_QUEST.caller;
    this.phone.showIncoming(caller);
  }

  private acceptIncoming(): void {
    const kind =
      this.pendingKind ??
      (this.fridgeStatus === "IN_PROGRESS"
        ? "fridgeStatus"
        : this.packageStatus === "AVAILABLE"
          ? "packageIntro"
          : "fridgeIntro");
    this.pendingKind = null;
    this.phone.showCall();
    const login = api.getLogin() ?? "Игрок";

    if (kind === "fridgeIntro" && this.fridgeStatus === "AVAILABLE") {
      this.fridgeCall.startBriefing(login);
      return;
    }
    if (kind === "fridgeStatus") {
      this.fridgeCall.startStatus();
      return;
    }
    if (kind === "packageIntro") {
      this.packageCall.startBriefing(login);
      return;
    }
    if (kind === "packageFinale") {
      this.packageCall.startFinale();
    }
  }

  private declineIncoming(): void {
    this.phone.close();
    const kind = this.pendingKind;
    this.pendingKind = null;
    if (kind === "fridgeStatus" || this.fridgeStatus === "IN_PROGRESS") {
      this.schedule("fridgeStatus", FRIDGE_QUEST.timings.statusIntervalMs);
      return;
    }
    if (kind === "packageFinale") {
      this.schedule("packageFinale", PACKAGE_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "packageIntro" || this.packageStatus === "AVAILABLE") {
      this.schedule("packageIntro", PACKAGE_QUEST.timings.declineRetryMs);
      return;
    }
    this.schedule("fridgeIntro", FRIDGE_QUEST.timings.declineRetryMs);
  }

  private hangup(): void {
    if (!this.phone.isOpen) return;
    if (this.phone.mode() === "incoming") {
      this.declineIncoming();
      return;
    }
    if (this.fridgeCall.isEnded) {
      this.fridgeCall.dismissEnded();
      return;
    }
    if (this.packageCall.isEnded) {
      this.packageCall.dismissEnded();
      return;
    }
    if (this.fridgeCall.isBusy) {
      this.fridgeCall.hangupByPlayer();
      if (this.phone.isOpen) this.phone.close();
      return;
    }
    if (this.packageCall.isBusy) {
      this.packageCall.hangupByPlayer();
      if (this.phone.isOpen) this.phone.close();
    }
  }

  private async afterFridgeBriefingAccepted(): Promise<void> {
    try {
      const res = await api.startQuest(FRIDGE_QUEST.code);
      this.fridgeStatus = res.status;
    } catch (e) {
      console.error("Не удалось стартовать квест:", e);
      this.fridgeStatus = "IN_PROGRESS";
    }
  }

  private afterFridgeBriefingCallEnded(): void {
    if (this.fridgeStatus === "COMPLETED") return;
    if (this.fridgeStatus !== "IN_PROGRESS") this.fridgeStatus = "IN_PROGRESS";
    this.schedule("fridgeStatus", FRIDGE_QUEST.timings.statusIntervalMs);
  }

  private afterFridgeBriefingAbort(): void {
    this.phone.close();
    this.fridgeStatus = "AVAILABLE";
    this.ensureRingScheduled();
  }

  private afterFridgeStatusRemoteHangup(): void {
    if (this.fridgeStatus === "COMPLETED") return;
    this.schedule("fridgeStatus", FRIDGE_QUEST.timings.statusIntervalMs);
  }

  private afterFridgeStatusAbort(): void {
    this.phone.close();
    if (this.fridgeStatus === "COMPLETED") return;
    this.schedule("fridgeStatus", FRIDGE_QUEST.timings.statusIntervalMs);
  }

  private async submitFridgePin(pin: string): Promise<boolean> {
    try {
      const res = await api.completeQuest(FRIDGE_QUEST.code, pin);
      this.opts.onBalance(res.bulbaCoinBalance);
      this.fridgeStatus = res.status;
      return res.status === "COMPLETED";
    } catch {
      return false;
    }
  }

  private afterFridgeQuestCompleted(): void {
    this.fridgeStatus = "COMPLETED";
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.pendingKind = null;
    // После холодильника мог открыться второй квест.
    void this.refreshFromServer();
  }

  private async afterPackageBriefingAccepted(): Promise<void> {
    try {
      const res = await api.startQuest(PACKAGE_QUEST.code);
      this.packageStatus = res.status;
    } catch (e) {
      console.error("Не удалось стартовать квест посылки:", e);
      this.packageStatus = "IN_PROGRESS";
    }
  }

  private afterPackageBriefingCallEnded(): void {
    if (this.packageStatus !== "IN_PROGRESS") this.packageStatus = "IN_PROGRESS";
    this.opts.onPackageProgress?.();
  }

  private afterPackageBriefingAbort(): void {
    this.phone.close();
    this.packageStatus = "AVAILABLE";
    this.ensureRingScheduled();
  }

  private afterPackageFinaleComplete(): void {
    // already COMPLETED
  }

  private afterPackageFinaleAbort(): void {
    this.phone.close();
    // Финал уже после COMPLETED — перезвоним ещё раз мягко.
    this.schedule("packageFinale", PACKAGE_QUEST.timings.finaleDelayMs);
  }

  private afterDismissEnded(): void {
    this.phone.close();
    this.ensureRingScheduled();
  }
}

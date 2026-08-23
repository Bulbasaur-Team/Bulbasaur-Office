import * as api from "../net/api";
import { FRIDGE_QUEST, type QuestApiStatus } from "../data/quests";
import { ALERT_QUEST } from "../data/alertQuest";
import { PACKAGE_QUEST } from "../data/packageQuest";
import { ADAPTATION_QUEST, PROLOGUE_QUEST } from "../data/prologue";
import { STRATEGY_QUEST } from "../data/strategyQuest";
import { RECONCILIATION_QUEST } from "../data/reconciliationQuest";
import { PRESENTATION_QUEST } from "../data/presentationQuest";
import { QUANTUM_QUEST } from "../data/quantumQuest";
import { DAY_X_QUEST } from "../data/dayXQuest";
import { type StoryHintProgress } from "../data/storyGates";
import { PHONE_CONTACTS, callerOf, type PhoneContactId } from "../data/phoneContacts";
import {
  adaptationScript,
  dayXFinaleScript,
  dayXIntroScript,
  presentationScript,
  quantumFinaleScript,
  quantumIntroScript,
  reconciliationScript,
  scriptFor,
  strategyScript,
  welcomeScript,
  type PhoneStage,
} from "../data/phoneScripts";
import type { PresentationMeeting } from "./BulbaTalk";
import type { PresentationDesktop } from "./PresentationApp";
import { publicPath } from "../publicPath";
import { BulbaPhone, type PhoneCaller } from "./BulbaPhone";
import { IncomingCallPopup } from "./IncomingCallPopup";
import { PhoneDialogue } from "./PhoneDialogue";
import { QuestCall } from "./QuestCall";
import { AlertQuestCall } from "./AlertQuestCall";
import { PackageQuestCall } from "./PackageQuestCall";
import { dialTone } from "./DialTone";
import type { KeyConsumer } from "./KeyboardRouter";

type RingKind =
  | "prologueIntro"
  | "adaptationIntro"
  | "fridgeIntro"
  | "fridgeStatus"
  | "greenAlertIntro"
  | "greenAlertWork"
  | "packageIntro"
  | "packageFinale"
  | "packagePeekFail"
  | "strategyIntro"
  | "reconciliationIntro"
  | "presentationIntro"
  | "quantumIntro"
  | "quantumFinale"
  | "dayXIntro"
  | "dayXFinale";

type ActiveScript =
  | "welcome"
  | "adaptation"
  | "strategy"
  | "audit"
  | "presentation"
  | "quantum"
  | "quantumFinale"
  | "dayX"
  | "dayXFinale"
  | "outgoing";

const OUTGOING_CONNECT_MIN_MS = 3_000;
const OUTGOING_CONNECT_MAX_MS = 5_000;

interface QuestControllerOpts {
  onBalance: (balance: number) => void;
  /** Можно ли сейчас показывать входящий (нет других модалок). */
  canRing: () => boolean;
  /** Локальный прогресс посылки сброшен / обновлён — сцена может переспавнить NPC. */
  onPackageProgress?: () => void;
  /** Статусы квестов обновились с сервера. */
  onQuestsChanged?: () => void;
  /** Игрок заглянул в коробку — откат на пляж. */
  onPackagePeekFailed?: () => void;
}

/**
 * Сюжет и Bulba-Phone: пролог, адаптация, fridge_pin, green_alert, lost_package, strategy,
 * reconciliation, presentation, quantum, day_x, справочник.
 */
export class QuestController implements KeyConsumer {
  private phone: BulbaPhone;
  private incoming: IncomingCallPopup;
  private dialogue: PhoneDialogue;
  private fridgeCall: QuestCall;
  private alertCall: AlertQuestCall;
  private packageCall: PackageQuestCall;

  private prologueStatus: QuestApiStatus = "LOCKED";
  private adaptationStatus: QuestApiStatus = "LOCKED";
  private strategyStatus: QuestApiStatus = "LOCKED";
  private reconciliationStatus: QuestApiStatus = "LOCKED";
  private presentationStatus: QuestApiStatus = "LOCKED";
  private quantumStatus: QuestApiStatus = "LOCKED";
  private dayXStatus: QuestApiStatus = "LOCKED";
  private fridgeStatus: QuestApiStatus = "LOCKED";
  private greenAlertStatus: QuestApiStatus = "LOCKED";
  private packageStatus: QuestApiStatus = "LOCKED";

  private timer = 0;
  private connectTimer = 0;
  private pendingKind: RingKind | null = null;
  private started = false;
  private laptopOpened = false;
  private outgoing = false;
  private activeScript: ActiveScript | null = null;
  private lastContact: PhoneContactId | null = null;
  private incomingCaller: PhoneCaller | null = null;
  private againKeys = new Set<string>();

  /** Клиентский прогресс lost_package (персистится в localStorage на время IN_PROGRESS). */
  private driverBriefed = false;
  private waybillRead = false;
  private hasPackage = false;
  private codeAccepted = false;
  /** Заглянул в коробку — нельзя сдать, ждём звонок / откат. */
  private peeked = false;

  private presentationDiy = false;
  private presentationDiyShown = false;
  private presentationClaudePaid = false;
  /** Включённые слайды в порядке показа (то, что видит начальник). */
  private presentationDeck: string[] = [];
  /** Полный порядок всех карточек в UI сборки (вкл. скрытые). */
  private presentationDeckOrder: string[] = [];

  constructor(private opts: QuestControllerOpts) {
    this.phone = new BulbaPhone({
      onAccept: () => this.acceptIncoming(),
      onDecline: () => this.declineIncoming(),
      onHangup: () => this.hangup(),
      onBackToContacts: () => this.backToContacts(),
    });
    this.incoming = new IncomingCallPopup({
      onAccept: () => this.acceptIncoming(),
      onDecline: () => this.declineIncoming(),
    });
    this.dialogue = new PhoneDialogue({
      onRemoteHangup: () => this.afterScriptRemoteHangup(),
      onAbort: () => this.afterScriptAbort(),
      onDismissEnded: () => this.afterDismissEnded(),
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
    this.alertCall = new AlertQuestCall({
      onBriefingAccepted: () => void this.afterGreenAlertAccepted(),
      onBriefingComplete: () => this.afterGreenAlertBriefingEnded(),
      onBriefingAbort: () => this.afterGreenAlertBriefingAbort(),
      onWorkRemoteHangup: () => this.afterGreenAlertWorkHangup(),
      onWorkAbort: () => this.afterGreenAlertWorkAbort(),
      onSubmitGreen: () => this.submitGreenAlert(),
      onQuestCompleted: () => this.afterGreenAlertCompleted(),
      onDismissEnded: () => this.afterDismissEnded(),
    });
    this.packageCall = new PackageQuestCall({
      onBriefingAccepted: () => void this.afterPackageBriefingAccepted(),
      onBriefingComplete: () => this.afterPackageBriefingCallEnded(),
      onBriefingAbort: () => this.afterPackageBriefingAbort(),
      onFinaleComplete: () => this.afterPackageFinaleComplete(),
      onFinaleAbort: () => this.afterPackageFinaleAbort(),
      onPeekFailComplete: () => this.afterPackagePeekFail(),
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

  get strategyQuestStatus(): QuestApiStatus {
    return this.strategyStatus;
  }

  get strategyInProgress(): boolean {
    return this.strategyStatus === "IN_PROGRESS";
  }

  get presentationInProgress(): boolean {
    return this.presentationStatus === "IN_PROGRESS";
  }

  get quantumQuizAvailable(): boolean {
    return this.quantumStatus === "IN_PROGRESS";
  }

  /** Зал Дня X в меню парковки — только пока квест активен. */
  get dayXInProgress(): boolean {
    return this.dayXStatus === "IN_PROGRESS";
  }

  async completeQuantumQuiz(): Promise<void> {
    if (this.quantumStatus === "COMPLETED") {
      this.schedule("quantumFinale", QUANTUM_QUEST.timings.finaleDelayMs);
      return;
    }
    if (this.quantumStatus !== "IN_PROGRESS") return;
    this.quantumStatus = "COMPLETED";
    this.opts.onQuestsChanged?.();
    try {
      const res = await api.completeQuest(QUANTUM_QUEST.code);
      this.quantumStatus = res.status;
    } catch (e) {
      console.error("Не удалось закрыть квест квантовой физики:", e);
      this.quantumStatus = "COMPLETED";
    }
    this.opts.onQuestsChanged?.();
    this.schedule("quantumFinale", QUANTUM_QUEST.timings.finaleDelayMs);
    void this.refreshFromServer();
  }

  presentationLaptop(): PresentationDesktop & {
    meeting: PresentationMeeting;
    needsClaudePay: () => boolean;
    payClaude: () => Promise<{ ok: boolean; message?: string }>;
    onClaudeReady: () => void;
  } {
    return {
      visible: () => this.presentationStatus === "IN_PROGRESS",
      diyMade: () => this.presentationDiy,
      claudePaid: () => this.presentationClaudePaid,
      makeDiy: () => this.markPresentationDiy(),
      meeting: {
        active: () => this.presentationStatus === "IN_PROGRESS",
        diyMade: () => this.presentationDiy,
        diyShown: () => this.presentationDiyShown,
        claudePaid: () => this.presentationClaudePaid,
        accepted: () => this.presentationStatus === "COMPLETED",
        deck: () => this.presentationDeck,
        setDeck: (ids) => {
          this.presentationDeck = ids;
          this.savePresentationProgress();
        },
        deckOrder: () => this.presentationDeckOrder,
        setDeckOrder: (ids) => {
          this.presentationDeckOrder = ids;
          this.savePresentationProgress();
        },
        onDiyShown: () => this.markPresentationDiyShown(),
        onAccepted: () => this.completePresentation(),
      },
      needsClaudePay: () =>
        this.presentationStatus === "IN_PROGRESS"
        && this.presentationDiyShown
        && !this.presentationClaudePaid,
      payClaude: () => this.payPresentationClaude(),
      onClaudeReady: () => {
        this.presentationClaudePaid = true;
        this.savePresentationProgress();
        this.opts.onQuestsChanged?.();
      },
    };
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

  get packageCodeAccepted(): boolean {
    return this.codeAccepted;
  }

  storyHintProgress(): StoryHintProgress {
    return {
      packageDriverBriefed: this.driverBriefed,
      packageWaybillRead: this.waybillRead,
      packageHasItem: this.hasPackage,
      presentationDiy: this.presentationDiy,
      presentationDiyShown: this.presentationDiyShown,
      presentationClaudePaid: this.presentationClaudePaid,
    };
  }

  isActive(): boolean {
    return this.phone.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (this.alertCall.handleKey(e)) return true;
    return this.phone.handleKey(e);
  }

  async start(): Promise<void> {
    this.stop();
    this.started = true;
    this.laptopOpened = this.loadLaptopOpened();
    this.loadAgainKeys();
    this.showPhoneBtn(true);
    await this.refreshFromServer({ initial: true });
  }

  openDirectory(): void {
    if (!this.started) return;
    if (this.anyCallBusy()) return;
    window.clearTimeout(this.connectTimer);
    dialTone.stop();
    this.phone.showConnected();
    this.outgoing = false;
    this.activeScript = null;
    this.phone.showHome();
    this.renderContacts();
  }

  markLaptopOpened(): void {
    if (this.laptopOpened) return;
    this.laptopOpened = true;
    this.saveLaptopOpened();
    if (this.phone.mode() === "home") this.renderContacts();
  }

  async refreshFromServer(opts?: { initial?: boolean }): Promise<void> {
    if (!this.started) return;
    const prevFridge = this.fridgeStatus;
    const prevGreenAlert = this.greenAlertStatus;
    const prevPackage = this.packageStatus;
    const prevPrologue = this.prologueStatus;
    const prevAdaptation = this.adaptationStatus;
    const prevStrategy = this.strategyStatus;
    const prevReconciliation = this.reconciliationStatus;
    const prevPresentation = this.presentationStatus;
    const prevQuantum = this.quantumStatus;
    const prevDayX = this.dayXStatus;
    try {
      const list = await api.fetchQuests();
      const nextPrologue = list.quests.find((q) => q.code === PROLOGUE_QUEST.code)?.status ?? "LOCKED";
      // Не откатываем локально закрытый пролог, пока сервер ещё не успел его провести.
      if (!(this.prologueStatus === "COMPLETED" && nextPrologue === "AVAILABLE")) {
        this.prologueStatus = nextPrologue;
      }
      this.adaptationStatus =
        list.quests.find((q) => q.code === ADAPTATION_QUEST.code)?.status ?? "LOCKED";
      this.fridgeStatus =
        list.quests.find((q) => q.code === FRIDGE_QUEST.code)?.status ?? "LOCKED";
      this.greenAlertStatus =
        list.quests.find((q) => q.code === ALERT_QUEST.code)?.status ?? "LOCKED";
      this.packageStatus =
        list.quests.find((q) => q.code === PACKAGE_QUEST.code)?.status ?? "LOCKED";
      this.strategyStatus =
        list.quests.find((q) => q.code === STRATEGY_QUEST.code)?.status ?? "LOCKED";
      this.reconciliationStatus =
        list.quests.find((q) => q.code === RECONCILIATION_QUEST.code)?.status ?? "LOCKED";
      this.presentationStatus =
        list.quests.find((q) => q.code === PRESENTATION_QUEST.code)?.status ?? "LOCKED";
      this.quantumStatus =
        list.quests.find((q) => q.code === QUANTUM_QUEST.code)?.status ?? "LOCKED";
      this.dayXStatus =
        list.quests.find((q) => q.code === DAY_X_QUEST.code)?.status ?? "LOCKED";
    } catch (e) {
      console.error("Не удалось загрузить квесты:", e);
      if (opts?.initial) {
        this.prologueStatus = "LOCKED";
        this.adaptationStatus = "LOCKED";
        this.fridgeStatus = "LOCKED";
        this.greenAlertStatus = "LOCKED";
        this.packageStatus = "LOCKED";
        this.strategyStatus = "LOCKED";
        this.reconciliationStatus = "LOCKED";
        this.presentationStatus = "LOCKED";
        this.quantumStatus = "LOCKED";
        this.dayXStatus = "LOCKED";
      }
      return;
    }
    if (!this.started) return;

    if (this.packageStatus === "IN_PROGRESS") {
      this.loadPackageProgress();
    } else {
      this.resetPackageProgress({ clearStorage: true });
    }

    if (this.presentationStatus === "IN_PROGRESS" || this.presentationStatus === "COMPLETED") {
      this.loadPresentationProgress();
      await this.refreshPresentationClaude();
      if (this.presentationStatus === "COMPLETED") {
        await this.refreshPresentationDeck();
      }
    } else {
      // AVAILABLE после удаления строки квеста из БД — иначе DIY/Claude
      // остаются в localStorage и выглядят «уже готовыми».
      this.resetPresentationProgress({ clearStorage: true });
    }

    if (
      this.fridgeStatus === "COMPLETED" &&
      this.greenAlertStatus === "COMPLETED" &&
      this.packageStatus === "COMPLETED" &&
      this.strategyStatus === "COMPLETED" &&
      this.reconciliationStatus === "COMPLETED" &&
      this.presentationStatus === "COMPLETED" &&
      this.quantumStatus === "COMPLETED" &&
      this.dayXStatus === "COMPLETED"
    ) {
      this.opts.onQuestsChanged?.();
      if (
        this.pendingKind === "packageFinale" ||
        this.pendingKind === "quantumFinale" ||
        this.pendingKind === "dayXFinale" ||
        this.packageCall.isBusy ||
        this.alertCall.isBusy ||
        this.phone.isOpen
      ) {
        return;
      }
      window.clearTimeout(this.timer);
      this.timer = 0;
      this.pendingKind = null;
      return;
    }

    this.ensureRingScheduled({
      initial: !!opts?.initial,
      justFridgeUnlock: prevFridge === "LOCKED" && !opts?.initial,
      justGreenAlertUnlock: prevGreenAlert === "LOCKED" && !opts?.initial,
      justPackageUnlock: prevPackage === "LOCKED" && !opts?.initial,
      justPrologueUnlock: prevPrologue === "LOCKED" && !opts?.initial,
      justAdaptationUnlock: prevAdaptation === "LOCKED" && !opts?.initial,
      justStrategyUnlock: prevStrategy === "LOCKED" && !opts?.initial,
      justReconciliationUnlock: prevReconciliation === "LOCKED" && !opts?.initial,
      justPresentationUnlock: prevPresentation === "LOCKED" && !opts?.initial,
      justQuantumUnlock: prevQuantum === "LOCKED" && !opts?.initial,
      justDayXUnlock: prevDayX === "LOCKED" && !opts?.initial,
    });
    this.opts.onQuestsChanged?.();
  }

  /**
   * Поставить входящий в очередь, если квест доступен/в процессе и сейчас никто не говорит.
   */
  private ensureRingScheduled(opts?: {
    initial?: boolean;
    justFridgeUnlock?: boolean;
    justGreenAlertUnlock?: boolean;
    justPackageUnlock?: boolean;
    justPrologueUnlock?: boolean;
    justAdaptationUnlock?: boolean;
    justStrategyUnlock?: boolean;
    justReconciliationUnlock?: boolean;
    justPresentationUnlock?: boolean;
    justQuantumUnlock?: boolean;
    justDayXUnlock?: boolean;
  }): void {
    if (!this.started) return;
    if (this.anyCallBusy()) return;
    if (this.incoming.isOpen) return;
    if (this.phone.isOpen && this.phone.mode() !== "home") return;
    if (this.timer && this.pendingKind) return;

    if (this.packageStatus === "IN_PROGRESS" && this.peeked && this.hasPackage) {
      this.schedule("packagePeekFail", 800);
      return;
    }

    if (this.fridgeStatus === "IN_PROGRESS") {
      this.schedule("fridgeStatus", FRIDGE_QUEST.timings.statusIntervalMs);
      return;
    }

    if (this.greenAlertStatus === "IN_PROGRESS") {
      this.schedule("greenAlertWork", ALERT_QUEST.timings.statusIntervalMs);
      return;
    }

    if (this.prologueStatus === "AVAILABLE") {
      this.schedule(
        "prologueIntro",
        opts?.justPrologueUnlock ? 3_000 : PROLOGUE_QUEST.timings.introDelayMs,
      );
      return;
    }

    if (this.adaptationStatus === "AVAILABLE") {
      this.schedule(
        "adaptationIntro",
        opts?.justAdaptationUnlock ? 3_000 : ADAPTATION_QUEST.timings.introDelayMs,
      );
      return;
    }

    if (this.fridgeStatus === "AVAILABLE") {
      this.schedule(
        "fridgeIntro",
        opts?.justFridgeUnlock ? 3_000 : FRIDGE_QUEST.timings.introDelayMs,
      );
      return;
    }

    if (this.greenAlertStatus === "AVAILABLE" && this.packageStatus === "LOCKED") {
      this.schedule(
        "greenAlertIntro",
        opts?.justGreenAlertUnlock ? 3_000 : ALERT_QUEST.timings.introDelayMs,
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
      return;
    }

    if (this.strategyStatus === "AVAILABLE") {
      this.schedule(
        "strategyIntro",
        opts?.justStrategyUnlock ? 3_000 : STRATEGY_QUEST.timings.introDelayMs,
      );
      return;
    }

    if (this.reconciliationStatus === "AVAILABLE") {
      this.schedule(
        "reconciliationIntro",
        opts?.justReconciliationUnlock ? 3_000 : RECONCILIATION_QUEST.timings.introDelayMs,
      );
      return;
    }

    if (this.presentationStatus === "AVAILABLE") {
      this.schedule(
        "presentationIntro",
        opts?.justPresentationUnlock ? 3_000 : PRESENTATION_QUEST.timings.introDelayMs,
      );
      return;
    }

    if (this.quantumStatus === "AVAILABLE") {
      this.schedule(
        "quantumIntro",
        opts?.justQuantumUnlock ? 3_000 : QUANTUM_QUEST.timings.introDelayMs,
      );
      return;
    }

    if (this.dayXStatus === "AVAILABLE") {
      this.schedule(
        "dayXIntro",
        opts?.justDayXUnlock ? 3_000 : DAY_X_QUEST.timings.introDelayMs,
      );
    }
  }

  stop(): void {
    this.started = false;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.connectTimer);
    this.timer = 0;
    this.connectTimer = 0;
    dialTone.stop();
    this.pendingKind = null;
    this.outgoing = false;
    this.activeScript = null;
    this.incomingCaller = null;
    this.driverBriefed = false;
    this.waybillRead = false;
    this.hasPackage = false;
    this.dialogue.stop();
    this.fridgeCall.stop();
    this.alertCall.stop();
    this.packageCall.stop();
    this.stopRinging();
    this.phone.close();
    this.showPhoneBtn(false);
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

  markPackageCodeAccepted(): void {
    this.codeAccepted = true;
    this.savePackageProgress();
  }

  startPeekFailCall(): void {
    this.peeked = true;
    this.savePackageProgress();
    this.schedule("packagePeekFail", 600);
  }

  rollbackPackagePeek(): void {
    this.hasPackage = false;
    this.peeked = false;
    this.codeAccepted = true;
    this.savePackageProgress();
    this.opts.onPackageProgress?.();
  }

  /** Сдать посылку водителю → complete API + финальный звонок. */
  async deliverPackageToDriver(): Promise<{ ok: boolean; line: string }> {
    if (this.peeked) {
      return { ok: false, line: "Содержимое раскрыто — так посылку уже не сдать." };
    }
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

  private phoneStage(): PhoneStage {
    if (this.dayXStatus === "COMPLETED") return "epilogue";
    if (this.dayXStatus === "AVAILABLE" || this.dayXStatus === "IN_PROGRESS") return "dayX";
    if (this.quantumStatus === "COMPLETED") return "postQuantum";
    if (this.quantumStatus === "AVAILABLE" || this.quantumStatus === "IN_PROGRESS") return "quantum";
    if (this.presentationStatus === "COMPLETED") return "postPresentation";
    if (this.presentationStatus === "AVAILABLE" || this.presentationStatus === "IN_PROGRESS") {
      return "presentation";
    }
    if (this.strategyStatus === "IN_PROGRESS") return "strategy";
    if (this.strategyStatus === "COMPLETED") return "audit";
    if (this.packageStatus === "IN_PROGRESS") return "package";
    if (this.greenAlertStatus === "AVAILABLE" || this.greenAlertStatus === "IN_PROGRESS") {
      return "greenAlert";
    }
    if (this.fridgeStatus === "IN_PROGRESS") return "fridge";
    if (this.adaptationStatus === "AVAILABLE" || this.adaptationStatus === "COMPLETED") {
      return "adapted";
    }
    return "prologue";
  }

  private renderContacts(): void {
    const list = document.getElementById("bpContacts");
    if (!list) return;
    list.replaceChildren();
    for (const contact of PHONE_CONTACTS) {
      if (contact.requiresLaptop && !this.laptopOpened) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bp-contact";
      if (contact.photo) {
        const img = document.createElement("img");
        img.className = "bp-contact-avatar";
        img.src = publicPath(contact.photo);
        img.alt = "";
        img.draggable = false;
        btn.appendChild(img);
      } else {
        const letter = document.createElement("div");
        letter.className = "bp-contact-letter";
        letter.textContent = contact.letter ?? contact.name.slice(0, 1);
        btn.appendChild(letter);
      }
      const meta = document.createElement("div");
      meta.className = "bp-contact-meta";
      const name = document.createElement("div");
      name.className = "bp-contact-name";
      name.textContent = contact.name;
      const role = document.createElement("div");
      role.className = "bp-contact-role";
      role.textContent = contact.role;
      meta.append(name, role);
      btn.appendChild(meta);
      btn.onclick = () => this.startOutgoing(contact.id);
      list.appendChild(btn);
    }
  }

  private startOutgoing(id: PhoneContactId): void {
    if (this.anyCallBusy() || this.phone.mode() !== "home") return;
    this.outgoing = true;
    this.activeScript = "outgoing";
    this.lastContact = id;
    this.pendingKind = null;
    const caller = callerOf(id);
    this.phone.setCaller(caller);
    this.phone.showCall();
    this.phone.showDialing();
    dialTone.start();
    const login = api.getLogin() ?? "Игрок";
    const delay = this.outgoingConnectDelay();

    if (id === "bulbov" && this.fridgeStatus === "IN_PROGRESS") {
      this.connectTimer = window.setTimeout(() => {
        this.connectTimer = 0;
        this.phone.showConnected();
        dialTone.stop();
        this.fridgeCall.startStatus();
      }, delay);
      return;
    }

    if (id === "bulbatech" && this.greenAlertStatus === "IN_PROGRESS") {
      this.connectTimer = window.setTimeout(() => {
        this.connectTimer = 0;
        this.phone.showConnected();
        dialTone.stop();
        this.alertCall.startWork();
      }, delay);
      return;
    }

    const stage = this.phoneStage();
    const script = scriptFor(id, stage);
    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = 0;
      this.phone.showConnected();
      dialTone.stop();
      const again = this.hasTalked(id, stage);
      this.markTalked(id, stage);
      this.dialogue.start(script, login, id, { again });
    }, delay);
  }

  private outgoingConnectDelay(): number {
    return Math.round(OUTGOING_CONNECT_MIN_MS + Math.random() * (OUTGOING_CONNECT_MAX_MS - OUTGOING_CONNECT_MIN_MS));
  }

  private packageProgressKey(): string {
    const login = api.getLogin() ?? "_";
    return `bulba_quest_${PACKAGE_QUEST.code}_${login}`;
  }

  private laptopKey(): string {
    return `bulba_laptop_opened_${api.getLogin() ?? "_"}`;
  }

  private againKey(): string {
    return `bulba_phone_again_${api.getLogin() ?? "_"}`;
  }

  /** Пролог и адаптация — один справочник; fridge/package меняют скрипты. */
  private againBucket(stage: PhoneStage): string {
    return stage === "prologue" || stage === "adapted" ? "main" : stage;
  }

  private talkedKey(id: PhoneContactId, stage: PhoneStage): string {
    return `${id}:${this.againBucket(stage)}`;
  }

  private hasTalked(id: PhoneContactId, stage: PhoneStage): boolean {
    if (this.againKeys.has(this.talkedKey(id, stage))) return true;
    if (stage === "prologue" || stage === "adapted") {
      return this.againKeys.has(`${id}:prologue`) || this.againKeys.has(`${id}:adapted`);
    }
    return this.againKeys.has(`${id}:${stage}`);
  }

  private markTalked(id: PhoneContactId, stage: PhoneStage): void {
    this.againKeys.add(this.talkedKey(id, stage));
    this.saveAgainKeys();
  }

  private loadLaptopOpened(): boolean {
    try {
      return localStorage.getItem(this.laptopKey()) === "1";
    } catch {
      return false;
    }
  }

  private saveLaptopOpened(): void {
    try {
      localStorage.setItem(this.laptopKey(), "1");
    } catch {
      /* ignore */
    }
  }

  private loadAgainKeys(): void {
    this.againKeys.clear();
    try {
      const raw = localStorage.getItem(this.againKey());
      if (!raw) return;
      const data = JSON.parse(raw) as string[];
      if (Array.isArray(data)) data.forEach((k) => this.againKeys.add(k));
    } catch {
      /* ignore */
    }
  }

  private saveAgainKeys(): void {
    try {
      localStorage.setItem(this.againKey(), JSON.stringify([...this.againKeys]));
    } catch {
      /* ignore */
    }
  }

  private savePackageProgress(): void {
    try {
      localStorage.setItem(
        this.packageProgressKey(),
        JSON.stringify({
          driverBriefed: this.driverBriefed,
          waybillRead: this.waybillRead,
          hasPackage: this.hasPackage,
          codeAccepted: this.codeAccepted,
          peeked: this.peeked,
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
        codeAccepted?: boolean;
        peeked?: boolean;
      };
      this.driverBriefed = !!data.driverBriefed;
      this.waybillRead = !!data.waybillRead;
      this.hasPackage = !!data.hasPackage;
      this.codeAccepted = !!data.codeAccepted;
      this.peeked = !!data.peeked;
    } catch {
      /* ignore */
    }
    this.opts.onPackageProgress?.();
  }

  private resetPackageProgress(opts?: { clearStorage?: boolean }): void {
    this.driverBriefed = false;
    this.waybillRead = false;
    this.hasPackage = false;
    this.codeAccepted = false;
    this.peeked = false;
    if (opts?.clearStorage) {
      try {
        localStorage.removeItem(this.packageProgressKey());
      } catch {
        /* ignore */
      }
    }
  }

  private anyCallBusy(): boolean {
    return this.connectTimer !== 0 || this.fridgeCall.isBusy || this.alertCall.isBusy || this.packageCall.isBusy || this.dialogue.isBusy;
  }

  private showPhoneBtn(show: boolean): void {
    document.getElementById("phoneBtn")?.classList.toggle("hidden", !show);
  }

  private stopRinging(): void {
    this.incoming.hide();
  }

  private schedule(kind: RingKind, delayMs: number): void {
    window.clearTimeout(this.timer);
    this.pendingKind = kind;
    this.timer = window.setTimeout(() => this.tryRing(kind), delayMs);
  }

  private tryRing(kind: RingKind): void {
    this.timer = 0;
    if (!this.started) return;
    if (kind === "prologueIntro" && this.prologueStatus !== "AVAILABLE") return;
    if (kind === "adaptationIntro" && this.adaptationStatus !== "AVAILABLE") return;
    if (kind.startsWith("fridge") && this.fridgeStatus === "COMPLETED") return;
    if (kind.startsWith("fridge") && this.fridgeStatus === "LOCKED") return;
    if (kind.startsWith("greenAlert") && this.greenAlertStatus === "COMPLETED") return;
    if (kind === "greenAlertIntro" && this.greenAlertStatus !== "AVAILABLE") return;
    if (kind === "greenAlertWork" && this.greenAlertStatus !== "IN_PROGRESS") return;
    if (kind === "packageIntro" && this.packageStatus !== "AVAILABLE") return;
    if (kind === "packageFinale" && this.packageStatus !== "COMPLETED") return;
    if (kind === "packagePeekFail" && this.packageStatus !== "IN_PROGRESS") return;
    if (kind === "strategyIntro" && this.strategyStatus !== "AVAILABLE") return;
    if (kind === "reconciliationIntro" && this.reconciliationStatus !== "AVAILABLE") return;
    if (kind === "presentationIntro" && this.presentationStatus !== "AVAILABLE") return;
    if (kind === "quantumIntro" && this.quantumStatus !== "AVAILABLE") return;
    if (kind === "quantumFinale" && this.quantumStatus !== "COMPLETED") return;
    if (kind === "dayXIntro" && this.dayXStatus !== "AVAILABLE") return;
    if (kind === "dayXFinale" && this.dayXStatus !== "COMPLETED") return;

    if (this.anyCallBusy() || this.incoming.isOpen || (this.phone.isOpen && this.phone.mode() === "call")) {
      this.schedule(kind, 5_000);
      return;
    }
    if (!this.opts.canRing()) {
      this.schedule(kind, 5_000);
      return;
    }
    this.pendingKind = kind;
    this.outgoing = false;
    const caller =
      kind === "quantumIntro" || kind === "quantumFinale"
        ? QUANTUM_QUEST.caller
        : kind === "dayXIntro" || kind === "dayXFinale"
        ? DAY_X_QUEST.caller
        : kind === "presentationIntro"
        ? PRESENTATION_QUEST.caller
        : kind === "reconciliationIntro"
        ? RECONCILIATION_QUEST.caller
        : kind === "prologueIntro" || kind === "adaptationIntro" || kind === "strategyIntro"
          ? PROLOGUE_QUEST.caller
          : kind.startsWith("greenAlert")
            ? ALERT_QUEST.caller
          : kind.startsWith("package")
            ? PACKAGE_QUEST.caller
            : FRIDGE_QUEST.caller;
    this.incomingCaller = caller;
    this.incoming.show(caller);
  }

  private acceptIncoming(): void {
    const kind =
      this.pendingKind ??
      (this.fridgeStatus === "IN_PROGRESS"
        ? "fridgeStatus"
        : this.greenAlertStatus === "IN_PROGRESS"
          ? "greenAlertWork"
        : this.prologueStatus === "AVAILABLE"
          ? "prologueIntro"
          : this.adaptationStatus === "AVAILABLE"
            ? "adaptationIntro"
            : this.strategyStatus === "AVAILABLE"
              ? "strategyIntro"
              : this.presentationStatus === "AVAILABLE"
                ? "presentationIntro"
              : this.quantumStatus === "AVAILABLE"
                ? "quantumIntro"
              : this.dayXStatus === "AVAILABLE"
                ? "dayXIntro"
              : this.reconciliationStatus === "AVAILABLE"
                ? "reconciliationIntro"
            : this.packageStatus === "AVAILABLE"
              ? "packageIntro"
              : this.greenAlertStatus === "AVAILABLE"
                ? "greenAlertIntro"
              : "fridgeIntro");
    this.pendingKind = null;
    this.outgoing = false;
    this.stopRinging();
    if (this.incomingCaller) this.phone.setCaller(this.incomingCaller);
    this.phone.showCall();
    const login = api.getLogin() ?? "Игрок";

    if (kind === "prologueIntro" && this.prologueStatus === "AVAILABLE") {
      this.activeScript = "welcome";
      this.lastContact = "hr";
      this.dialogue.start(welcomeScript(), login, "hr");
      return;
    }
    if (kind === "adaptationIntro" && this.adaptationStatus === "AVAILABLE") {
      this.activeScript = "adaptation";
      this.lastContact = "hr";
      this.dialogue.start(adaptationScript(), login, "hr");
      return;
    }
    if (kind === "strategyIntro" && this.strategyStatus === "AVAILABLE") {
      this.activeScript = "strategy";
      this.lastContact = "hr";
      this.dialogue.start(strategyScript(), login, "hr");
      return;
    }
    if (kind === "reconciliationIntro" && this.reconciliationStatus === "AVAILABLE") {
      this.activeScript = "audit";
      this.lastContact = "accountant";
      this.dialogue.start(reconciliationScript(), login, "accountant");
      return;
    }
    if (kind === "presentationIntro" && this.presentationStatus === "AVAILABLE") {
      this.activeScript = "presentation";
      this.lastContact = "bulbul";
      this.dialogue.start(presentationScript(), login, "bulbul");
      return;
    }
    if (kind === "quantumIntro" && this.quantumStatus === "AVAILABLE") {
      this.activeScript = "quantum";
      this.lastContact = "bulbatech";
      this.dialogue.start(quantumIntroScript(), login, "bulbatech");
      return;
    }
    if (kind === "quantumFinale" && this.quantumStatus === "COMPLETED") {
      this.activeScript = "quantumFinale";
      this.lastContact = "bulbatech";
      this.dialogue.start(quantumFinaleScript(), login, "bulbatech");
      return;
    }
    if (kind === "dayXIntro" && this.dayXStatus === "AVAILABLE") {
      this.activeScript = "dayX";
      this.lastContact = "bulbov";
      this.dialogue.start(dayXIntroScript(), login, "bulbov");
      return;
    }
    if (kind === "dayXFinale" && this.dayXStatus === "COMPLETED") {
      this.activeScript = "dayXFinale";
      this.lastContact = "bulbov";
      this.dialogue.start(dayXFinaleScript(), login, "bulbov");
      return;
    }
    if (kind === "fridgeIntro" && this.fridgeStatus === "AVAILABLE") {
      this.fridgeCall.startBriefing(login);
      return;
    }
    if (kind === "fridgeStatus") {
      this.fridgeCall.startStatus();
      return;
    }
    if (kind === "greenAlertIntro" && this.greenAlertStatus === "AVAILABLE") {
      this.lastContact = "bulbatech";
      this.alertCall.startBriefing(login);
      return;
    }
    if (kind === "greenAlertWork") {
      this.lastContact = "bulbatech";
      this.alertCall.startWork();
      return;
    }
    if (kind === "packageIntro") {
      this.packageCall.startBriefing(login);
      return;
    }
    if (kind === "packageFinale") {
      this.packageCall.startFinale();
      return;
    }
    if (kind === "packagePeekFail") {
      this.packageCall.startPeekFail();
    }
  }

  private declineIncoming(): void {
    this.stopRinging();
    this.incomingCaller = null;
    const kind = this.pendingKind;
    this.pendingKind = null;
    if (kind === "fridgeStatus" || this.fridgeStatus === "IN_PROGRESS") {
      this.schedule("fridgeStatus", FRIDGE_QUEST.timings.statusIntervalMs);
      return;
    }
    if (kind === "greenAlertWork" || this.greenAlertStatus === "IN_PROGRESS") {
      this.schedule("greenAlertWork", ALERT_QUEST.timings.statusIntervalMs);
      return;
    }
    if (kind === "greenAlertIntro" || this.greenAlertStatus === "AVAILABLE") {
      this.schedule("greenAlertIntro", ALERT_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "packageFinale") {
      this.schedule("packageFinale", PACKAGE_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "packagePeekFail") {
      this.schedule("packagePeekFail", 4_000);
      return;
    }
    if (kind === "packageIntro" || this.packageStatus === "AVAILABLE") {
      this.schedule("packageIntro", PACKAGE_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "adaptationIntro" || this.adaptationStatus === "AVAILABLE") {
      this.schedule("adaptationIntro", ADAPTATION_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "strategyIntro" || this.strategyStatus === "AVAILABLE") {
      this.schedule("strategyIntro", STRATEGY_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "reconciliationIntro" || this.reconciliationStatus === "AVAILABLE") {
      this.schedule("reconciliationIntro", RECONCILIATION_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "presentationIntro" || this.presentationStatus === "AVAILABLE") {
      this.schedule("presentationIntro", PRESENTATION_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "quantumIntro" || this.quantumStatus === "AVAILABLE") {
      this.schedule("quantumIntro", QUANTUM_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "quantumFinale") {
      this.schedule("quantumFinale", QUANTUM_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "dayXIntro" || this.dayXStatus === "AVAILABLE") {
      this.schedule("dayXIntro", DAY_X_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "dayXFinale") {
      this.schedule("dayXFinale", DAY_X_QUEST.timings.declineRetryMs);
      return;
    }
    if (kind === "prologueIntro" || this.prologueStatus === "AVAILABLE") {
      this.schedule("prologueIntro", PROLOGUE_QUEST.timings.declineRetryMs);
      return;
    }
    this.schedule("fridgeIntro", FRIDGE_QUEST.timings.declineRetryMs);
  }

  private hangup(): void {
    if (!this.phone.isOpen) return;
    if (this.phone.mode() === "home") {
      this.phone.close();
      this.ensureRingScheduled();
      return;
    }
    if (this.phone.mode() === "incoming") {
      this.declineIncoming();
      return;
    }
    window.clearTimeout(this.connectTimer);
    this.connectTimer = 0;
    this.phone.showConnected();
    dialTone.stop();
    if (this.dialogue.isEnded) {
      this.dialogue.dismissEnded();
      return;
    }
    if (this.fridgeCall.isEnded) {
      this.fridgeCall.dismissEnded();
      return;
    }
    if (this.alertCall.isEnded) {
      this.alertCall.dismissEnded();
      return;
    }
    if (this.packageCall.isEnded) {
      this.packageCall.dismissEnded();
      return;
    }
    if (!this.anyCallBusy()) {
      this.finishHangupClose();
      this.ensureRingScheduled();
      return;
    }
    if (this.dialogue.isBusy) {
      this.dialogue.hangupByPlayer();
      if (this.phone.isOpen && !this.dialogue.isBusy) this.finishHangupClose();
      return;
    }
    if (this.fridgeCall.isBusy) {
      this.fridgeCall.hangupByPlayer();
      if (this.phone.isOpen) this.finishHangupClose();
      return;
    }
    if (this.alertCall.isBusy) {
      this.alertCall.hangupByPlayer();
      if (this.phone.isOpen) this.finishHangupClose();
      return;
    }
    if (this.packageCall.isBusy) {
      this.packageCall.hangupByPlayer();
      if (this.phone.isOpen) this.finishHangupClose();
    }
  }

  private finishHangupClose(): void {
    if (this.outgoing) this.phone.showHome();
    else this.phone.close();
  }

  /** С экрана «звонок завершён» — в справочник. */
  private backToContacts(): void {
    if (!this.phone.isOpen || this.phone.mode() !== "call") return;
    if (this.dialogue.isEnded) {
      this.dialogue.dismissEnded();
      return;
    }
    if (this.fridgeCall.isEnded) {
      this.fridgeCall.dismissEnded();
      return;
    }
    if (this.alertCall.isEnded) {
      this.alertCall.dismissEnded();
      return;
    }
    if (this.packageCall.isEnded) {
      this.packageCall.dismissEnded();
    }
  }

  private afterScriptRemoteHangup(): void {
    if (!this.dialogue.didFinish) return;
    if (this.reconciliationStatus === "AVAILABLE" && this.lastContact === "accountant") {
      this.markTalked("accountant", "audit");
      this.opts.onQuestsChanged?.();
      void this.completeStoryQuest(RECONCILIATION_QUEST.code, (status) => {
        this.reconciliationStatus = status;
      });
      return;
    }
    if (
      this.presentationStatus === "AVAILABLE"
      && (this.lastContact === "bulbul" || this.activeScript === "presentation")
    ) {
      this.markTalked("bulbul", "presentation");
      void this.startPresentationQuest();
      return;
    }
    if (
      this.quantumStatus === "AVAILABLE"
      && (this.lastContact === "bulbatech" || this.activeScript === "quantum")
    ) {
      this.markTalked("bulbatech", "quantum");
      void this.startQuantumQuest();
      return;
    }
    if (this.activeScript === "quantumFinale") {
      this.markTalked("bulbatech", "quantum");
      this.ensureRingScheduled();
      return;
    }
    if (
      this.dayXStatus === "AVAILABLE"
      && (this.lastContact === "bulbov" || this.activeScript === "dayX")
    ) {
      this.markTalked("bulbov", "dayX");
      void this.startDayXQuest();
      return;
    }
    if (this.activeScript === "dayXFinale") {
      this.markTalked("bulbov", "dayX");
      return;
    }
    const hr =
      this.lastContact === "hr" ||
      this.activeScript === "welcome" ||
      this.activeScript === "adaptation" ||
      this.activeScript === "strategy";
    if (!hr) return;
    if (this.activeScript === "welcome" || this.prologueStatus === "AVAILABLE") {
      this.markTalked("hr", "prologue");
      this.prologueStatus = "COMPLETED";
      this.opts.onQuestsChanged?.();
      void this.completeStoryQuest(PROLOGUE_QUEST.code, (status) => {
        this.prologueStatus = status;
      });
      return;
    }
    if (this.adaptationStatus === "AVAILABLE") {
      this.markTalked("hr", "adapted");
      this.opts.onQuestsChanged?.();
      void this.completeStoryQuest(ADAPTATION_QUEST.code, (status) => {
        this.adaptationStatus = status;
      });
      return;
    }
    if (this.activeScript === "strategy" && this.strategyStatus === "AVAILABLE") {
      this.markTalked("hr", "strategy");
      void this.startStrategyQuest();
    }
  }

  async completeStrategyMeeting(): Promise<void> {
    if (this.strategyStatus === "COMPLETED") return;
    this.strategyStatus = "COMPLETED";
    this.opts.onQuestsChanged?.();
    try {
      const res = await api.completeQuest(STRATEGY_QUEST.code);
      this.strategyStatus = res.status;
    } catch (e) {
      console.error("Не удалось закрыть квест стратегии:", e);
      this.strategyStatus = "COMPLETED";
    }
    this.opts.onQuestsChanged?.();
    void this.refreshFromServer();
  }

  private async startStrategyQuest(): Promise<void> {
    try {
      const res = await api.startQuest(STRATEGY_QUEST.code);
      this.strategyStatus = res.status;
    } catch (e) {
      console.error("Не удалось стартовать квест стратегии:", e);
      this.strategyStatus = "IN_PROGRESS";
    }
    this.opts.onQuestsChanged?.();
  }

  private async startPresentationQuest(): Promise<void> {
    this.resetPresentationProgress({ clearStorage: true });
    try {
      const res = await api.startQuest(PRESENTATION_QUEST.code);
      this.presentationStatus = res.status;
      await this.refreshPresentationClaude();
    } catch (e) {
      console.error("Не удалось стартовать квест презентации:", e);
      this.presentationStatus = "IN_PROGRESS";
    }
    this.opts.onQuestsChanged?.();
  }

  private async startQuantumQuest(): Promise<void> {
    try {
      const res = await api.startQuest(QUANTUM_QUEST.code);
      this.quantumStatus = res.status;
    } catch (e) {
      console.error("Не удалось стартовать квест квантовой физики:", e);
      this.quantumStatus = "IN_PROGRESS";
    }
    this.opts.onQuestsChanged?.();
  }

  private async startDayXQuest(): Promise<void> {
    try {
      const res = await api.startQuest(DAY_X_QUEST.code);
      this.dayXStatus = res.status;
    } catch (e) {
      console.error("Не удалось стартовать квест Дня X:", e);
      this.dayXStatus = "IN_PROGRESS";
    }
    this.opts.onQuestsChanged?.();
  }

  private markPresentationDiy(): void {
    this.presentationDiy = true;
    this.savePresentationProgress();
    this.opts.onQuestsChanged?.();
  }

  private markPresentationDiyShown(): void {
    this.presentationDiyShown = true;
    this.savePresentationProgress();
    this.opts.onQuestsChanged?.();
  }

  private async payPresentationClaude(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await api.payPresentationClaude();
      this.presentationClaudePaid = res.claudePaid;
      this.opts.onBalance(res.bulbaCoinBalance);
      this.savePresentationProgress();
      this.opts.onQuestsChanged?.();
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось оплатить.";
      return { ok: false, message };
    }
  }

  private async completePresentation(): Promise<void> {
    if (this.presentationStatus === "COMPLETED") return;
    const deck = [...this.presentationDeck];
    this.presentationStatus = "COMPLETED";
    this.opts.onQuestsChanged?.();
    try {
      const res = await api.acceptPresentationDeck(deck);
      this.presentationStatus = res.status;
      this.presentationDeck = Array.isArray(res.slideIds) ? res.slideIds : deck;
      this.savePresentationProgress();
    } catch (e) {
      console.error("Не удалось сохранить презентацию:", e);
      this.presentationStatus = "IN_PROGRESS";
      this.opts.onQuestsChanged?.();
      throw e;
    }
    this.opts.onQuestsChanged?.();
    void this.refreshFromServer();
  }

  private presentationProgressKey(): string {
    return `bulba_quest_${PRESENTATION_QUEST.code}_${api.getLogin() ?? "_"}`;
  }

  private savePresentationProgress(): void {
    try {
      localStorage.setItem(
        this.presentationProgressKey(),
        JSON.stringify({
          diy: this.presentationDiy,
          shown: this.presentationDiyShown,
          claude: this.presentationClaudePaid,
          deck: this.presentationDeck,
          order: this.presentationDeckOrder,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  private loadPresentationProgress(): void {
    try {
      const raw = localStorage.getItem(this.presentationProgressKey());
      if (!raw) return;
      const data = JSON.parse(raw) as {
        diy?: boolean;
        shown?: boolean;
        claude?: boolean;
        deck?: string[];
        order?: string[];
      };
      this.presentationDiy = !!data.diy;
      this.presentationDiyShown = !!data.shown;
      if (data.claude) this.presentationClaudePaid = true;
      this.presentationDeck = Array.isArray(data.deck) ? data.deck.filter((id) => typeof id === "string") : [];
      this.presentationDeckOrder = Array.isArray(data.order)
        ? data.order.filter((id) => typeof id === "string")
        : [];
    } catch {
      /* ignore */
    }
  }

  private resetPresentationProgress(opts?: { clearStorage?: boolean }): void {
    this.presentationDiy = false;
    this.presentationDiyShown = false;
    this.presentationClaudePaid = false;
    this.presentationDeck = [];
    this.presentationDeckOrder = [];
    if (opts?.clearStorage) {
      try {
        localStorage.removeItem(this.presentationProgressKey());
      } catch {
        /* ignore */
      }
    }
  }

  private async refreshPresentationClaude(): Promise<void> {
    try {
      const state = await api.fetchPresentationClaude();
      this.presentationClaudePaid = state.claudePaid;
      this.opts.onBalance(state.bulbaCoinBalance);
    } catch {
      /* ignore */
    }
  }

  private async refreshPresentationDeck(): Promise<void> {
    try {
      const state = await api.fetchPresentationDeck();
      if (Array.isArray(state.slideIds) && state.slideIds.length > 0) {
        this.presentationDeck = state.slideIds.filter((id) => typeof id === "string");
        this.savePresentationProgress();
      }
    } catch {
      /* ignore */
    }
  }

  private async completeStoryQuest(
    code: string,
    apply: (status: QuestApiStatus) => void,
  ): Promise<void> {
    try {
      const res = await api.completeQuest(code);
      apply(res.status);
    } catch (e) {
      console.error("Не удалось закрыть сюжетный квест:", e);
      apply("COMPLETED");
    }
  }

  private afterScriptAbort(): void {
    this.activeScript = null;
    this.finishHangupClose();
    if (this.phone.mode() === "home") this.renderContacts();
    this.ensureRingScheduled();
  }

  private afterFridgeBriefingAccepted(): Promise<void> | void {
    return (async () => {
      try {
        const res = await api.startQuest(FRIDGE_QUEST.code);
        this.fridgeStatus = res.status;
      } catch (e) {
        console.error("Не удалось стартовать квест:", e);
        this.fridgeStatus = "IN_PROGRESS";
      }
    })();
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
    this.finishHangupClose();
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
    void this.refreshFromServer();
  }

  private afterGreenAlertAccepted(): Promise<void> | void {
    return (async () => {
      try {
        const res = await api.startQuest(ALERT_QUEST.code);
        this.greenAlertStatus = res.status;
      } catch (e) {
        console.error("Не удалось стартовать квест дашборда:", e);
        this.greenAlertStatus = "IN_PROGRESS";
      }
    })();
  }

  private afterGreenAlertBriefingEnded(): void {
    if (this.greenAlertStatus === "COMPLETED") return;
    if (this.greenAlertStatus !== "IN_PROGRESS") this.greenAlertStatus = "IN_PROGRESS";
    this.schedule("greenAlertWork", ALERT_QUEST.timings.statusIntervalMs);
  }

  private afterGreenAlertBriefingAbort(): void {
    this.phone.close();
    this.greenAlertStatus = "AVAILABLE";
    this.ensureRingScheduled();
  }

  private afterGreenAlertWorkHangup(): void {
    if (this.greenAlertStatus === "COMPLETED") return;
    this.schedule("greenAlertWork", ALERT_QUEST.timings.statusIntervalMs);
  }

  private afterGreenAlertWorkAbort(): void {
    this.finishHangupClose();
    if (this.greenAlertStatus === "COMPLETED") return;
    this.schedule("greenAlertWork", ALERT_QUEST.timings.statusIntervalMs);
  }

  private async submitGreenAlert(): Promise<boolean> {
    try {
      const res = await api.completeQuest(ALERT_QUEST.code, ALERT_QUEST.secretCode);
      this.opts.onBalance(res.bulbaCoinBalance);
      this.greenAlertStatus = res.status;
      return res.status === "COMPLETED";
    } catch {
      return false;
    }
  }

  private afterGreenAlertCompleted(): void {
    this.greenAlertStatus = "COMPLETED";
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.pendingKind = null;
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
    this.schedule("packageFinale", PACKAGE_QUEST.timings.finaleDelayMs);
  }

  private afterPackagePeekFail(): void {
    this.packageCall.stop();
    this.phone.close();
    this.opts.onPackagePeekFailed?.();
  }

  private afterDismissEnded(): void {
    this.activeScript = null;
    this.outgoing = false;
    this.phone.showHome();
    this.renderContacts();
    void this.refreshFromServer();
    this.ensureRingScheduled();
  }
}

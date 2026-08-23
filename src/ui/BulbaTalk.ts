import { publicPath } from "../publicPath";
import { getLogin } from "../net/api";
import type { VoiceId } from "../data/voices";
import { typeWithVoice } from "./CharacterVoice";
import { isTouch } from "./TouchControls";
import {
  STRATEGY_DAYX,
  STRATEGY_INTRO,
  STRATEGY_QUEST,
  STRATEGY_TOPICS,
  type StrategyLine,
  type StrategyTopic,
} from "../data/strategyQuest";
import { PRESENTATION_MEETING, PRESENTATION_QUEST } from "../data/presentationQuest";
import {
  REVIEW_LINES,
  SLIDE_IDS,
  reviewDeck,
  slideAsset,
  slideById,
  type SlideSource,
} from "../data/presentationSlides";

const CHAR_DELAY = 25;
const BOSS_CHAR_DELAY = 50;
const LINE_HOLD_MS = 900;
const AFTER_PLAYER_MS = 500;

type BossId = 1 | 2 | 3 | 4;

const BOSSES: { id: BossId; name: string; file: string; voice: VoiceId }[] = [
  { id: 1, name: "Бульбов Н.Н.", file: "boss-1.png", voice: "bulbov" },
  { id: 2, name: "Бульбиков Г.В.", file: "boss-2.png", voice: "bulbikov" },
  { id: 3, name: "Бульбуль М.А.", file: "boss-3.png", voice: "bulbul" },
  { id: 4, name: "Бульба С.В.", file: "boss-4.png", voice: "bulbatech" },
];

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

function fillName(text: string, name: string): string {
  return text.split("{имя}").join(name);
}

function progressKey(): string {
  return `bulba_quest_${STRATEGY_QUEST.code}_${getLogin() ?? "guest"}`;
}

interface MeetingProgress {
  introDone: boolean;
  doneTopics: string[];
}

function loadProgress(): MeetingProgress {
  try {
    const raw = localStorage.getItem(progressKey());
    if (!raw) return { introDone: false, doneTopics: [] };
    const data = JSON.parse(raw) as Partial<MeetingProgress>;
    return {
      introDone: !!data.introDone,
      doneTopics: Array.isArray(data.doneTopics) ? data.doneTopics.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return { introDone: false, doneTopics: [] };
  }
}

function saveProgress(progress: MeetingProgress): void {
  try {
    localStorage.setItem(progressKey(), JSON.stringify(progress));
  } catch {
    /* ignore */
  }
}

function clearProgress(): void {
  try {
    localStorage.removeItem(progressKey());
  } catch {
    /* ignore */
  }
}

export interface BulbaTalkMeeting {
  active: () => boolean;
  onComplete: () => void;
}

export interface PresentationMeeting {
  active: () => boolean;
  diyMade: () => boolean;
  diyShown: () => boolean;
  claudePaid: () => boolean;
  accepted: () => boolean;
  /** Включённые слайды в порядке показа. */
  deck: () => string[];
  setDeck: (ids: string[]) => void;
  /** Полный порядок карточек (включая скрытые). */
  deckOrder: () => string[];
  setDeckOrder: (ids: string[]) => void;
  onDiyShown: () => void;
  onAccepted: () => Promise<void>;
}

/** Фейковый KTalk: список звонков и совещание с четырьмя начальниками. */
export class BulbaTalk {
  running = false;
  maximized = false;

  private windowEl = document.getElementById("macBulbaTalkWindow")!;
  private listView = document.getElementById("macBtList")!;
  private callView = document.getElementById("macBtCall")!;
  private callTitle = document.getElementById("macBtCallTitle")!;
  private grid = document.getElementById("macBtGrid")!;
  private micBtn = document.getElementById("macBtMic")!;
  private repliesEl = document.getElementById("macBtReplies")!;
  private playerBubble = document.getElementById("macBtPlayerBubble")!;
  private playerBubbleText = document.getElementById("macBtPlayerBubbleText")!;

  private muted = true;
  private inCall = false;
  private cancelTyping: (() => void) | null = null;
  private lineTimer = 0;
  private dialogueToken = 0;
  private progress: MeetingProgress = { introDone: false, doneTopics: [] };
  private previewKey: string | null = null;
  private deckDragId: string | null = null;

  constructor(
    private onCloseRequest: () => void,
    private meetings: { strategy?: BulbaTalkMeeting; presentation?: PresentationMeeting } = {},
  ) {
    document.getElementById("macBtClose")!.onclick = () => this.onCloseRequest();
    document.getElementById("macBtMin")!.onclick = () => this.minimize();
    document.getElementById("macBtMax")!.onclick = () => this.toggleMaximize();
    document.getElementById("macBtHangup")!.onclick = () => this.leaveCall();
    this.micBtn.onclick = () => this.toggleMic();

    this.renderCallList();
    this.renderGrid();
  }

  refreshList(): void {
    if (!this.inCall) this.renderCallList();
  }

  open(fresh: boolean): void {
    this.running = true;
    this.fitPhoneWindow();
    this.windowEl.classList.remove("hidden", "is-minimized");
    this.windowEl.classList.toggle("is-maximized", this.maximized);
    this.renderCallList();
    if (fresh) {
      this.resetToList();
    }
  }

  stash(): void {
    this.stopDialogue();
    this.windowEl.classList.add("hidden");
  }

  close(): void {
    this.stopDialogue();
    this.running = false;
    this.maximized = false;
    this.resetToList();
    this.windowEl.classList.add("hidden");
    this.windowEl.classList.remove("is-minimized", "is-maximized");
  }

  minimize(): void {
    this.windowEl.classList.add("is-minimized");
    this.windowEl.classList.remove("is-maximized");
  }

  restore(): void {
    this.windowEl.classList.remove("hidden", "is-minimized");
    this.windowEl.classList.toggle("is-maximized", this.maximized);
  }

  toggleMaximize(): void {
    if (this.windowEl.classList.contains("is-minimized")) {
      this.restore();
      this.windowEl.classList.add("is-maximized");
      this.maximized = true;
      return;
    }
    this.maximized = this.windowEl.classList.toggle("is-maximized");
  }

  unmaximize(): void {
    this.windowEl.classList.remove("is-maximized");
    this.maximized = false;
  }

  /** На телефоне окно сразу на весь стол — иначе сетка звонка слишком мелкая. */
  private fitPhoneWindow(): void {
    if (!isTouch()) return;
    this.maximized = true;
    this.windowEl.classList.add("is-maximized");
  }

  isVisible(): boolean {
    return (
      this.running
      && !this.windowEl.classList.contains("hidden")
      && !this.windowEl.classList.contains("is-minimized")
    );
  }

  isMaximized(): boolean {
    return this.windowEl.classList.contains("is-maximized");
  }

  /** Escape: из звонка → список; со списка → закрыть приложение. */
  handleEscape(): "consumed" | "close-app" {
    if (this.inCall) {
      this.leaveCall();
      return "consumed";
    }
    return "close-app";
  }

  private strategyActive(): boolean {
    return !!this.meetings.strategy?.active();
  }

  private presentationActive(): boolean {
    return !!this.meetings.presentation?.active();
  }

  private playerName(): string {
    return getLogin() ?? "Игрок";
  }

  private renderCallList(): void {
    this.listView.replaceChildren();
    const rows: { title: string; join: () => void }[] = [];
    if (this.strategyActive()) {
      rows.push({ title: STRATEGY_QUEST.meetingTitle, join: () => this.joinMeeting() });
    }
    if (this.presentationActive()) {
      rows.push({ title: PRESENTATION_QUEST.meetingTitle, join: () => this.joinPresentation() });
    }
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mac-bt-empty";
      empty.textContent = "Нет запланированных созвонов";
      this.listView.appendChild(empty);
      return;
    }
    for (const item of rows) {
      const row = document.createElement("div");
      row.className = "mac-bt-call-row";
      const info = document.createElement("div");
      info.className = "mac-bt-call-info";
      const title = document.createElement("div");
      title.className = "mac-bt-call-title";
      title.textContent = item.title;
      const status = document.createElement("div");
      status.className = "mac-bt-call-status";
      status.innerHTML = '<span class="mac-bt-live-dot" aria-hidden="true"></span> Идёт сейчас';
      info.append(title, status);
      const join = document.createElement("button");
      join.type = "button";
      join.className = "mac-bt-join";
      join.textContent = "Подключиться";
      join.onclick = item.join;
      row.append(info, join);
      this.listView.appendChild(row);
    }
  }

  private renderGrid(): void {
    this.grid.replaceChildren();
    for (const boss of BOSSES) {
      const cell = document.createElement("div");
      cell.className = "mac-bt-participant";
      cell.dataset.boss = String(boss.id);

      const img = document.createElement("img");
      img.className = "mac-bt-avatar";
      img.src = publicPath(`assets/ui/bulbatalk/${boss.file}`);
      img.alt = boss.name;
      img.draggable = false;

      const bubble = document.createElement("div");
      bubble.className = "mac-bt-bubble hidden";
      const bubbleText = document.createElement("div");
      bubbleText.className = "mac-bt-bubble-text";
      bubble.appendChild(bubbleText);

      const name = document.createElement("div");
      name.className = "mac-bt-participant-name";
      name.textContent = boss.name;

      cell.append(bubble, img, name);
      this.grid.appendChild(cell);
    }
  }

  private joinMeeting(): void {
    if (!this.strategyActive()) return;
    this.fitPhoneWindow();
    this.inCall = true;
    this.muted = false;
    this.progress = loadProgress();
    this.callTitle.textContent = STRATEGY_QUEST.meetingTitle;
    this.setPresentationLayout(false);
    this.listView.classList.add("hidden");
    this.callView.classList.remove("hidden");
    this.syncMicUi();
    this.clearBossBubbles();
    this.hidePlayerBubble();
    this.hideReplies();
    if (!this.progress.introDone) this.playIntro();
    else this.showTopicsOrDayX();
  }

  private joinPresentation(): void {
    if (!this.presentationActive()) return;
    this.fitPhoneWindow();
    this.inCall = true;
    this.muted = false;
    this.callTitle.textContent = PRESENTATION_QUEST.meetingTitle;
    this.setPresentationLayout(true);
    this.listView.classList.add("hidden");
    this.callView.classList.remove("hidden");
    this.syncMicUi();
    this.hidePlayerBubble();
    this.hideReplies();
    this.playPresentationFlow();
  }

  private leaveCall(): void {
    this.stopDialogue();
    this.inCall = false;
    this.muted = true;
    this.setPresentationLayout(false);
    this.callView.classList.add("hidden");
    this.listView.classList.remove("hidden");
    this.syncMicUi();
    this.hideReplies();
    this.hidePlayerBubble();
    this.clearBossBubbles();
    this.renderCallList();
  }

  private resetToList(): void {
    this.inCall = false;
    this.muted = true;
    this.setPresentationLayout(false);
    this.callView.classList.add("hidden");
    this.listView.classList.remove("hidden");
    this.syncMicUi();
    this.hideReplies();
    this.hidePlayerBubble();
    this.clearBossBubbles();
  }

  private toggleMic(): void {
    if (!this.inCall) return;
    this.muted = !this.muted;
    this.syncMicUi();
  }

  private syncMicUi(): void {
    this.micBtn.classList.toggle("is-unmuted", !this.muted);
    this.micBtn.textContent = this.muted ? "🔇" : "🎤";
    this.micBtn.setAttribute("aria-label", this.muted ? "включить микрофон" : "выключить микрофон");
    this.micBtn.title = this.muted ? "Микрофон выключен" : "Микрофон включён";
  }

  private playIntro(): void {
    this.playLines([...STRATEGY_INTRO.greeting], () => {
      this.showChoices([...STRATEGY_INTRO.greetReplies], () => {
        this.playLines([...STRATEGY_INTRO.afterGreet], () => {
          this.progress.introDone = true;
          saveProgress(this.progress);
          this.showTopicsOrDayX();
        });
      });
    });
  }

  private remainingTopics(): StrategyTopic[] {
    return STRATEGY_TOPICS.filter((topic) => !this.progress.doneTopics.includes(topic.id));
  }

  private showTopicsOrDayX(): void {
    const left = this.remainingTopics();
    if (left.length === 0) {
      this.playDayX();
      return;
    }
    this.showChoices(
      left.map((topic) => topic.label),
      (label) => {
        const topic = left.find((item) => item.label === label);
        if (topic) this.playTopic(topic);
      },
    );
  }

  private playTopic(topic: StrategyTopic): void {
    this.playLines(topic.dialogue, () => {
      this.showChoices(topic.replies, () => {
        this.playLines(topic.afterReply, () => {
          if (!this.progress.doneTopics.includes(topic.id)) {
            this.progress.doneTopics = [...this.progress.doneTopics, topic.id];
            saveProgress(this.progress);
          }
          this.showTopicsOrDayX();
        });
      });
    });
  }

  private playDayX(): void {
    this.playLines([...STRATEGY_DAYX.opening], () => {
      this.showChoices([...STRATEGY_DAYX.teleportReplies], () => {
        this.playLines([...STRATEGY_DAYX.afterTeleport], () => {
          this.showChoices(
            STRATEGY_DAYX.leadReplies.map((item) => item.label),
            (label) => {
              const accepted = label === STRATEGY_DAYX.leadReplies[0]!.label;
              const afterLead = accepted ? STRATEGY_DAYX.afterLeadAccept : STRATEGY_DAYX.afterLeadRefuse;
              this.playLines([...afterLead], () => {
                this.showChoices(
                  STRATEGY_DAYX.questionReplies.map((item) => item.label),
                  (q) => {
                    const picked = STRATEGY_DAYX.questionReplies.find((item) => item.label === q);
                    const answer =
                      picked?.id === "what" ? STRATEGY_DAYX.answerWhat : STRATEGY_DAYX.answerNoWhen;
                    this.playLines([answer, ...STRATEGY_DAYX.closing], () => this.finishMeeting());
                  },
                );
              });
            },
          );
        });
      });
    });
  }

  private finishMeeting(): void {
    clearProgress();
    this.progress = { introDone: false, doneTopics: [] };
    this.meetings.strategy?.onComplete();
    this.leaveCall();
  }

  private showChoices(labels: string[], onPick: (label: string) => void): void {
    this.repliesEl.replaceChildren();
    for (const label of labels) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mac-bt-reply";
      btn.textContent = label;
      btn.onclick = () => this.speakThen(label, () => onPick(label));
      this.repliesEl.appendChild(btn);
    }
    this.repliesEl.classList.remove("hidden");
    this.muted = false;
    this.syncMicUi();
  }

  private hideReplies(): void {
    this.repliesEl.classList.add("hidden");
    this.repliesEl.replaceChildren();
  }

  private speakThen(label: string, then: () => void): void {
    this.stopDialogue();
    const token = ++this.dialogueToken;
    this.hideReplies();
    this.playerBubble.classList.remove("hidden");
    this.cancelTyping = typeText(this.playerBubbleText, label, () => {
      this.cancelTyping = null;
      if (token !== this.dialogueToken) return;
      this.lineTimer = window.setTimeout(() => {
        if (token !== this.dialogueToken) return;
        this.hidePlayerBubble();
        then();
      }, AFTER_PLAYER_MS);
    });
  }

  private playLines(lines: StrategyLine[], onDone: () => void): void {
    this.stopDialogue();
    const token = ++this.dialogueToken;
    this.playDialogue(lines, 0, token, onDone);
  }

  private playDialogue(lines: StrategyLine[], index: number, token: number, onDone: () => void): void {
    if (token !== this.dialogueToken) return;
    if (index >= lines.length) {
      onDone();
      return;
    }

    const line = lines[index]!;
    this.clearBossBubbles();

    const speakers = line.speakers;
    const text = fillName(line.text, this.playerName());
    let finished = 0;
    const cancels: (() => void)[] = [];

    const onAllTyped = () => {
      finished++;
      if (finished < speakers.length) return;
      this.cancelTyping = null;
      this.lineTimer = window.setTimeout(() => {
        if (token !== this.dialogueToken) return;
        this.clearBossBubbles();
        this.playDialogue(lines, index + 1, token, onDone);
      }, LINE_HOLD_MS);
    };

    for (const id of speakers) {
      const cell = this.grid.querySelector(`[data-boss="${id}"]`);
      const bubble = cell?.querySelector(".mac-bt-bubble") as HTMLElement | null;
      const textEl = cell?.querySelector(".mac-bt-bubble-text") as HTMLElement | null;
      if (!bubble || !textEl) {
        onAllTyped();
        continue;
      }
      bubble.classList.remove("hidden");
      const voice = BOSSES.find((b) => b.id === id)?.voice;
      if (voice && id === speakers[0]) {
        cancels.push(typeWithVoice(textEl, text, voice, onAllTyped, BOSS_CHAR_DELAY));
      } else {
        cancels.push(typeText(textEl, text, onAllTyped, BOSS_CHAR_DELAY));
      }
    }

    this.cancelTyping = () => {
      for (const c of cancels) c();
    };
  }

  private stopDialogue(): void {
    this.dialogueToken++;
    window.clearTimeout(this.lineTimer);
    this.cancelTyping?.();
    this.cancelTyping = null;
    this.clearBossBubbles();
    const presBubble = document.getElementById("macBtPresBubble");
    const presText = document.getElementById("macBtPresBubbleText");
    if (presBubble) presBubble.classList.add("hidden");
    if (presText) presText.textContent = "";
    this.hidePlayerBubble();
  }

  private clearBossBubbles(): void {
    for (const bubble of this.grid.querySelectorAll(".mac-bt-bubble")) {
      bubble.classList.add("hidden");
      const text = bubble.querySelector(".mac-bt-bubble-text");
      if (text) text.textContent = "";
    }
  }

  private hidePlayerBubble(): void {
    this.playerBubble.classList.add("hidden");
    this.playerBubbleText.textContent = "";
  }

  private setPresentationLayout(on: boolean): void {
    this.callView.classList.toggle("is-pres", on);
    const pres = document.getElementById("macBtPres")!;
    pres.classList.toggle("hidden", !on);
    if (on) this.renderPresBoss();
  }

  private renderPresBoss(): void {
    const host = document.getElementById("macBtPresBoss")!;
    const boss = BOSSES[2]!;
    host.replaceChildren();
    const img = document.createElement("img");
    img.className = "mac-bt-avatar";
    img.src = publicPath(`assets/ui/bulbatalk/${boss.file}`);
    img.alt = boss.name;
    img.draggable = false;
    const bubble = document.createElement("div");
    bubble.className = "mac-bt-bubble hidden";
    bubble.id = "macBtPresBubble";
    const text = document.createElement("div");
    text.className = "mac-bt-bubble-text";
    text.id = "macBtPresBubbleText";
    bubble.appendChild(text);
    const name = document.createElement("div");
    name.className = "mac-bt-participant-name";
    name.textContent = boss.name;
    host.append(bubble, img, name);
  }

  private playPresentationFlow(): void {
    const meeting = this.meetings.presentation;
    if (!meeting) return;
    this.renderDeckTools();
    this.previewDeckSlide(meeting.deck()[0] ?? null);

    if (meeting.accepted()) {
      this.sayPres(PRESENTATION_MEETING.acceptedAgain, () => this.leaveCall());
      return;
    }
    if (!meeting.diyMade()) {
      this.sayPres(PRESENTATION_MEETING.empty, () => {
        this.showChoices([...PRESENTATION_MEETING.emptyReplies], () => {
          this.sayPres(PRESENTATION_MEETING.emptyAfter, () => this.renderDeckTools());
        });
      });
      return;
    }
    if (!meeting.diyShown()) {
      this.previewSourceSlide("diy", "history");
      this.sayPres(PRESENTATION_MEETING.diyLook, () => {
        this.showChoices([...PRESENTATION_MEETING.diyReplies], () => {
          this.sayPres(PRESENTATION_MEETING.diyAfter, () => {
            this.showChoices([...PRESENTATION_MEETING.claudeReplies], () => {
              this.sayPres(PRESENTATION_MEETING.claudeAfter, () => {
                meeting.onDiyShown();
                this.renderDeckTools();
              });
            });
          });
        });
      });
      return;
    }
    if (!meeting.claudePaid()) {
      this.sayPres(PRESENTATION_MEETING.waitClaude, () => this.renderDeckTools());
      return;
    }
    this.sayPres(PRESENTATION_MEETING.assemble, () => this.renderDeckTools());
  }

  private sayPres(text: string, onDone: () => void): void {
    this.stopDialogue();
    const token = ++this.dialogueToken;
    const bubble = document.getElementById("macBtPresBubble");
    const textEl = document.getElementById("macBtPresBubbleText");
    if (!bubble || !textEl) {
      onDone();
      return;
    }
    bubble.classList.remove("hidden");
    this.cancelTyping = typeWithVoice(textEl, fillName(text, this.playerName()), "bulbul", () => {
      this.cancelTyping = null;
      if (token !== this.dialogueToken) return;
      this.lineTimer = window.setTimeout(() => {
        if (token !== this.dialogueToken) return;
        onDone();
      }, LINE_HOLD_MS);
    }, BOSS_CHAR_DELAY);
  }

  private renderDeckTools(): void {
    const host = document.getElementById("macBtPresTools")!;
    const meeting = this.meetings.presentation;
    host.replaceChildren();
    if (!meeting?.diyMade()) {
      host.textContent = "Слайдов пока нет. Сначала кнопка на рабочем столе.";
      this.previewDeckSlide(null);
      return;
    }
    if (!meeting.claudePaid()) {
      host.textContent = meeting.diyShown()
        ? "Своя версия начальнику не подходит. Уговаривай Claude — потом соберём нормальные слайды."
        : "Покажи начальнику, что получилось.";
      return;
    }

    this.ensureDeckOrder(meeting);
    const order = meeting.deckOrder();
    const active = new Set(meeting.deck());

    const root = document.createElement("div");
    root.className = "mac-bt-deck";

    const hint = document.createElement("div");
    hint.className = "mac-bt-deck-hint";
    hint.textContent = "Клик — вкл/выкл · перетащи — порядок · превью справа";
    root.appendChild(hint);

    const grid = document.createElement("div");
    grid.className = "mac-bt-deck-grid";
    grid.id = "macBtDeckGrid";

    order.forEach((id, index) => {
      const slide = slideById(id);
      if (!slide) return;
      const card = document.createElement("div");
      card.className = "mac-bt-deck-card" + (active.has(id) ? " is-on" : " is-off");
      card.dataset.id = id;
      card.tabIndex = 0;

      const num = document.createElement("div");
      num.className = "mac-bt-deck-card-num";
      num.textContent = String(index + 1);

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "mac-bt-deck-card-thumb";
      const thumb = document.createElement("iframe");
      thumb.className = "mac-bt-deck-card-frame";
      thumb.src = slideAsset("claude", id);
      thumb.title = slide.title;
      thumb.tabIndex = -1;
      thumb.setAttribute("aria-hidden", "true");
      thumbWrap.appendChild(thumb);

      const toggle = document.createElement("label");
      toggle.className = "mac-bt-deck-card-toggle";
      toggle.title = active.has(id) ? "Скрыть слайд" : "Добавить слайд";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = active.has(id);
      check.tabIndex = -1;
      check.setAttribute("aria-hidden", "true");
      toggle.appendChild(check);

      card.append(num, thumbWrap, toggle);
      card.addEventListener("pointerdown", (e) => this.onDeckPointerDown(e, id));
      grid.appendChild(card);
    });

    root.appendChild(grid);

    const send = document.createElement("button");
    send.type = "button";
    send.className = "mac-bt-deck-send";
    send.textContent = meeting.accepted() ? "Презентация уже принята" : "Отправить Бульбулю";
    send.disabled = meeting.accepted();
    send.onclick = () => this.submitDeck();
    root.appendChild(send);
    host.appendChild(root);

    if (!this.previewKey) {
      const firstOn = order.find((id) => active.has(id)) ?? order[0] ?? null;
      this.previewDeckSlide(firstOn);
    }
  }

  private ensureDeckOrder(meeting: PresentationMeeting): void {
    const known = new Set<string>(SLIDE_IDS);
    let order = meeting.deckOrder().filter((id) => known.has(id));
    for (const id of SLIDE_IDS) {
      if (!order.includes(id)) order.push(id);
    }
    if (order.length === 0) order = [...SLIDE_IDS];
    if (order.join("|") !== meeting.deckOrder().join("|")) {
      meeting.setDeckOrder(order);
    }
    const active = new Set(meeting.deck().filter((id) => known.has(id)));
    const nextDeck = order.filter((id) => active.has(id));
    if (nextDeck.join("|") !== meeting.deck().join("|")) {
      meeting.setDeck(nextDeck);
    }
  }

  private onDeckPointerDown(e: PointerEvent, id: string): void {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const meeting = this.meetings.presentation;
    const grid = document.getElementById("macBtDeckGrid");
    if (!meeting || !grid) return;

    this.deckDragId = id;
    let moved = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const card = e.currentTarget as HTMLElement;
    card.classList.add("is-dragging");
    card.setPointerCapture(e.pointerId);
    e.preventDefault();

    const onMove = (ev: PointerEvent) => {
      if (this.deckDragId !== id) return;
      if (!moved && (ev.clientX - startX) ** 2 + (ev.clientY - startY) ** 2 < 36) return;
      moved = true;
      const cards = [...grid.querySelectorAll<HTMLElement>(".mac-bt-deck-card")];
      const centers = cards.map((el) => {
        const r = el.getBoundingClientRect();
        return { el, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      let best = cards.findIndex((el) => el.dataset.id === id);
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i]!;
        const d = (c.x - ev.clientX) ** 2 + (c.y - ev.clientY) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      const from = cards.findIndex((el) => el.dataset.id === id);
      if (from < 0 || best < 0 || from === best) return;
      const moving = cards[from]!;
      const target = cards[best]!;
      if (from < best) grid.insertBefore(moving, target.nextSibling);
      else grid.insertBefore(moving, target);
      [...grid.querySelectorAll(".mac-bt-deck-card-num")].forEach((num, i) => {
        num.textContent = String(i + 1);
      });
    };

    const onUp = (ev: PointerEvent) => {
      try {
        card.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerup", onUp);
      card.removeEventListener("pointercancel", onUp);
      card.classList.remove("is-dragging");
      this.deckDragId = null;

      if (moved) {
        const order = [...grid.querySelectorAll<HTMLElement>(".mac-bt-deck-card")]
          .map((el) => el.dataset.id!)
          .filter(Boolean);
        meeting.setDeckOrder(order);
        const active = new Set(meeting.deck());
        meeting.setDeck(order.filter((item) => active.has(item)));
        this.previewDeckSlide(id);
        return;
      }
      this.toggleDeckSlide(id);
    };

    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerup", onUp);
    card.addEventListener("pointercancel", onUp);
  }

  private toggleDeckSlide(id: string): void {
    const meeting = this.meetings.presentation;
    if (!meeting || meeting.accepted()) return;
    const order = meeting.deckOrder();
    const active = new Set(meeting.deck());
    if (active.has(id)) active.delete(id);
    else active.add(id);
    meeting.setDeck(order.filter((item) => active.has(item)));

    const card = document.querySelector(`.mac-bt-deck-card[data-id="${CSS.escape(id)}"]`);
    if (card) {
      const on = active.has(id);
      card.classList.toggle("is-on", on);
      card.classList.toggle("is-off", !on);
      const check = card.querySelector("input[type='checkbox']") as HTMLInputElement | null;
      if (check) check.checked = on;
      const label = card.querySelector(".mac-bt-deck-card-toggle") as HTMLElement | null;
      if (label) label.title = on ? "Скрыть слайд" : "Добавить слайд";
    }
    this.previewDeckSlide(id);
  }

  private submitDeck(): void {
    const meeting = this.meetings.presentation;
    if (!meeting || meeting.accepted() || !meeting.claudePaid()) return;
    const deck = meeting.deck();
    if (deck.length === 0) {
      this.sayPres(PRESENTATION_MEETING.emptySubmit, () => this.renderDeckTools());
      return;
    }
    const kind = reviewDeck(deck);
    if (kind !== "ok") {
      this.sayPres(REVIEW_LINES[kind], () => this.renderDeckTools());
      return;
    }
    this.sayPres(REVIEW_LINES.ok, () => {
      void meeting.onAccepted()
        .then(() => {
          this.sayPres(PRESENTATION_MEETING.acceptedTechLead, () => {
            this.sayPres(PRESENTATION_MEETING.acceptedBye, () => this.leaveCall());
          });
        })
        .catch((e) => {
          const message = e instanceof Error ? e.message : "Не удалось сохранить презентацию.";
          this.sayPres(message, () => this.renderDeckTools());
        });
    });
  }

  private previewSourceSlide(source: SlideSource, id: string): void {
    this.previewKey = `${source}:${id}`;
    const image = document.getElementById("macBtPresSlideImage") as HTMLImageElement;
    const frame = document.getElementById("macBtPresSlideFrame") as HTMLIFrameElement;
    const empty = document.getElementById("macBtPresEmpty")!;
    const title = slideById(id)?.title ?? "Предпросмотр слайда";
    if (source === "claude") {
      image.classList.add("hidden");
      image.removeAttribute("src");
      frame.src = slideAsset(source, id);
      frame.title = title;
      frame.classList.remove("hidden");
    } else {
      frame.classList.add("hidden");
      frame.removeAttribute("src");
      image.src = slideAsset(source, id);
      image.alt = title;
      image.classList.remove("hidden");
    }
    empty.classList.add("hidden");
  }

  private previewDeckSlide(id: string | null): void {
    const image = document.getElementById("macBtPresSlideImage") as HTMLImageElement;
    const frame = document.getElementById("macBtPresSlideFrame") as HTMLIFrameElement;
    const empty = document.getElementById("macBtPresEmpty")!;
    if (!id) {
      this.previewKey = null;
      image.classList.add("hidden");
      image.removeAttribute("src");
      frame.classList.add("hidden");
      frame.removeAttribute("src");
      empty.classList.remove("hidden");
      return;
    }
    const source: SlideSource = this.meetings.presentation?.claudePaid() ? "claude" : "diy";
    this.previewSourceSlide(source, id);
  }
}

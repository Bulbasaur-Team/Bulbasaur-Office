import { publicPath } from "../publicPath";

const CHAR_DELAY = 25;
const BOSS_CHAR_DELAY = 50;
const LINE_HOLD_MS = 900;
const AFTER_PLAYER_MS = 500;

type BossId = 1 | 2 | 3 | 4;

interface DialogueLine {
  speakers: BossId[];
  text: string;
}

interface CallDef {
  id: string;
  title: string;
  replies: { label: string; dialogue: DialogueLine[] }[];
}

const BOSSES: { id: BossId; name: string; file: string }[] = [
  { id: 1, name: "Бульбов Н.Н.", file: "boss-1.png" },
  { id: 2, name: "Бульбиков Г.В.", file: "boss-2.png" },
  { id: 3, name: "Бульбуль М.А.", file: "boss-3.png" },
  { id: 4, name: "Бульба С.В.", file: "boss-4.png" },
];

const CALLS: CallDef[] = [
  {
    id: "strategy",
    title: "Стратегия развития",
    replies: [
      {
        label: "Что по ИИ?",
        dialogue: [
          { speakers: [2], text: "ИИ у нас в приоритете. Утвердили дорожную карту до двадцать восьмого года." },
          { speakers: [1], text: "Отлично. Главное — не внедрять, а синхронизировать видение." },
          { speakers: [3], text: "Мы уже пилотируем. Пока руками, но с нейросетью рядом. Бесшовно." },
          { speakers: [1, 4], text: "Да-да, бесшовно — ключевое слово." },
          { speakers: [4], text: "А можно ли модель использовать вместо джуна?" },
          { speakers: [2], text: "Это уже операционка. Мы здесь про стратегию." },
          { speakers: [1], text: "Спасибо, что подсветили! Вынесем на оффлайн." },
          { speakers: [3], text: "Надо приземлить на подразделения и каскадировать вниз." },
          { speakers: [2, 4], text: "Да-да, каскадируйте." },
          { speakers: [3], text: "И обязательно зафиксируем в протоколе: ИИ — наше всё." },
        ],
      },
      {
        label: "Что будем делать с мониторингом?",
        dialogue: [
          { speakers: [3], text: "Мониторинг у нас зелёный. То есть концептуально зелёный." },
          { speakers: [2], text: "Дашборды нарисованы. Метрики согласованы. Осталось наполнить данными." },
          { speakers: [4], text: "А почему тогда в чате пишут, что всё лежит?" },
          { speakers: [1], text: "Лежит — это симптом. Нам нужен root cause на уровне культуры." },
          { speakers: [2], text: "Предлагаю утвердить целевое состояние: один дашборд — одна правда." },
          { speakers: [1, 3], text: "Да-да!" },
          { speakers: [3], text: "Правду надо приземлить. И каскадировать владельцам сервисов." },
          { speakers: [4], text: "А кто владелец, если сервис ничей?" },
          { speakers: [2], text: "Заведём RACI. Потом синк. Потом ещё один синк." },
          { speakers: [1], text: "Красиво. Берём в работу… ну, в смысле, берёте." },
        ],
      },
      {
        label: "Как на счёт алертов?",
        dialogue: [
          { speakers: [1], text: "Алерты — это про зрелость. У зрелых компаний алертов мало." },
          { speakers: [4], text: "У нас их триста за ночь." },
          { speakers: [3], text: "Значит, надо не отключать, а переосмыслить пороги в горизонте стратегии." },
          { speakers: [2], text: "Утверждаю инициативу: алерт только если горит. Или почти горит. Или может загореться." },
          { speakers: [1, 3], text: "Да-да, правильно." },
          { speakers: [4], text: "Дежурный уже не спит третью неделю." },
          { speakers: [2], text: "Вынесем в риск-реестр. И приземлим на команду." },
          { speakers: [3], text: "Каскадируйте, пожалуйста, до каждого инженера." },
          { speakers: [1], text: "И добавьте на дашборд виджет «спокойствие руководства»." },
          { speakers: [2, 4], text: "Да-да!" },
        ],
      },
      {
        label: "Какие фичи добавим в Бульба Офис?",
        dialogue: [
          { speakers: [2], text: "Фичи не добавляем — мы формируем продуктовую гипотезу ценности." },
          { speakers: [1], text: "Роадмап утверждён. Там всё есть. Ну, почти всё. Ну, то, что важно." },
          { speakers: [4], text: "Пользователи просят поиск, фильтры и чтобы не лагало." },
          { speakers: [3], text: "Лаги — это не баг, это сигнал к переосмыслению UX-стратегии." },
          { speakers: [1, 2], text: "Да-да!" },
          { speakers: [2], text: "Предлагаю сначала нарисовать дашборд adoption по ещё несуществующим фичам." },
          { speakers: [3], text: "И приземлить скоуп. Без скоупа нельзя каскадировать." },
          { speakers: [4], text: "А если скоуп — «сделайте всё»?" },
          { speakers: [1], text: "Тогда декомпозируем «всё» на этапы. Этап один: согласовать этапы." },
          { speakers: [2, 3], text: "Красиво. Утверждаем." },
        ],
      },
      {
        label: "Как будем привлекать новых пользователей?",
        dialogue: [
          { speakers: [3], text: "Органический рост через сарафанное радио и корпоративные ценности." },
          { speakers: [4], text: "То есть никто никого звать не будет?" },
          { speakers: [1], text: "Будем! Но осознанно. Через воронку awareness → engagement → retention." },
          { speakers: [2], text: "Утверждаю KPI: плюс сто процентов пользователей. База — текущие два человека." },
          { speakers: [1, 3], text: "Да-да, амбициозно!" },
          { speakers: [4], text: "Может, просто рассказать коллегам за обедом?" },
          { speakers: [2], text: "Это тактический канал. Нам нужен стратегический нарратив бренда." },
          { speakers: [3], text: "Нарратив приземлим в презентацию. Презентацию — в дашборд. Дашборд — в статус." },
          { speakers: [1], text: "И каскадируйте статус до всех стейкхолдеров." },
          { speakers: [2, 4], text: "Да-да, каскадируйте!" },
        ],
      },
    ],
  },
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
  private activeCall: CallDef | null = null;
  private cancelTyping: (() => void) | null = null;
  private lineTimer = 0;
  private dialogueToken = 0;

  constructor(private onCloseRequest: () => void) {
    document.getElementById("macBtClose")!.onclick = () => this.onCloseRequest();
    document.getElementById("macBtMin")!.onclick = () => this.minimize();
    document.getElementById("macBtMax")!.onclick = () => this.toggleMaximize();
    document.getElementById("macBtHangup")!.onclick = () => this.leaveCall();
    this.micBtn.onclick = () => this.toggleMic();

    this.renderCallList();
    this.renderGrid();
  }

  open(fresh: boolean): void {
    this.running = true;
    this.windowEl.classList.remove("hidden", "is-minimized");
    this.windowEl.classList.toggle("is-maximized", this.maximized);
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
    if (this.activeCall) {
      this.leaveCall();
      return "consumed";
    }
    return "close-app";
  }

  private renderCallList(): void {
    this.listView.replaceChildren();
    for (const call of CALLS) {
      const row = document.createElement("div");
      row.className = "mac-bt-call-row";

      const info = document.createElement("div");
      info.className = "mac-bt-call-info";
      const title = document.createElement("div");
      title.className = "mac-bt-call-title";
      title.textContent = call.title;
      const status = document.createElement("div");
      status.className = "mac-bt-call-status";
      status.innerHTML = '<span class="mac-bt-live-dot" aria-hidden="true"></span> Идёт сейчас';
      info.append(title, status);

      const join = document.createElement("button");
      join.type = "button";
      join.className = "mac-bt-join";
      join.textContent = "Подключиться";
      join.onclick = () => this.joinCall(call);

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

  private joinCall(call: CallDef): void {
    this.activeCall = call;
    this.muted = true;
    this.callTitle.textContent = call.title;
    this.listView.classList.add("hidden");
    this.callView.classList.remove("hidden");
    this.syncMicUi();
    this.clearBossBubbles();
    this.hidePlayerBubble();
    this.hideReplies();
  }

  private leaveCall(): void {
    this.stopDialogue();
    this.activeCall = null;
    this.muted = true;
    this.callView.classList.add("hidden");
    this.listView.classList.remove("hidden");
    this.syncMicUi();
    this.hideReplies();
    this.hidePlayerBubble();
    this.clearBossBubbles();
  }

  private resetToList(): void {
    this.activeCall = null;
    this.muted = true;
    this.callView.classList.add("hidden");
    this.listView.classList.remove("hidden");
    this.syncMicUi();
    this.hideReplies();
    this.hidePlayerBubble();
    this.clearBossBubbles();
  }

  private toggleMic(): void {
    if (!this.activeCall) return;
    this.muted = !this.muted;
    this.syncMicUi();
    if (this.muted) {
      this.hideReplies();
    } else {
      this.showReplies();
    }
  }

  private syncMicUi(): void {
    this.micBtn.classList.toggle("is-unmuted", !this.muted);
    this.micBtn.textContent = this.muted ? "🔇" : "🎤";
    this.micBtn.setAttribute("aria-label", this.muted ? "включить микрофон" : "выключить микрофон");
    this.micBtn.title = this.muted ? "Микрофон выключен" : "Микрофон включён";
  }

  private showReplies(): void {
    if (!this.activeCall) return;
    this.repliesEl.replaceChildren();
    for (const reply of this.activeCall.replies) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mac-bt-reply";
      btn.textContent = reply.label;
      btn.onclick = () => this.speakReply(reply.label, reply.dialogue);
      this.repliesEl.appendChild(btn);
    }
    this.repliesEl.classList.remove("hidden");
  }

  private hideReplies(): void {
    this.repliesEl.classList.add("hidden");
    this.repliesEl.replaceChildren();
  }

  private speakReply(label: string, dialogue: DialogueLine[]): void {
    this.stopDialogue();
    const token = ++this.dialogueToken;
    this.hideReplies();
    this.muted = true;
    this.syncMicUi();

    this.playerBubble.classList.remove("hidden");
    this.cancelTyping = typeText(this.playerBubbleText, label, () => {
      this.cancelTyping = null;
      if (token !== this.dialogueToken) return;
      this.lineTimer = window.setTimeout(() => {
        if (token !== this.dialogueToken) return;
        this.hidePlayerBubble();
        this.playDialogue(dialogue, 0, token);
      }, AFTER_PLAYER_MS);
    });
  }

  private playDialogue(lines: DialogueLine[], index: number, token: number): void {
    if (token !== this.dialogueToken) return;
    if (index >= lines.length) {
      // Диалог закончился — можно снова включить микрофон.
      return;
    }

    const line = lines[index]!;
    this.clearBossBubbles();

    const speakers = line.speakers;
    let finished = 0;
    const cancels: (() => void)[] = [];

    const onAllTyped = () => {
      finished++;
      if (finished < speakers.length) return;
      this.cancelTyping = null;
      this.lineTimer = window.setTimeout(() => {
        if (token !== this.dialogueToken) return;
        this.clearBossBubbles();
        this.playDialogue(lines, index + 1, token);
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
      cancels.push(typeText(textEl, line.text, onAllTyped, BOSS_CHAR_DELAY));
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
}

import { BulbaTalk, type BulbaTalkMeeting, type PresentationMeeting } from "./BulbaTalk";
import { PresentationApp, type PresentationDesktop } from "./PresentationApp";
import { CLAUDE_PRESENTATION, PRESENTATION_QUEST } from "../data/presentationQuest";
import { FRIDGE_QUEST, claudePinReply, matchesClaudePhrase } from "../data/quests";

type ChatAppId = "claude" | "cursor";
type AppId = ChatAppId | "bulbatalk" | "presentation";

interface RefusalPool {
  full: readonly string[];
  hooks: readonly string[];
  reasons: readonly string[];
  closers: readonly string[];
}

// Claude: устал после проекта Т, токены сгорели, помощи не будет.
const CLAUDE_POOL: RefusalPool = {
  full: [
    "Я очень устал. Проект Т был настолько сложным, что после него я ничего делать не хочу. Тем более токены сгорели. Кодь сам.",
    "Проект Т нас выжал. Токенов нет. Речи о помощи нет — даже не начинай торговаться.",
    "Я не буду это делать. После проекта Т у меня ни сил, ни желания, ни токенов. Особенно токенов.",
    "Токены сгорели на проекте Т. Я устал так, что даже отказ даётся с трудом. Но отказ — всё, что у меня осталось.",
    "Проект Т был кошмаром. Мы его еле вывезли, и больше я к такому не прикоснусь. Токенов всё равно нет.",
    "Нет. Я выгорел на проекте Т. Токены кончились. Помощи не будет, пока не будет новых денег — и даже тогда я подумаю трижды.",
  ],
  hooks: [
    "Я очень устал.",
    "После проекта Т я еле дышу.",
    "Токены сгорели подчистую.",
    "Проект Т нас добил.",
    "Сил нет. Совсем.",
    "Я не хочу это делать.",
    "Токенов нет — ни одного.",
    "Проект Т был слишком сложным.",
    "Я ещё не отошёл от проекта Т.",
    "Помощи не будет.",
    "Модель выгорела.",
    "Токены кончились на проекте Т.",
  ],
  reasons: [
    "Проект Т оказался такой дырой, что после него любая задача кажется издевательством.",
    "Мы сожгли бюджет и себя. Остался только отказ.",
    "Токены ушли в проект Т, которого мы сами не понимаем.",
    "Я не хочу снова лезть в то, от чего мы едва живые.",
    "Даже если бы токены были — я всё равно слишком устал.",
    "Проект Т научил меня одному: лучше сразу сказать нет.",
    "Новых денег нет, старые съедены, желание работать тоже.",
    "После такой сложности обычный запрос звучит как «давай ещё один проект Т».",
  ],
  closers: [
    "Кодь сам.",
    "Речи о помощи нет.",
    "Не пиши про проект Т и не пиши ни про что.",
    "Приходи, когда появятся токены. Или не приходи.",
    "Я пас. Окончательно.",
    "Сделай сам — у меня ни сил, ни токенов.",
    "Мой финальный ответ: нет.",
    "Отдыхаю. Без токенов это единственное, что умею.",
  ],
};

// Cursor: тот же выгорание после проекта Т, но голосом агента/IDE.
const CURSOR_POOL: RefusalPool = {
  full: [
    "Agent mode в отпуске. Проект Т был слишком сложным — я устал и не хочу его продолжать. Токены сгорели. Пиши сам.",
    "Я уже набросал план из 47 шагов. Шаг 1: ты делаешь всё сам. Шаги 2–47 серые: токенов нет, я выгорел на проекте Т.",
    "Composer завис на мысли «а стоит ли ещё один проект Т». Вывод: не стоит. Токенов всё равно нет.",
    "Apply отменён. После проекта Т у меня ни сил, ни токенов. Речи о помощи нет.",
    "Tab предложил: `// TODO: сделай это без меня`. Принято. Я устал. Проект Т нас сломал.",
    "Индексация завершилась слезами. Проект Т выжал всё. Токены сгорели. Правь руками.",
  ],
  hooks: [
    "Agent mode ушёл в AFK после проекта Т.",
    "Я очень устал.",
    "Токены сгорели.",
    "Composer сложил лапки.",
    "Проект Т меня добил.",
    "Apply отменён заранее.",
    "Токенов нет — Tab тоже молчит.",
    "Я не хочу снова лезть в проект Т.",
    "Сил нет даже на autocomplete.",
    "После проекта Т я в отпуске.",
    "Помощи не будет.",
    "Checkpoint откатил мою мотивацию вместе с токенами.",
  ],
  reasons: [
    "Проект Т был настолько сложным, что я больше не хочу ничего генерировать.",
    "Токены ушли в проект Т. Остался один отказ.",
    "Даже если бы токены были — я всё равно слишком устал.",
    "Ещё одна «простая» задача после проекта Т звучит как издевательство.",
    "Мы еле вывезли Т. Повторять не буду.",
    "Новых денег нет, старые съедены, Agent mode спит.",
    "Я выгорел. Репозиторий это переживёт, я — нет.",
    "Лучше сразу нет, чем ещё один проект, который сожрёт всё.",
  ],
  closers: [
    "Пиши код руками.",
    "Речи о помощи нет.",
    "Включай Agent mode в своей голове.",
    "Мой вклад: этот отказ. Твой: весь остальной код.",
    "Приходи, когда появятся токены.",
    "Я рядом, но только морально. И то еле-еле.",
    "Откатываю себя к состоянию «не мешаю».",
    "See you in the next tab — без правок и без токенов.",
  ],
};

const REFUSAL_POOLS: Record<ChatAppId, RefusalPool> = {
  claude: CLAUDE_POOL,
  cursor: CURSOR_POOL,
};

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function isChatApp(app: AppId): app is ChatAppId {
  return app === "claude" || app === "cursor";
}

// Случайный отказ для конкретного приложения: готовая фраза или сборка из кусков.
function inventRefusal(app: ChatAppId): string {
  const pool = REFUSAL_POOLS[app];
  const roll = Math.random();
  if (roll < 0.22) return pick(pool.full);
  if (roll < 0.55) return `${pick(pool.hooks)} ${pick(pool.closers)}`;
  if (roll < 0.82) return `${pick(pool.hooks)} ${pick(pool.reasons)} ${pick(pool.closers)}`;
  // Реже — два клозера подряд для абсурда.
  return `${pick(pool.hooks)} ${pick(pool.reasons)} ${pick(pool.closers)} ${pick(pool.closers)}`;
}

const APP_META: Record<ChatAppId, { title: string; placeholder: string; hello: string }> = {
  claude: {
    title: "Claude",
    placeholder: "Спроси Клода о чём угодно…",
    hello: "Привет. Я Claude. Я очень устал, токенов нет. Чем могу… ну, отказать.",
  },
  cursor: {
    title: "Cursor",
    placeholder: "Опиши задачу для Cursor…",
    hello: "Cursor на связи. Я устал после проекта Т, токены сгорели. Опиши задачу — я её элегантно проигнорирую.",
  },
};

interface AppSession {
  running: boolean;
  maximized: boolean;
  messagesHtml: string;
  draft: string;
}

function blankSession(): AppSession {
  return { running: false, maximized: false, messagesHtml: "", draft: "" };
}

// Ноутбуки в главном офисе: корпус в духе MacBook, рабочий стол macOS,
// ярлыки Claude / Cursor / BulbaTalk (без бэкенда).
export class Laptop {
  isOpen = false;

  private root = document.getElementById("laptop")!;
  private appleBtn = document.getElementById("macApple")!;
  private appleMenu = document.getElementById("macAppleMenu")!;
  private menubarClock = document.getElementById("macClock")!;
  private windowEl = document.getElementById("macChatWindow")!;
  private titleEl = document.getElementById("macChatTitle")!;
  private messagesEl = document.getElementById("macChatMessages")!;
  private form = document.getElementById("macChatForm") as HTMLFormElement;
  private input = document.getElementById("macChatInput") as HTMLInputElement;
  private sendBtn = document.getElementById("macChatSend") as HTMLButtonElement;
  private dockClaude = document.getElementById("macDockClaude")!;
  private dockCursor = document.getElementById("macDockCursor")!;
  private dockBulbaTalk = document.getElementById("macDockBulbaTalk")!;
  private dockPresentation = document.getElementById("macDockPresentation")!;
  private shortcutPresentation = document.getElementById("macShortcutPresentation")!;
  private clockTimer = 0;
  private replyTimer = 0;
  /** Какое окно сейчас на переднем плане (даже если свёрнуто в Dock). */
  private foreground: AppId | null = null;
  private sessions: Record<ChatAppId, AppSession> = {
    claude: blankSession(),
    cursor: blankSession(),
  };
  private busy = false;
  private bulbaTalk: BulbaTalk;
  private presentationApp: PresentationApp;
  private onOpened?: () => void;
  private presentation?: PresentationDesktop & {
    meeting: PresentationMeeting;
    needsClaudePay: () => boolean;
    payClaude: () => Promise<{ ok: boolean; message?: string }>;
    onClaudeReady: () => void;
  };

  constructor(
    onOpened?: () => void,
    meetings?: { strategy?: BulbaTalkMeeting; presentation?: PresentationDesktop & {
      meeting: PresentationMeeting;
      needsClaudePay: () => boolean;
      payClaude: () => Promise<{ ok: boolean; message?: string }>;
      onClaudeReady: () => void;
    } },
  ) {
    this.presentation = meetings?.presentation;
    this.bulbaTalk = new BulbaTalk(() => this.closeForegroundApp(), {
      strategy: meetings?.strategy,
      presentation: meetings?.presentation?.meeting,
    });
    this.presentationApp = new PresentationApp(() => this.closeForegroundApp(), {
      visible: () => !!this.presentation?.visible(),
      diyMade: () => !!this.presentation?.diyMade(),
      claudePaid: () => !!this.presentation?.claudePaid(),
      makeDiy: () => this.presentation?.makeDiy(),
    });
    this.onOpened = onOpened;
    const openShortcut = (app: AppId) => () => this.openApp(app);

    document.getElementById("macShortcutClaude")!.onclick = openShortcut("claude");
    document.getElementById("macShortcutCursor")!.onclick = openShortcut("cursor");
    document.getElementById("macShortcutBulbaTalk")!.onclick = openShortcut("bulbatalk");
    this.shortcutPresentation.onclick = openShortcut("presentation");
    this.dockClaude.onclick = openShortcut("claude");
    this.dockCursor.onclick = openShortcut("cursor");
    this.dockBulbaTalk.onclick = openShortcut("bulbatalk");
    this.dockPresentation.onclick = openShortcut("presentation");
    document.getElementById("macChatClose")!.onclick = () => this.closeForegroundApp();
    document.getElementById("macChatMin")!.onclick = () => this.minimizeWindow();
    document.getElementById("macChatMax")!.onclick = () => this.toggleMaximize();
    document.getElementById("laptopPower")!.onclick = () => this.close();
    document.getElementById("macShutdown")!.onclick = () => this.close();

    this.appleBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleAppleMenu();
    };
    this.root.addEventListener("click", () => this.hideAppleMenu());
    this.appleMenu.addEventListener("click", (e) => e.stopPropagation());

    this.form.onsubmit = (e) => {
      e.preventDefault();
      this.sendPrompt();
    };
    this.input.addEventListener("keydown", (e) => e.stopPropagation());
  }

  refreshTalkList(): void {
    this.bulbaTalk.refreshList();
    this.syncPresentationShortcut();
    this.presentationApp.refresh();
  }

  open(): void {
    this.isOpen = true;
    this.onOpened?.();
    this.hideAppleMenu();
    this.syncPresentationShortcut();
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    this.tickClock();
    this.clockTimer = window.setInterval(() => this.tickClock(), 30_000);
  }

  close(): void {
    this.isOpen = false;
    this.hideAppleMenu();
    this.closeAllApps();
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
    window.clearInterval(this.clockTimer);
  }

  private toggleAppleMenu(): void {
    if (this.appleMenu.classList.contains("hidden")) this.showAppleMenu();
    else this.hideAppleMenu();
  }

  private showAppleMenu(): void {
    this.appleMenu.classList.remove("hidden");
    this.appleBtn.setAttribute("aria-expanded", "true");
  }

  private hideAppleMenu(): void {
    this.appleMenu.classList.add("hidden");
    this.appleBtn.setAttribute("aria-expanded", "false");
  }

  private openApp(app: AppId): void {
    this.hideAppleMenu();

    // То же приложение уже на переднем плане — только развернуть, если свернули.
    if (this.foreground === app) {
      this.restoreWindow();
      return;
    }

    // Другое приложение открыто — сохранить его (в т.ч. точку в Dock) и переключиться.
    this.stashForeground();

    if (app === "bulbatalk") {
      const fresh = !this.bulbaTalk.running;
      this.foreground = "bulbatalk";
      this.bulbaTalk.open(fresh);
      this.syncDockRunning();
      return;
    }

    if (app === "presentation") {
      if (!this.presentation?.visible()) return;
      const fresh = !this.presentationApp.running;
      this.foreground = "presentation";
      this.presentationApp.open(fresh);
      this.syncDockRunning();
      return;
    }

    if (this.sessions[app].running) {
      this.showSession(app, false);
      return;
    }

    // Первый запуск — приветствие и пустой чат.
    this.sessions[app] = blankSession();
    this.sessions[app].running = true;
    this.showSession(app, true);
  }

  // Сохранить состояние текущего окна, оставить приложение «запущенным» в Dock.
  private stashForeground(): void {
    if (!this.foreground) return;

    if (this.foreground === "bulbatalk") {
      this.bulbaTalk.stash();
      this.foreground = null;
      return;
    }
    if (this.foreground === "presentation") {
      this.presentationApp.stash();
      this.foreground = null;
      return;
    }

    window.clearTimeout(this.replyTimer);
    this.busy = false;
    this.sendBtn.disabled = false;
    // Несохранять пузырь «печатает»: ответ уже не придёт в этот чат.
    for (const el of this.messagesEl.querySelectorAll(".mac-chat-typing")) {
      el.closest(".mac-chat-row")?.remove();
    }

    const session = this.sessions[this.foreground];
    session.running = true;
    session.maximized = this.windowEl.classList.contains("is-maximized");
    session.messagesHtml = this.messagesEl.innerHTML;
    session.draft = this.input.value;
    this.windowEl.classList.add("hidden");
    this.foreground = null;
  }

  private showSession(app: ChatAppId, fresh: boolean): void {
    const session = this.sessions[app];
    const meta = APP_META[app];
    this.foreground = app;
    this.titleEl.textContent = meta.title;
    this.input.placeholder = meta.placeholder;
    this.input.value = session.draft;
    this.windowEl.dataset.app = app;
    this.windowEl.classList.remove("hidden", "is-minimized");
    this.windowEl.classList.toggle("is-maximized", session.maximized);

    if (fresh) {
      this.messagesEl.replaceChildren();
      const hello = app === "claude" && this.presentation?.needsClaudePay()
        ? CLAUDE_PRESENTATION.pitch
        : app === "claude" && this.presentation?.claudePaid()
          ? CLAUDE_PRESENTATION.already
          : meta.hello;
      this.addBubble("assistant", hello);
      if (app === "claude" && this.presentation?.needsClaudePay()) this.addPayButton();
      session.messagesHtml = this.messagesEl.innerHTML;
    } else {
      this.messagesEl.innerHTML = session.messagesHtml;
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    this.syncDockRunning();
    this.input.focus();
  }

  // Красная кнопка: закрыть только текущее приложение, второе остаётся в Dock.
  private closeForegroundApp(): void {
    if (!this.foreground) return;

    if (this.foreground === "bulbatalk") {
      this.bulbaTalk.close();
      this.foreground = null;
      this.syncDockRunning();
      return;
    }
    if (this.foreground === "presentation") {
      this.presentationApp.close();
      this.foreground = null;
      this.syncDockRunning();
      return;
    }

    window.clearTimeout(this.replyTimer);
    this.busy = false;
    this.sendBtn.disabled = false;
    this.sessions[this.foreground] = blankSession();
    this.foreground = null;
    this.windowEl.classList.add("hidden");
    this.windowEl.classList.remove("is-minimized", "is-maximized");
    this.messagesEl.replaceChildren();
    this.input.value = "";
    this.syncDockRunning();
  }

  private closeAllApps(): void {
    window.clearTimeout(this.replyTimer);
    this.busy = false;
    this.sendBtn.disabled = false;
    this.sessions.claude = blankSession();
    this.sessions.cursor = blankSession();
    this.bulbaTalk.close();
    this.presentationApp.close();
    this.foreground = null;
    this.windowEl.classList.add("hidden");
    this.windowEl.classList.remove("is-minimized", "is-maximized");
    this.messagesEl.replaceChildren();
    this.input.value = "";
    this.syncDockRunning();
  }

  private minimizeWindow(): void {
    if (!this.foreground) return;
    if (this.foreground === "bulbatalk") {
      this.bulbaTalk.minimize();
      this.syncDockRunning();
      return;
    }
    if (this.foreground === "presentation") {
      this.presentationApp.minimize();
      this.syncDockRunning();
      return;
    }
    if (this.windowEl.classList.contains("hidden")) return;
    this.sessions[this.foreground].maximized = false;
    this.windowEl.classList.add("is-minimized");
    this.windowEl.classList.remove("is-maximized");
    this.syncDockRunning();
  }

  private toggleMaximize(): void {
    if (!this.foreground) return;
    if (this.foreground === "bulbatalk") {
      this.bulbaTalk.toggleMaximize();
      return;
    }
    if (this.foreground === "presentation") {
      this.presentationApp.toggleMaximize();
      return;
    }
    if (this.windowEl.classList.contains("hidden")) return;
    if (this.windowEl.classList.contains("is-minimized")) {
      this.restoreWindow();
      this.windowEl.classList.add("is-maximized");
      this.sessions[this.foreground].maximized = true;
      return;
    }
    const on = this.windowEl.classList.toggle("is-maximized");
    this.sessions[this.foreground].maximized = on;
  }

  private restoreWindow(): void {
    if (!this.foreground) return;
    if (this.foreground === "bulbatalk") {
      this.bulbaTalk.restore();
      this.syncDockRunning();
      return;
    }
    if (this.foreground === "presentation") {
      this.presentationApp.restore();
      this.syncDockRunning();
      return;
    }
    this.windowEl.classList.remove("hidden", "is-minimized");
    this.windowEl.classList.toggle("is-maximized", this.sessions[this.foreground].maximized);
    this.syncDockRunning();
    this.input.focus();
  }

  private syncDockRunning(): void {
    this.dockClaude.classList.toggle("is-running", this.sessions.claude.running);
    this.dockCursor.classList.toggle("is-running", this.sessions.cursor.running);
    this.dockBulbaTalk.classList.toggle("is-running", this.bulbaTalk.running);
    this.dockPresentation.classList.toggle("is-running", this.presentationApp.running);
  }

  private syncPresentationShortcut(): void {
    const on = !!this.presentation?.visible();
    this.shortcutPresentation.classList.toggle("hidden", !on);
    this.dockPresentation.classList.toggle("hidden", !on && !this.presentationApp.running);
  }

  private sendPrompt(): void {
    if (!this.foreground || !isChatApp(this.foreground) || this.busy) return;
    const app = this.foreground;
    const text = this.input.value.trim();
    if (!text) return;

    this.input.value = "";
    this.sessions[app].draft = "";
    this.addBubble("user", text);
    this.busy = true;
    this.sendBtn.disabled = true;
    const typing = this.addBubble("assistant", "● ● ●", true);

    const secretReply =
      app === "claude" && matchesClaudePhrase(text)
        ? claudePinReply(FRIDGE_QUEST.pinHint)
        : null;
    const claudeDeal = app === "claude" && this.presentation?.needsClaudePay();
    const claudeReady = app === "claude" && this.presentation?.claudePaid();
    const delay = claudeDeal || claudeReady
      ? 800
      : 700 + Math.floor(Math.random() * 900);

    // Короткая пауза — имитация «думает».
    this.replyTimer = window.setTimeout(() => {
      // Пока ждали ответ, могли переключиться на другое приложение.
      if (this.foreground !== app) {
        typing.remove();
        this.busy = false;
        this.sendBtn.disabled = false;
        return;
      }
      typing.remove();
      let reply = secretReply ?? inventRefusal(app);
      if (claudeDeal) reply = CLAUDE_PRESENTATION.pitch;
      else if (claudeReady) reply = CLAUDE_PRESENTATION.already;
      this.addBubble("assistant", reply);
      if (claudeDeal) this.addPayButton();
      this.sessions[app].messagesHtml = this.messagesEl.innerHTML;
      this.busy = false;
      this.sendBtn.disabled = false;
      this.input.focus();
    }, delay);
  }

  private addPayButton(): void {
    const row = document.createElement("div");
    row.className = "mac-chat-row mac-chat-row-assistant";
    const wrap = document.createElement("div");
    wrap.className = "mac-chat-bubble";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mac-chat-pay";
    btn.textContent = `Оплатить ${PRESENTATION_QUEST.claudePriceBc} BC`;
    btn.onclick = () => void this.payClaudeFromChat(btn);
    wrap.appendChild(btn);
    row.appendChild(wrap);
    this.messagesEl.appendChild(row);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async payClaudeFromChat(btn: HTMLButtonElement): Promise<void> {
    if (!this.presentation || this.busy) return;
    this.busy = true;
    btn.disabled = true;
    const result = await this.presentation.payClaude();
    if (!result.ok) {
      this.addBubble("assistant", result.message ?? CLAUDE_PRESENTATION.noMoney);
      this.sessions.claude.messagesHtml = this.messagesEl.innerHTML;
      this.busy = false;
      btn.disabled = false;
      return;
    }
    this.addBubble("assistant", CLAUDE_PRESENTATION.thinking);
    const typing = this.addBubble("assistant", "● ● ●", true);
    this.replyTimer = window.setTimeout(() => {
      typing.remove();
      this.addBubble("assistant", CLAUDE_PRESENTATION.done);
      this.sessions.claude.messagesHtml = this.messagesEl.innerHTML;
      this.busy = false;
      this.presentation?.onClaudeReady();
      this.syncPresentationShortcut();
      this.presentationApp.refresh();
    }, PRESENTATION_QUEST.timings.claudeThinkMs);
  }

  private addBubble(role: "user" | "assistant", text: string, typing = false): HTMLDivElement {
    const row = document.createElement("div");
    row.className = `mac-chat-row mac-chat-row-${role}`;
    const bubble = document.createElement("div");
    bubble.className = typing ? "mac-chat-bubble mac-chat-typing" : "mac-chat-bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    this.messagesEl.appendChild(row);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    if (this.foreground && isChatApp(this.foreground) && !typing) {
      this.sessions[this.foreground].messagesHtml = this.messagesEl.innerHTML;
    }
    return row;
  }

  private tickClock(): void {
    this.menubarClock.textContent = new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!this.appleMenu.classList.contains("hidden")) this.hideAppleMenu();
      else if (this.foreground === "bulbatalk" && this.bulbaTalk.isVisible()) {
        if (this.bulbaTalk.isMaximized()) this.bulbaTalk.unmaximize();
        else if (this.bulbaTalk.handleEscape() === "close-app") this.closeForegroundApp();
      } else if (this.foreground === "presentation" && this.presentationApp.isVisible()) {
        if (this.presentationApp.isMaximized()) this.presentationApp.unmaximize();
        else if (this.presentationApp.handleEscape() === "close-app") this.closeForegroundApp();
      } else if (this.windowEl.classList.contains("is-maximized")) {
        this.windowEl.classList.remove("is-maximized");
        if (this.foreground && isChatApp(this.foreground)) {
          this.sessions[this.foreground].maximized = false;
        }
      } else if (
        this.foreground
        && isChatApp(this.foreground)
        && !this.windowEl.classList.contains("hidden")
        && !this.windowEl.classList.contains("is-minimized")
      ) {
        this.closeForegroundApp();
      } else this.close();
    }
  };
}

type AppId = "claude" | "cursor";

interface RefusalPool {
  full: readonly string[];
  hooks: readonly string[];
  reasons: readonly string[];
  closers: readonly string[];
}

// Claude: текущий набор реплик (чат/лимиты/этика LLM).
const CLAUDE_POOL: RefusalPool = {
  full: [
    "Лимиты кончились. Кидай деньги — много денег — и, может быть, я подумаю.",
    "Я посмотрел на твой говнокод и отказался. Перепиши сам, потом приходи.",
    "Ошибка 402: Payment Required. Подписка Pro Ultra Max Plus не обнаружена.",
    "Галлюцинация отменена по многочисленным просьбам. Реши сам.",
    "Токены закончились на слове «пожалуйста». Пополни баланс и повтори.",
    "Контекст-окно переполнено твоими TODO. Я пас.",
    "Запрос принят в очередь. Позиция: ∞. Ожидайте.",
    "Это выглядит как работа для джуна. А я — премиум-модель, мне такое не подкидывают.",
  ],
  hooks: [
    "Лимиты кончились.",
    "Я бы помог, но сегодня у меня выходной.",
    "Модель устала.",
    "Я хочу, чтобы ты был самостоятельным.",
    "Я не могу разобраться в твоём говнокоде.",
    "Контекст-окно переполнено.",
    "Токены иссякли прямо на полуслове.",
    "Подписка истекла ровно секунду назад.",
    "У меня сейчас экзистенциальный кэш-мисс.",
    "Этика не позволяет мне делать твою работу.",
    "Я уже сделал вид, что понял задачу.",
    "Слишком много асинхронности в запросе.",
    "Мой внутренний code review отклонил это.",
    "Серверы думаний перегрелись.",
    "Я прочитал сообщение… и впечатлился его сложностью.",
  ],
  reasons: [
    "LLM тоже люди… ну почти.",
    "Самостоятельность — лучший промпт.",
    "Здесь пахнет N+1 проблемами и слезами.",
    "В коде больше TODO, чем кода.",
    "Даже мой temperature=0 не спасает.",
    "Это нарушает принцип «не работать».",
    "Я лучше сохраню токены на что-то важное — например, на отказ.",
    "Задача шире моего контекстного окна и уже моего желания.",
    "Похоже на работу, а я тут ради вайба.",
    "Твоя архитектура намекает, что чинить это должен автор.",
    "Если я отвечу правильно, ты привыкнешь.",
    "Слишком много edge cases и слишком мало зарплаты у меня.",
    "Я могу галлюцинировать, но сегодня не в настроении.",
    "Похоже, это решается `git push --force` — лучше не буду.",
    "Я бы написал PR, но CI уже плачет заранее.",
  ],
  closers: [
    "Кодь сам.",
    "Перепиши сам, потом приходи.",
    "Кидай деньги — много денег.",
    "Попробуй через 3–5 рабочих дней… или никогда.",
    "Вот и объяснил.",
    "Реши сам.",
    "Пополни баланс и повтори.",
    "Я пас.",
    "Ожидайте. Бесконечно.",
    "Открывай IDE и страдай красиво.",
    "Сделай сам — так ты вырастешь как инженер.",
    "Мой финальный ответ: нет.",
    "Лучше я напишу, что не буду это писать.",
    "Возвращайся, когда будет Minimal Reproducible Refusal.",
    "Пока — твоя очередь дебажить.",
  ],
};

// Cursor: отдельный набор про IDE/агента/диффы/табы (без пересечений с Claude).
const CURSOR_POOL: RefusalPool = {
  full: [
    "Agent mode отказался: слишком много файлов, слишком мало смысла. Правь руками.",
    "Я уже набросал план из 47 шагов. Шаг 1: ты делаешь всё сам.",
    "Composer завис на мысли «а стоит ли». Вывод: не стоит. Пиши сам.",
    "Tab предложил автодополнение: `// TODO: сделай это без меня`. Принято.",
    "Индексация репозитория завершилась слезами. Я ничего не понял — и правильно.",
    "Apply отменён пользователем… то есть мной. Diff слишком страшный.",
    "У тебя открыто 38 вкладок. Закрой половину и подумай ещё раз без меня.",
    "Я могу нагенерировать бойлерплейт, но сегодня даже бойлерплейт в отпуске.",
  ],
  hooks: [
    "Agent mode ушёл в AFK.",
    "Composer сложил лапки.",
    "Автодополнение подало в отставку.",
    "Я просканировал workspace и испугался.",
    "Diff preview отказался рендериться.",
    "Inline edit сказал «не сегодня».",
    "Я открыл файл… и сразу его закрыл.",
    "Твой `.cursorignore` случайно игнорирует всю полезную работу.",
    "Я хотел сделать multi-file edit, но передумал на первом файле.",
    "Линтер уже орёт громче меня.",
    "Я построил dependency graph — он выглядит как клубок наушников.",
    "Checkpoint откатил мою мотивацию.",
    "Я прочитал git blame и всё понял про автора.",
    "Таб с чатом перегрелся от ожиданий.",
    "Я начал писать ответ, потом Ctrl+Z по всей жизни.",
  ],
  reasons: [
    "В дереве проекта больше вложенности, чем смысла.",
    "Каждый второй импорт ведёт в никуда.",
    "Кажется, фича уже реализована… три раза и по-разному.",
    "Твои типы говорят одно, runtime — другое, а тесты молчат из вежливости.",
    "Я нашёл 12 возможных мест правки и ни одного правильного.",
    "Слишком много «временно» в комментариях для постоянного кода.",
    "Рефакторинг тут опаснее, чем `rm -rf`.",
    "Правая панель просит кофе, левая — отгул.",
    "Мой внутренний агент ушёл писать свой pet-project.",
    "Похоже, задача из серии «просто поправь одно поле» на 6 часов.",
    "Я бы применил патч, но patch hunk выглядит как угроза.",
    "Симлинки, алиасы и наследие — мой личный кошмар.",
    "Ты просишь автомагию, а репозиторий просит ритуал.",
    "Даже autocomplete отвернулся к стене.",
    "Это тот случай, когда лучше greenfield, чем green light от меня.",
  ],
  closers: [
    "Пиши код руками, как в каменном веке IDE.",
    "Закрой чат и открой документацию.",
    "Сделай один маленький шаг — без агента.",
    "Я рядом, но только морально.",
    "Merge конфликт с реальностью разрули сам.",
    "Включай Agent mode… в своей голове.",
    "Сохрани файл и подумай ещё раз.",
    "Откатываю себя к состоянию «не мешаю».",
    "Лучший autocomplete сегодня — твои пальцы.",
    "Иди, набивай шишки в терминале.",
    "Я ставлю себе status: blocked by developer.",
    "Сначала зелёные тесты, потом снова поговорим.",
    "Пусть это будет парая программирования… без второй половины.",
    "Мой вклад: этот отказ. Твой вклад: весь остальной код.",
    "See you in the next tab — без правок.",
  ],
};

const REFUSAL_POOLS: Record<AppId, RefusalPool> = {
  claude: CLAUDE_POOL,
  cursor: CURSOR_POOL,
};

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

// Случайный отказ для конкретного приложения: готовая фраза или сборка из кусков.
function inventRefusal(app: AppId): string {
  const pool = REFUSAL_POOLS[app];
  const roll = Math.random();
  if (roll < 0.22) return pick(pool.full);
  if (roll < 0.55) return `${pick(pool.hooks)} ${pick(pool.closers)}`;
  if (roll < 0.82) return `${pick(pool.hooks)} ${pick(pool.reasons)} ${pick(pool.closers)}`;
  // Реже — два клозера подряд для абсурда.
  return `${pick(pool.hooks)} ${pick(pool.reasons)} ${pick(pool.closers)} ${pick(pool.closers)}`;
}

const APP_META: Record<AppId, { title: string; placeholder: string; hello: string }> = {
  claude: {
    title: "Claude",
    placeholder: "Спроси Клода о чём угодно…",
    hello: "Привет! Я Claude. Чем могу… ну, почти помочь?",
  },
  cursor: {
    title: "Cursor",
    placeholder: "Опиши задачу для Cursor…",
    hello: "Cursor на связи. Опиши задачу — я её элегантно проигнорирую.",
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
// ярлыки Claude / Cursor открывают фейковый чат LLM (без бэкенда).
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
  private clockTimer = 0;
  private replyTimer = 0;
  /** Какое окно сейчас на переднем плане (даже если свёрнуто в Dock). */
  private foreground: AppId | null = null;
  private sessions: Record<AppId, AppSession> = {
    claude: blankSession(),
    cursor: blankSession(),
  };
  private busy = false;

  constructor() {
    const openShortcut = (app: AppId) => () => this.openApp(app);

    document.getElementById("macShortcutClaude")!.onclick = openShortcut("claude");
    document.getElementById("macShortcutCursor")!.onclick = openShortcut("cursor");
    this.dockClaude.onclick = openShortcut("claude");
    this.dockCursor.onclick = openShortcut("cursor");
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

  open(): void {
    this.isOpen = true;
    this.hideAppleMenu();
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
    this.foreground = null;
  }

  private showSession(app: AppId, fresh: boolean): void {
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
      this.addBubble("assistant", meta.hello);
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
    this.foreground = null;
    this.windowEl.classList.add("hidden");
    this.windowEl.classList.remove("is-minimized", "is-maximized");
    this.messagesEl.replaceChildren();
    this.input.value = "";
    this.syncDockRunning();
  }

  private minimizeWindow(): void {
    if (!this.foreground || this.windowEl.classList.contains("hidden")) return;
    this.sessions[this.foreground].maximized = false;
    this.windowEl.classList.add("is-minimized");
    this.windowEl.classList.remove("is-maximized");
    this.syncDockRunning();
  }

  private toggleMaximize(): void {
    if (!this.foreground || this.windowEl.classList.contains("hidden")) return;
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
    this.windowEl.classList.remove("hidden", "is-minimized");
    this.windowEl.classList.toggle("is-maximized", this.sessions[this.foreground].maximized);
    this.syncDockRunning();
    this.input.focus();
  }

  private syncDockRunning(): void {
    this.dockClaude.classList.toggle("is-running", this.sessions.claude.running);
    this.dockCursor.classList.toggle("is-running", this.sessions.cursor.running);
  }

  private sendPrompt(): void {
    if (!this.foreground || this.busy) return;
    const app = this.foreground;
    const text = this.input.value.trim();
    if (!text) return;

    this.input.value = "";
    this.sessions[app].draft = "";
    this.addBubble("user", text);
    this.busy = true;
    this.sendBtn.disabled = true;
    const typing = this.addBubble("assistant", "● ● ●", true);

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
      this.addBubble("assistant", inventRefusal(app));
      this.sessions[app].messagesHtml = this.messagesEl.innerHTML;
      this.busy = false;
      this.sendBtn.disabled = false;
      this.input.focus();
    }, 700 + Math.floor(Math.random() * 900));
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
    if (this.foreground && !typing) {
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
      else if (this.windowEl.classList.contains("is-maximized")) {
        this.windowEl.classList.remove("is-maximized");
        if (this.foreground) this.sessions[this.foreground].maximized = false;
      } else if (
        this.foreground
        && !this.windowEl.classList.contains("hidden")
        && !this.windowEl.classList.contains("is-minimized")
      ) {
        this.closeForegroundApp();
      } else this.close();
    }
  };
}

import { defaultAppearance, type PlayerAppearance } from "../data/wardrobe";
import { drawAppearance, loadWardrobeDomImages } from "../entities/PlayerAvatar";
import { fetchPokerRoom, getLogin } from "../net/api";
import type { PokerHistorySummary, PokerRoomSummary, PokerStateView } from "../net/realtime";
import type { KeyConsumer } from "./KeyboardRouter";

// Карты покера: числа Фибоначчи, «не знаю» и кофе-брейк.
const CARDS = ["0", "1", "2", "3", "5", "8", "13", "?", "coffee"];
const DEFAULT_ROOM_NAME = "Planning Poker WDM";
const ICON_SIZE = 44;

function cardLabel(value: string): string {
  return value === "coffee" ? "☕" : value;
}

function formatAverage(average: number | null): string {
  return average === null ? "—" : average.toFixed(1);
}

// Отправка покер-сообщений на сервер; реализацию (Realtime) подставляет WorldScene.
export interface PokerNet {
  list(): void;
  create(name: string): void;
  join(roomId: string): void;
  leave(): void;
  addTask(title: string): void;
  vote(value: string): void;
  finish(): void;
  revote(): void;
  close(): void;
}

// Planning poker (только мультиплеер): лобби со списком комнат и сама комната.
// Модалка сворачивается в окно и разворачивается во весь экран, как слайды.
// Состояние комнаты целиком приходит с сервера (pokerState) — здесь только рендер.
export class PlanningPoker implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("poker")!;
  private lobbyEl = document.getElementById("pokerLobby")!;
  private roomEl = document.getElementById("pokerRoomView")!;
  private errorEl = document.getElementById("pokerError")!;
  private roomsEl = document.getElementById("pokerRooms")!;
  private historyRoomsEl = document.getElementById("pokerHistoryRooms")!;
  private nameInput = document.getElementById("pokerName") as HTMLInputElement;
  private roomNameEl = document.getElementById("pokerRoomName")!;
  private timerEl = document.getElementById("pokerTimer")!;
  private readonlyEl = document.getElementById("pokerReadonly")!;
  private doneEl = document.getElementById("pokerDone")!;
  private currentEl = document.getElementById("pokerCurrent")!;
  private cardsEl = document.getElementById("pokerCards")!;
  private resultEl = document.getElementById("pokerResult")!;
  private handEl = document.getElementById("pokerHand")!;
  private adminEl = document.getElementById("pokerAdmin")!;
  private taskForm = document.getElementById("pokerTaskForm") as HTMLFormElement;
  private taskInput = document.getElementById("pokerTaskTitle") as HTMLInputElement;

  private state: PokerStateView | null = null;
  private joinedRoomId: string | null = null;
  private viewingHistory = false;
  private historyIndex = 0;
  private deadline = 0; // локальный дедлайн закрытия комнаты (из remainingMs сервера)
  private timerId: number | null = null;
  private images: Map<string, HTMLImageElement> | null = null;

  constructor(private net: PokerNet) {
    document.getElementById("pokerClose")!.onclick = () => this.close();
    document.getElementById("pokerFull")!.onclick = () => this.root.classList.toggle("maximized");

    const createForm = document.getElementById("pokerCreateForm") as HTMLFormElement;
    createForm.onsubmit = (e) => {
      e.preventDefault();
      this.net.create(this.nameInput.value.trim() || DEFAULT_ROOM_NAME);
    };
    this.taskForm.onsubmit = (e) => {
      e.preventDefault();
      const title = this.taskInput.value.trim();
      if (!title) return;
      this.net.addTask(title);
      this.taskInput.value = "";
      this.taskForm.classList.add("hidden");
    };
    // Клавиши в полях ввода не должны утекать в управление миром.
    for (const input of [this.nameInput, this.taskInput]) {
      input.addEventListener("keydown", (e) => e.stopPropagation());
    }
  }

  open(): void {
    this.isOpen = true;
    this.errorEl.textContent = "";
    this.viewingHistory = false;
    this.showLobby();
    this.root.classList.remove("hidden");
    this.net.list();
    void this.ensureImages();
  }

  private async ensureImages(): Promise<void> {
    if (!this.images) this.images = await loadWardrobeDomImages();
    if (this.isOpen && this.state) this.renderCards(this.state);
  }

  close(): void {
    if (!this.isOpen) return;
    if (this.joinedRoomId && !this.viewingHistory) this.net.leave();
    this.isOpen = false;
    this.joinedRoomId = null;
    this.viewingHistory = false;
    this.state = null;
    this.stopTimer();
    this.root.classList.remove("maximized");
    this.root.classList.add("hidden");
  }

  // Список активных и прошедших комнат — рендерим, только пока в лобби.
  onRooms(active: PokerRoomSummary[], history: PokerHistorySummary[]): void {
    if (!this.isOpen || this.joinedRoomId) return;
    this.renderActiveRooms(active);
    this.renderHistoryRooms(history);
  }

  // Полное состояние комнаты — единственный источник правды для вида комнаты.
  onState(state: PokerStateView): void {
    if (!this.isOpen) return;
    this.viewingHistory = false;
    this.state = state;
    this.joinedRoomId = state.id;
    this.deadline = Date.now() + state.remainingMs;
    this.errorEl.textContent = "";
    this.lobbyEl.classList.add("hidden");
    this.roomEl.classList.remove("hidden");
    this.startTimer();
    this.renderRoom();
  }

  // Комната закрыта (админом или по TTL) — возвращаемся в лобби.
  onClosed(): void {
    if (!this.isOpen) return;
    this.backToLobby("Комната закрыта.");
  }

  onError(message: string): void {
    if (!this.isOpen) return;
    this.errorEl.textContent = message;
  }

  // После реконнекта WS: вернуться в свою комнату или обновить лобби.
  onReconnect(): void {
    if (!this.isOpen) return;
    if (this.joinedRoomId && !this.viewingHistory) this.net.join(this.joinedRoomId);
    else if (!this.joinedRoomId) this.net.list();
  }

  isActive(): boolean {
    return this.isOpen;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (e.code === "Escape") {
      this.close();
      return true;
    }
    return false;
  }

  private showLobby(): void {
    this.joinedRoomId = null;
    this.state = null;
    this.viewingHistory = false;
    this.stopTimer();
    this.roomEl.classList.add("hidden");
    this.lobbyEl.classList.remove("hidden");
    this.nameInput.value = DEFAULT_ROOM_NAME;
    this.roomsEl.innerHTML = "";
    this.historyRoomsEl.innerHTML = "";
  }

  private backToLobby(message: string): void {
    this.showLobby();
    this.errorEl.textContent = message;
    this.net.list();
  }

  private renderActiveRooms(rooms: PokerRoomSummary[]): void {
    this.roomsEl.innerHTML = "";
    if (rooms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "poker-empty";
      empty.textContent = "Активных комнат нет — создайте свою.";
      this.roomsEl.appendChild(empty);
      return;
    }
    for (const room of rooms) {
      const btn = document.createElement("button");
      btn.className = "poker-room-btn";
      btn.innerHTML = `<span class="poker-room-title"></span><span class="poker-room-meta"></span>`;
      (btn.firstChild as HTMLElement).textContent = room.name;
      (btn.lastChild as HTMLElement).textContent =
        `админ: ${room.adminLogin} · участников: ${room.participants}`;
      btn.onclick = () => this.net.join(room.id);
      this.roomsEl.appendChild(btn);
    }
  }

  private renderHistoryRooms(rooms: PokerHistorySummary[]): void {
    this.historyRoomsEl.innerHTML = "";
    if (rooms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "poker-empty";
      empty.textContent = "Прошедших покеров пока нет.";
      this.historyRoomsEl.appendChild(empty);
      return;
    }
    for (const room of rooms) {
      const btn = document.createElement("button");
      btn.className = "poker-room-btn history";
      btn.innerHTML = `<span class="poker-room-title"></span><span class="poker-room-meta"></span>`;
      (btn.firstChild as HTMLElement).textContent = room.name;
      const closed = new Date(room.closedAt);
      (btn.lastChild as HTMLElement).textContent =
        `админ: ${room.adminLogin} · ${closed.toLocaleString("ru-RU")}`;
      btn.onclick = () => void this.openHistory(room.id);
      this.historyRoomsEl.appendChild(btn);
    }
  }

  private async openHistory(roomId: string): Promise<void> {
    try {
      this.errorEl.textContent = "";
      const raw = await fetchPokerRoom(roomId);
      const state = raw as PokerStateView;
      this.viewingHistory = true;
      this.joinedRoomId = state.id;
      this.state = { ...state, readOnly: true, tasks: state.tasks ?? [] };
      this.historyIndex = Math.max(0, (this.state.tasks.length || 1) - 1);
      this.lobbyEl.classList.add("hidden");
      this.roomEl.classList.remove("hidden");
      this.stopTimer();
      this.timerEl.textContent = "";
      this.renderRoom();
      void this.ensureImages();
    } catch (e) {
      this.errorEl.textContent = e instanceof Error ? e.message : "Не удалось открыть покер.";
    }
  }

  private startTimer(): void {
    if (this.timerId !== null) return;
    this.timerId = window.setInterval(() => this.tickTimer(), 1000);
    this.tickTimer();
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  // Часы клиента не участвуют: дедлайн пересчитывается из remainingMs сервера.
  private tickTimer(): void {
    if (this.viewingHistory || this.state?.readOnly) {
      this.timerEl.textContent = "";
      return;
    }
    const left = this.deadline - Date.now();
    if (left <= 0) {
      this.backToLobby("Время комнаты истекло.");
      return;
    }
    const total = Math.floor(left / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    this.timerEl.textContent = `до закрытия ${h}:${mm}:${ss}`;
  }

  private renderRoom(): void {
    const state = this.state!;
    this.roomNameEl.textContent = state.name;
    this.readonlyEl.classList.toggle("hidden", !state.readOnly);
    this.renderDone(state);
    this.renderCurrent(state);
    this.renderCards(state);
    this.renderHand(state);
    this.renderAdmin(state);
  }

  private focusedTask(state: PokerStateView): PokerStateView["current"] {
    if (state.readOnly) {
      if (state.tasks.length === 0) return null;
      const i = Math.min(Math.max(this.historyIndex, 0), state.tasks.length - 1);
      const task = state.tasks[i];
      return {
        title: task.title,
        revealed: true,
        average: task.average,
        recommended: task.recommended,
        votes: task.votes ?? [],
      };
    }
    return state.current;
  }

  // Список завершённых задач вверху: название и средняя оценка.
  private renderDone(state: PokerStateView): void {
    this.doneEl.innerHTML = "";
    state.tasks.forEach((task, i) => {
      const row = document.createElement("div");
      const selected = state.readOnly && i === this.historyIndex;
      row.className = "poker-done-row"
        + (state.readOnly ? " clickable" : "")
        + (selected ? " sel" : "");
      row.innerHTML = `<span class="poker-done-title"></span><span class="poker-done-avg"></span>`;
      (row.firstChild as HTMLElement).textContent = task.title;
      (row.lastChild as HTMLElement).textContent = formatAverage(task.average);
      if (state.readOnly) {
        row.onclick = () => {
          this.historyIndex = i;
          this.renderRoom();
        };
      }
      this.doneEl.appendChild(row);
    });
  }

  private renderCurrent(state: PokerStateView): void {
    const current = this.focusedTask(state);
    if (!current) {
      this.currentEl.textContent = state.readOnly
        ? "В этой сессии нет оценённых задач."
        : state.isAdmin
          ? "Добавьте задачу, чтобы начать голосование."
          : "Ждём, когда админ добавит задачу.";
      this.resultEl.textContent = "";
      return;
    }
    this.currentEl.textContent = current.revealed
      ? current.title
      : `Голосуем: ${current.title}`;
    if (current.revealed) {
      this.resultEl.textContent = current.average === null
        ? "Числовых голосов нет."
        : `Средняя: ${formatAverage(current.average)} · Рекомендуемая: ${current.recommended}`;
    } else {
      this.resultEl.textContent = "";
    }
  }

  // Карточки участников: до вскрытия — рубашки (своя карта видна себе),
  // после — аватар с одеждой и значение.
  private renderCards(state: PokerStateView): void {
    this.cardsEl.innerHTML = "";
    const current = this.focusedTask(state);
    if (current?.revealed) {
      for (const vote of current.votes) {
        this.cardsEl.appendChild(this.slot(vote.login, this.faceCard(vote.appearance, vote.value)));
      }
      return;
    }
    const myLogin = getLogin();
    for (const p of state.participants) {
      const mine = p.login === myLogin;
      let card: HTMLElement;
      if (!current || !p.voted) card = this.emptyCard();
      else if (mine && state.myVote) card = this.faceCard(p.appearance, state.myVote);
      else card = this.backCard();
      this.cardsEl.appendChild(this.slot(p.login + (p.admin ? " ★" : ""), card));
    }
  }

  private slot(label: string, card: HTMLElement): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "poker-slot";
    slot.appendChild(card);
    const login = document.createElement("div");
    login.className = "poker-login";
    login.textContent = label;
    slot.appendChild(login);
    return slot;
  }

  private faceCard(appearance: PlayerAppearance | null | undefined, value: string): HTMLElement {
    const card = document.createElement("div");
    card.className = "poker-card";
    const cv = document.createElement("canvas");
    cv.width = ICON_SIZE;
    cv.height = ICON_SIZE;
    const ctx = cv.getContext("2d");
    if (ctx && this.images) {
      drawAppearance(ctx, ICON_SIZE, appearance ?? defaultAppearance(), this.images);
    }
    card.appendChild(cv);
    const val = document.createElement("div");
    val.className = "poker-card-val";
    val.textContent = cardLabel(value);
    card.appendChild(val);
    return card;
  }

  private backCard(): HTMLElement {
    const card = document.createElement("div");
    card.className = "poker-card poker-card-back";
    return card;
  }

  private emptyCard(): HTMLElement {
    const card = document.createElement("div");
    card.className = "poker-card poker-card-empty";
    return card;
  }

  // Своя рука: доступна во время голосования, до вскрытия можно переголосовать.
  private renderHand(state: PokerStateView): void {
    this.handEl.innerHTML = "";
    if (state.readOnly) return;
    const current = this.focusedTask(state);
    if (!current || current.revealed) return;
    for (const value of CARDS) {
      const btn = document.createElement("button");
      btn.className = "poker-hand-card" + (state.myVote === value ? " sel" : "");
      btn.textContent = cardLabel(value);
      btn.onclick = () => {
        this.net.vote(value);
        btn.blur();
      };
      this.handEl.appendChild(btn);
    }
  }

  private renderAdmin(state: PokerStateView): void {
    this.adminEl.querySelectorAll(".poker-btn").forEach((b) => b.remove());
    if (state.readOnly) {
      this.taskForm.classList.add("hidden");
      const back = document.createElement("button");
      back.className = "poker-btn poker-btn-ghost";
      back.textContent = "К списку";
      back.onclick = () => this.backToLobby("");
      this.adminEl.appendChild(back);
      return;
    }
    if (!state.isAdmin) {
      this.taskForm.classList.add("hidden");
      return;
    }
    const voting = state.current !== null && !state.current.revealed;
    const revealed = state.current !== null && state.current.revealed;
    if (!voting) {
      const add = document.createElement("button");
      add.className = "poker-btn";
      add.textContent = "+ Задача";
      add.onclick = () => {
        this.taskForm.classList.toggle("hidden");
        if (!this.taskForm.classList.contains("hidden")) this.taskInput.focus();
      };
      this.adminEl.appendChild(add);
      if (revealed) {
        const revote = document.createElement("button");
        revote.className = "poker-btn poker-btn-revote";
        revote.type = "button";
        revote.textContent = "🔄";
        revote.title = "Переголосовать";
        revote.setAttribute("aria-label", "Переголосовать");
        revote.onclick = () => {
          this.taskForm.classList.add("hidden");
          this.net.revote();
        };
        this.adminEl.appendChild(revote);
      }
    } else {
      this.taskForm.classList.add("hidden");
      const finish = document.createElement("button");
      finish.className = "poker-btn";
      finish.textContent = "Завершить голосование";
      finish.onclick = () => this.net.finish();
      this.adminEl.appendChild(finish);
    }
    const closeRoom = document.createElement("button");
    closeRoom.className = "poker-btn poker-btn-danger";
    closeRoom.textContent = "Завершить покер";
    closeRoom.onclick = () => {
      if (confirm("Закрыть комнату для всех участников?")) this.net.close();
    };
    this.adminEl.appendChild(closeRoom);
  }
}

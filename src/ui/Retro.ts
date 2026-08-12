import { fetchRetroMemeBlob, fetchRetroRoom, getLogin, uploadRetroMeme } from "../net/api";
import type {
  RetroHistorySummary,
  RetroReactionView,
  RetroRoomSummary,
  RetroStateView,
  RetroStickerView,
} from "../net/realtime";
import { normalizeRetroState } from "../net/realtime";
import type { KeyConsumer } from "./KeyboardRouter";

const DEFAULT_ROOM_NAME = "Retro WDM";
const MOOD_FACES = ["😢", "😕", "😐", "🙂", "😄"];
const STICKER_EMOJIS = ["👍", "❤️", "😂", "😢", "🔥", "🎉"];
const MEME_EMOJI = "😂";
const STEPS: { id: string; label: string }[] = [
  { id: "mood", label: "Как настроение?" },
  { id: "good", label: "Что было хорошо?" },
  { id: "improve", label: "Что стоит улучшить?" },
  { id: "actions", label: "Что делаем?" },
  { id: "memes", label: "Мемы" },
  { id: "summary", label: "Итоги" },
];

export interface RetroNet {
  list(): void;
  create(name: string): void;
  join(roomId: string): void;
  leave(): void;
  close(): void;
  mood(value: number): void;
  addSticker(board: string, text: string): void;
  editSticker(stickerId: string, text: string): void;
  deleteSticker(stickerId: string): void;
  groupStickers(board: string, stickerIds: string[]): void;
  moveSticker(payload: {
    stickerId: string;
    board: string;
    ontoStickerId?: string | null;
    ontoGroupId?: string | null;
    toBoard?: boolean;
    beforeStickerId?: string | null;
  }): void;
  react(targetType: string, targetId: string, emoji: string): void;
  deleteMeme(memeId: string): void;
}

/** Ретроспектива команды: лобби + комната с этапами (как Planning Poker). */
export class Retro implements KeyConsumer {
  isOpen = false;

  private root = document.getElementById("retro")!;
  private lobbyEl = document.getElementById("retroLobby")!;
  private roomEl = document.getElementById("retroRoomView")!;
  private errorEl = document.getElementById("retroError")!;
  private activeRoomsEl = document.getElementById("retroActiveRooms")!;
  private historyRoomsEl = document.getElementById("retroHistoryRooms")!;
  private nameInput = document.getElementById("retroName") as HTMLInputElement;
  private roomNameEl = document.getElementById("retroRoomName")!;
  private timerEl = document.getElementById("retroTimer")!;
  private readonlyEl = document.getElementById("retroReadonly")!;
  private stepperEl = document.getElementById("retroStepper")!;
  private stageMood = document.getElementById("retroStageMood")!;
  private stageGood = document.getElementById("retroStageGood")!;
  private stageImprove = document.getElementById("retroStageImprove")!;
  private stageActions = document.getElementById("retroStageActions")!;
  private stageMemes = document.getElementById("retroStageMemes")!;
  private stageSummary = document.getElementById("retroStageSummary")!;
  private adminEl = document.getElementById("retroAdmin")!;
  private createForm = document.getElementById("retroCreateForm") as HTMLFormElement;

  private state: RetroStateView | null = null;
  private joinedRoomId: string | null = null;
  private viewingHistory = false;
  private deadline = 0;
  private timerId: number | null = null;
  private step = "mood";
  private selectedStickers = new Set<string>();
  private moodTimer: number | null = null;
  private memeBlobs = new Map<string, string>();
  private memeFileInput: HTMLInputElement;
  /** Черновик формы стикера — сохраняется между рендерами. */
  private compose: { board: string; mode: "add" | "edit"; stickerId?: string; text: string } | null = null;
  private reactMenu: HTMLElement | null = null;
  private onDocClickCloseMenu: ((e: MouseEvent) => void) | null = null;
  private boardResizeObs: ResizeObserver | null = null;
  private dragStickerId: string | null = null;
  private memeViewer = document.getElementById("retroMemeViewer")!;
  private memeViewerImg = document.getElementById("retroMemeViewerImg") as HTMLImageElement;

  constructor(private net: RetroNet) {
    document.getElementById("retroClose")!.onclick = () => this.close();
    document.getElementById("retroFull")!.onclick = () => {
      this.root.classList.toggle("maximized");
      // После смены размера окна доска должна пересчитать стикеры/мемы.
      if (this.isOpen && this.joinedRoomId) {
        requestAnimationFrame(() => {
          if (this.state) this.renderRoom();
        });
      }
    };

    this.createForm.onsubmit = (e) => {
      e.preventDefault();
      this.net.create(this.nameInput.value.trim() || DEFAULT_ROOM_NAME);
    };
    this.nameInput.addEventListener("keydown", (e) => e.stopPropagation());

    this.memeFileInput = document.createElement("input");
    this.memeFileInput.type = "file";
    this.memeFileInput.accept = "image/png,image/jpeg,image/webp,image/gif";
    this.memeFileInput.className = "hidden";
    this.memeFileInput.onchange = () => {
      const file = this.memeFileInput.files?.[0];
      this.memeFileInput.value = "";
      if (file) void this.uploadMemeFile(file);
    };
    document.body.appendChild(this.memeFileInput);

    document.getElementById("retroMemeViewerClose")!.onclick = () => this.closeMemeViewer();
    this.memeViewer.onclick = (e) => {
      if (e.target === this.memeViewer) this.closeMemeViewer();
    };
  }

  open(): void {
    this.isOpen = true;
    this.errorEl.textContent = "";
    this.viewingHistory = false;
    this.root.classList.remove("maximized");
    this.showLobby();
    this.root.classList.remove("hidden");
    this.net.list();
  }

  close(): void {
    if (!this.isOpen) return;
    if (this.joinedRoomId && !this.viewingHistory) this.net.leave();
    this.isOpen = false;
    this.joinedRoomId = null;
    this.viewingHistory = false;
    this.state = null;
    this.selectedStickers.clear();
    this.compose = null;
    this.hideReactMenu();
    this.disconnectBoardFit();
    this.closeMemeViewer();
    this.stopTimer();
    this.revokeMemeBlobs();
    this.root.classList.remove("maximized");
    this.root.classList.add("hidden");
  }

  onRooms(active: RetroRoomSummary[], history: RetroHistorySummary[]): void {
    if (!this.isOpen || this.joinedRoomId) return;
    this.renderActiveRooms(active);
    this.renderHistoryRooms(history);
  }

  onState(state: RetroStateView): void {
    if (!this.isOpen) return;
    this.viewingHistory = false;
    this.state = state;
    this.joinedRoomId = state.id;
    this.deadline = Date.now() + state.remainingMs;
    this.errorEl.textContent = "";
    this.lobbyEl.classList.add("hidden");
    this.roomEl.classList.remove("hidden");
    this.createForm.classList.add("hidden");
    this.startTimer();
    this.renderRoom();
  }

  onClosed(): void {
    if (!this.isOpen) return;
    this.backToLobby("Ретро завершено.");
  }

  onError(message: string): void {
    if (!this.isOpen) return;
    this.errorEl.textContent = message;
  }

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
      if (!this.memeViewer.classList.contains("hidden")) {
        this.closeMemeViewer();
        return true;
      }
      this.close();
      return true;
    }
    return false;
  }

  private showLobby(): void {
    this.joinedRoomId = null;
    this.state = null;
    this.viewingHistory = false;
    this.selectedStickers.clear();
    this.compose = null;
    this.hideReactMenu();
    this.disconnectBoardFit();
    this.stopTimer();
    this.roomEl.classList.add("hidden");
    this.lobbyEl.classList.remove("hidden");
    this.createForm.classList.remove("hidden");
    this.nameInput.value = DEFAULT_ROOM_NAME;
    this.activeRoomsEl.innerHTML = "";
    this.historyRoomsEl.innerHTML = "";
  }

  private backToLobby(message: string): void {
    this.showLobby();
    this.errorEl.textContent = message;
    this.net.list();
  }

  private renderActiveRooms(rooms: RetroRoomSummary[]): void {
    this.activeRoomsEl.innerHTML = "";
    if (rooms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "retro-empty";
      empty.textContent = "Активных комнат нет — создайте свою.";
      this.activeRoomsEl.appendChild(empty);
      return;
    }
    for (const room of rooms) {
      const btn = document.createElement("button");
      btn.className = "retro-room-btn";
      btn.innerHTML = `<span class="retro-room-title"></span><span class="retro-room-meta"></span>`;
      (btn.firstChild as HTMLElement).textContent = room.name;
      (btn.lastChild as HTMLElement).textContent =
        `админ: ${room.adminLogin} · участников: ${room.participants}`;
      btn.onclick = () => this.net.join(room.id);
      this.activeRoomsEl.appendChild(btn);
    }
  }

  private renderHistoryRooms(rooms: RetroHistorySummary[]): void {
    this.historyRoomsEl.innerHTML = "";
    if (rooms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "retro-empty";
      empty.textContent = "Прошедших ретро пока нет.";
      this.historyRoomsEl.appendChild(empty);
      return;
    }
    for (const room of rooms) {
      const btn = document.createElement("button");
      btn.className = "retro-room-btn history";
      btn.innerHTML = `<span class="retro-room-title"></span><span class="retro-room-meta"></span>`;
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
      const raw = await fetchRetroRoom(roomId);
      const state = normalizeRetroState(raw);
      this.viewingHistory = true;
      this.joinedRoomId = state.id;
      this.state = state;
      this.lobbyEl.classList.add("hidden");
      this.roomEl.classList.remove("hidden");
      this.createForm.classList.add("hidden");
      this.stopTimer();
      this.timerEl.textContent = "";
      this.renderRoom();
    } catch (e) {
      this.errorEl.textContent = e instanceof Error ? e.message : "Не удалось открыть ретро.";
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

  private tickTimer(): void {
    if (this.viewingHistory || !this.state || this.state.readOnly) {
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
    this.timerEl.textContent = `до закрытия ${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  private renderRoom(): void {
    const state = this.state!;
    this.roomNameEl.textContent = state.name;
    this.readonlyEl.classList.toggle("hidden", !state.readOnly);
    this.renderStepper();
    this.renderStages();
    this.renderAdmin(state);
  }

  private renderStepper(): void {
    this.stepperEl.innerHTML = "";
    for (const s of STEPS) {
      const btn = document.createElement("button");
      btn.className = "retro-step" + (this.step === s.id ? " active" : "");
      btn.textContent = s.label;
      btn.onclick = () => {
        this.step = s.id;
        this.selectedStickers.clear();
        this.hideReactMenu();
        this.renderRoom();
      };
      this.stepperEl.appendChild(btn);
    }
  }

  private renderStages(): void {
    const stages: Record<string, HTMLElement> = {
      mood: this.stageMood,
      good: this.stageGood,
      improve: this.stageImprove,
      actions: this.stageActions,
      memes: this.stageMemes,
      summary: this.stageSummary,
    };
    for (const [id, el] of Object.entries(stages)) {
      el.classList.toggle("hidden", id !== this.step);
    }
    if (this.step === "mood") this.renderMood();
    else if (this.step === "good") this.renderBoard("good", this.stageGood);
    else if (this.step === "improve") this.renderBoard("improve", this.stageImprove);
    else if (this.step === "actions") this.renderBoard("actions", this.stageActions);
    else if (this.step === "memes") this.renderMemes();
    else this.renderSummary();
  }

  private renderMood(): void {
    const state = this.state!;
    const myLogin = getLogin();
    const mine = state.moods.find((m) => m.login === myLogin);
    const value = mine?.value ?? 0.5;

    this.stageMood.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "retro-mood-wrap";

    const faces = document.createElement("div");
    faces.className = "retro-mood-faces";
    for (const f of MOOD_FACES) {
      const span = document.createElement("span");
      span.textContent = f;
      faces.appendChild(span);
    }
    wrap.appendChild(faces);

    const bar = document.createElement("div");
    bar.className = "retro-mood-bar";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1000";
    slider.value = String(Math.round(value * 1000));
    slider.className = "retro-mood-slider";
    slider.disabled = state.readOnly;
    slider.addEventListener("keydown", (e) => e.stopPropagation());
    slider.oninput = () => {
      const v = Number(slider.value) / 1000;
      this.scheduleMood(v);
      this.renderMoodMarkers(wrap, state, v);
    };
    bar.appendChild(slider);
    wrap.appendChild(bar);
    this.stageMood.appendChild(wrap);
    this.renderMoodMarkers(wrap, state, value);
  }

  private renderMoodMarkers(wrap: HTMLElement, state: RetroStateView, myValue: number): void {
    wrap.querySelector(".retro-mood-markers")?.remove();
    const markers = document.createElement("div");
    markers.className = "retro-mood-markers";
    const myLogin = getLogin();
    const entries = [...state.moods];
    const hasMine = entries.some((m) => m.login === myLogin);
    if (!state.readOnly && myLogin && !hasMine) {
      entries.push({ login: myLogin, role: null, value: myValue });
    }

    const bar = wrap.querySelector(".retro-mood-bar") as HTMLElement | null;
    const barWidth = Math.max(bar?.clientWidth || wrap.clientWidth || 480, 160);
    const labelWidthPx = (text: string) => Math.min(90, Math.max(32, text.length * 7.2 + 16));
    const laneH = 28;
    const gapPx = 6;

    const items = entries.map((mood) => {
      const isMine = mood.login === myLogin;
      const value = isMine ? myValue : mood.value;
      const text = isMine ? "Вы" : mood.login;
      return { isMine, value, text, width: labelWidthPx(text) };
    });
    items.sort((a, b) => a.value - b.value || a.text.localeCompare(b.text));

    const laneRight: number[] = [];
    const lanes: number[] = [];
    for (const item of items) {
      const cx = item.value * barWidth;
      const left = cx - item.width / 2;
      const right = cx + item.width / 2;
      let lane = 0;
      while (lane < laneRight.length && left < laneRight[lane] + gapPx) lane++;
      if (lane === laneRight.length) laneRight.push(right);
      else laneRight[lane] = right;
      lanes.push(lane);
    }

    const laneCount = Math.max(1, laneRight.length);
    markers.style.height = `${36 + (laneCount - 1) * laneH}px`;

    items.forEach((item, i) => {
      const lane = lanes[i];
      const dot = document.createElement("div");
      dot.className = "retro-mood-dot" + (item.isMine ? " mine" : "");
      dot.style.left = `${item.value * 100}%`;
      if (lane > 0) {
        const stem = document.createElement("div");
        stem.className = "retro-mood-dot-stem";
        stem.style.height = `${lane * laneH}px`;
        dot.appendChild(stem);
      }
      const arrow = document.createElement("div");
      arrow.className = "retro-mood-dot-arrow";
      const label = document.createElement("div");
      label.className = "retro-mood-dot-label" + (item.isMine ? " mine" : "");
      label.textContent = item.text;
      dot.appendChild(arrow);
      dot.appendChild(label);
      markers.appendChild(dot);
    });

    wrap.appendChild(markers);
  }

  private scheduleMood(value: number): void {
    if (this.moodTimer !== null) clearTimeout(this.moodTimer);
    this.moodTimer = window.setTimeout(() => {
      this.moodTimer = null;
      this.net.mood(value);
    }, 100);
  }

  private renderBoard(board: string, container: HTMLElement): void {
    const state = this.state!;
    const stickers = state.stickers[board] ?? [];
    container.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "retro-board-toolbar";
    if (!state.readOnly) {
      const add = document.createElement("button");
      add.className = "retro-btn";
      add.textContent = "+";
      add.onclick = () => {
        this.compose = { board, mode: "add", text: "" };
        this.renderRoom();
      };
      toolbar.appendChild(add);
      if (this.selectedStickers.size >= 2) {
        const group = document.createElement("button");
        group.className = "retro-btn retro-btn-ghost";
        group.textContent = "Объединить";
        group.onclick = () => {
          this.net.groupStickers(board, [...this.selectedStickers]);
          this.selectedStickers.clear();
        };
        toolbar.appendChild(group);
      }
    }
    container.appendChild(toolbar);

    if (this.compose && this.compose.board === board) {
      container.appendChild(this.composeFormEl());
    }

    const boardEl = document.createElement("div");
    boardEl.className = `retro-board ${board}`;
    boardEl.style.setProperty("--sticker-size", "140px");
    boardEl.dataset.board = board;

    if (!state.readOnly) {
      this.bindBoardDrop(boardEl, board);
    }

    for (const cluster of clusterStickers(stickers)) {
      if (cluster.type === "group") {
        const groupEl = document.createElement("div");
        groupEl.className = "retro-group";
        groupEl.dataset.groupId = cluster.id;
        for (const s of cluster.items) groupEl.appendChild(this.stickerEl(s, state.readOnly));
        if (!state.readOnly) this.bindGroupDrop(groupEl, board, cluster.id);
        boardEl.appendChild(groupEl);
      } else {
        boardEl.appendChild(this.stickerEl(cluster.item, state.readOnly));
      }
    }
    container.appendChild(boardEl);
    this.observeBoardFit(boardEl, stickers.length, "sticker");
  }

  private bindBoardDrop(boardEl: HTMLElement, board: string): void {
    boardEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (this.dragStickerId) boardEl.classList.add("drag-over-board");
    });
    boardEl.addEventListener("dragleave", (e) => {
      if (e.target === boardEl) boardEl.classList.remove("drag-over-board");
    });
    boardEl.addEventListener("drop", (e) => {
      e.preventDefault();
      boardEl.classList.remove("drag-over-board");
      const stickerId = e.dataTransfer?.getData("text/sticker-id") || this.dragStickerId;
      if (!stickerId) return;
      // Если дроп пришёл на доску (не перехвачен стикером/группой) — вытащить из группы / переставить.
      const t = e.target as HTMLElement;
      if (t.closest(".retro-sticker") || t.closest(".retro-group")) return;
      const beforeStickerId = findBeforeStickerId(boardEl, e.clientX, e.clientY, stickerId);
      this.net.moveSticker({ stickerId, board, toBoard: true, beforeStickerId });
      this.dragStickerId = null;
    });
  }

  private bindGroupDrop(groupEl: HTMLElement, board: string, groupId: string): void {
    groupEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.dragStickerId) groupEl.classList.add("drag-over");
    });
    groupEl.addEventListener("dragleave", () => groupEl.classList.remove("drag-over"));
    groupEl.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      groupEl.classList.remove("drag-over");
      // Дроп на стикер внутри группы обрабатывает сам стикер.
      if ((e.target as HTMLElement).closest(".retro-sticker")) return;
      const stickerId = e.dataTransfer?.getData("text/sticker-id") || this.dragStickerId;
      if (!stickerId) return;
      this.net.moveSticker({ stickerId, board, ontoGroupId: groupId });
      this.dragStickerId = null;
    });
  }

  private composeFormEl(): HTMLElement {
    const draft = this.compose!;
    const form = document.createElement("div");
    form.className = "retro-sticker-compose";
    const ta = document.createElement("textarea");
    ta.maxLength = 500;
    ta.placeholder = "Текст стикера…";
    ta.value = draft.text;
    ta.addEventListener("keydown", (e) => e.stopPropagation());
    ta.oninput = () => {
      draft.text = ta.value;
    };
    const actions = document.createElement("div");
    actions.className = "retro-sticker-compose-actions";
    const save = document.createElement("button");
    save.className = "retro-btn";
    save.textContent = draft.mode === "edit" ? "Сохранить" : "Добавить";
    save.onclick = () => {
      const text = draft.text.trim();
      if (!text) return;
      if (draft.mode === "edit" && draft.stickerId) this.net.editSticker(draft.stickerId, text);
      else this.net.addSticker(draft.board, text);
      this.compose = null;
      this.renderRoom();
    };
    const cancel = document.createElement("button");
    cancel.className = "retro-btn retro-btn-ghost";
    cancel.textContent = "Отмена";
    cancel.onclick = () => {
      this.compose = null;
      this.renderRoom();
    };
    actions.appendChild(save);
    actions.appendChild(cancel);
    form.appendChild(ta);
    form.appendChild(actions);
    queueMicrotask(() => ta.focus());
    return form;
  }

  private stickerEl(sticker: RetroStickerView, readOnly: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = "retro-sticker" + (this.selectedStickers.has(sticker.id) ? " selected" : "");
    el.dataset.stickerId = sticker.id;
    const text = document.createElement("div");
    text.className = "retro-sticker-text";
    text.textContent = sticker.text;
    el.appendChild(text);
    const author = document.createElement("div");
    author.className = "retro-sticker-author";
    author.textContent = sticker.authorLogin;
    el.appendChild(author);

    if (!readOnly) {
      el.draggable = true;
      el.addEventListener("dragstart", (e) => {
        this.dragStickerId = sticker.id;
        el.classList.add("dragging");
        e.dataTransfer?.setData("text/sticker-id", sticker.id);
        e.dataTransfer?.setData("text/board", sticker.board);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      el.addEventListener("dragend", () => {
        el.classList.remove("dragging");
        this.dragStickerId = null;
        document.querySelectorAll(".retro-sticker.drag-over, .retro-group.drag-over, .retro-board.drag-over-board")
          .forEach((n) => n.classList.remove("drag-over", "drag-over-board"));
      });
      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.dragStickerId && this.dragStickerId !== sticker.id) el.classList.add("drag-over");
      });
      el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove("drag-over");
        const stickerId = e.dataTransfer?.getData("text/sticker-id") || this.dragStickerId;
        if (!stickerId || stickerId === sticker.id) return;
        this.net.moveSticker({
          stickerId,
          board: sticker.board,
          ontoStickerId: sticker.id,
        });
        this.dragStickerId = null;
      });

      el.onclick = (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (this.selectedStickers.has(sticker.id)) this.selectedStickers.delete(sticker.id);
        else this.selectedStickers.add(sticker.id);
        this.renderRoom();
      };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showReactMenu(e.clientX, e.clientY, "sticker", sticker.id, STICKER_EMOJIS);
      };
      if (sticker.mine) {
        const actions = document.createElement("div");
        actions.className = "retro-sticker-actions";
        const edit = document.createElement("button");
        edit.textContent = "✎";
        edit.title = "Редактировать";
        edit.onclick = (e) => {
          e.stopPropagation();
          this.compose = {
            board: sticker.board,
            mode: "edit",
            stickerId: sticker.id,
            text: sticker.text,
          };
          this.step = sticker.board === "good" ? "good"
            : sticker.board === "improve" ? "improve"
            : "actions";
          this.renderRoom();
        };
        const del = document.createElement("button");
        del.textContent = "✕";
        del.title = "Удалить";
        del.onclick = (e) => {
          e.stopPropagation();
          if (confirm("Удалить стикер?")) this.net.deleteSticker(sticker.id);
        };
        actions.appendChild(edit);
        actions.appendChild(del);
        el.appendChild(actions);
      }
    }

    el.appendChild(this.reactionsBar("sticker", sticker.id, sticker.reactions, readOnly));
    return el;
  }

  /** Только уже поставленные реакции; пустые слоты не рисуем. */
  private reactionsBar(
    targetType: string,
    targetId: string,
    reactions: RetroReactionView[],
    readOnly: boolean,
  ): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "retro-reactions";
    const myLogin = getLogin();
    for (const data of reactions) {
      if (!data.count) continue;
      const btn = document.createElement("button");
      const mine = !!data.logins.includes(myLogin ?? "");
      btn.className = "retro-react" + (mine ? " mine" : "");
      btn.textContent = `${data.emoji} ${data.count}`;
      btn.title = data.logins.join(", ");
      btn.disabled = readOnly;
      if (!readOnly) {
        btn.onclick = (e) => {
          e.stopPropagation();
          this.net.react(targetType, targetId, data.emoji);
        };
      }
      bar.appendChild(btn);
    }
    return bar;
  }

  private showReactMenu(
    x: number,
    y: number,
    targetType: string,
    targetId: string,
    emojis: string[],
  ): void {
    this.hideReactMenu();
    const menu = document.createElement("div");
    menu.className = "retro-react-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    for (const emoji of emojis) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = emoji;
      btn.title = emoji;
      btn.onclick = (e) => {
        e.stopPropagation();
        this.net.react(targetType, targetId, emoji);
        this.hideReactMenu();
      };
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    this.reactMenu = menu;
    // Не вылезти за край экрана
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;

    this.onDocClickCloseMenu = (e) => {
      if (this.reactMenu && !this.reactMenu.contains(e.target as Node)) this.hideReactMenu();
    };
    queueMicrotask(() => {
      if (this.onDocClickCloseMenu) document.addEventListener("mousedown", this.onDocClickCloseMenu);
    });
  }

  private hideReactMenu(): void {
    if (this.onDocClickCloseMenu) {
      document.removeEventListener("mousedown", this.onDocClickCloseMenu);
      this.onDocClickCloseMenu = null;
    }
    this.reactMenu?.remove();
    this.reactMenu = null;
  }

  private renderMemes(): void {
    const state = this.state!;
    this.stageMemes.innerHTML = "";
    const toolbar = document.createElement("div");
    toolbar.className = "retro-board-toolbar";
    if (!state.readOnly) {
      const add = document.createElement("button");
      add.className = "retro-btn";
      add.textContent = "+";
      add.onclick = () => this.openMemePicker();
      toolbar.appendChild(add);
      const paste = document.createElement("button");
      paste.className = "retro-btn retro-btn-ghost";
      paste.textContent = "Вставить картинку из буфера обмена";
      paste.onclick = () => void this.pasteMemeFromClipboard();
      toolbar.appendChild(paste);
      const hint = document.createElement("span");
      hint.style.opacity = "0.7";
      hint.style.fontSize = "13px";
      hint.textContent = "или Ctrl/⌘+V · реакция — ПКМ";
      toolbar.appendChild(hint);
    }
    this.stageMemes.appendChild(toolbar);

    const boardEl = document.createElement("div");
    boardEl.className = "retro-board memes";
    boardEl.style.setProperty("--meme-size", "160px");

    if (!state.readOnly) {
      boardEl.tabIndex = 0;
      boardEl.onpaste = (e) => {
        const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
        if (!item) return;
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void this.uploadMemeFile(file);
      };
    }

    for (const meme of state.memes) {
      const card = document.createElement("div");
      card.className = "retro-meme";
      const img = document.createElement("img");
      img.alt = "мем";
      void this.loadMemeImage(meme.imageUrl, img);
      card.appendChild(img);
      const author = document.createElement("div");
      author.className = "retro-meme-meta";
      author.textContent = meme.authorLogin;
      card.appendChild(author);
      img.onclick = (e) => {
        e.stopPropagation();
        void this.openMemeViewer(meme.imageUrl);
      };
      if (!state.readOnly) {
        card.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.showReactMenu(e.clientX, e.clientY, "meme", meme.id, [MEME_EMOJI]);
        };
      }
      card.appendChild(this.reactionsBar("meme", meme.id, meme.reactions, state.readOnly));
      if (!state.readOnly && meme.mine) {
        const del = document.createElement("button");
        del.className = "retro-btn retro-btn-danger";
        del.style.fontSize = "12px";
        del.style.padding = "4px 8px";
        del.textContent = "Удалить";
        del.onclick = (e) => {
          e.stopPropagation();
          if (confirm("Удалить мем?")) this.net.deleteMeme(meme.id);
        };
        card.appendChild(del);
      }
      boardEl.appendChild(card);
    }
    this.stageMemes.appendChild(boardEl);
    this.observeBoardFit(boardEl, state.memes.length, "meme");
  }

  private openMemePicker(): void {
    this.memeFileInput.click();
  }

  private async pasteMemeFromClipboard(): Promise<void> {
    if (!this.joinedRoomId || this.viewingHistory || this.state?.readOnly) return;
    this.errorEl.textContent = "";
    if (!navigator.clipboard?.read) {
      this.errorEl.textContent = "Браузер не даёт прочитать буфер. Вставьте картинку через Ctrl+V.";
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => /image\/(png|jpeg|webp|gif)/.test(t));
        if (!type) continue;
        const blob = await item.getType(type);
        const ext = type === "image/jpeg" ? "jpg" : type.slice("image/".length);
        const file = new File([blob], `clipboard.${ext}`, { type: blob.type || type });
        await this.uploadMemeFile(file);
        return;
      }
      this.errorEl.textContent = "В буфере нет картинки.";
    } catch (e) {
      if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        this.errorEl.textContent = "Нет доступа к буферу обмена. Разрешите доступ или вставьте картинку через Ctrl+V.";
        return;
      }
      this.errorEl.textContent = e instanceof Error ? e.message : "Не удалось вставить картинку из буфера.";
    }
  }

  private async openMemeViewer(imageUrl: string): Promise<void> {
    try {
      await this.loadMemeImage(imageUrl, this.memeViewerImg);
      this.memeViewer.classList.remove("hidden");
    } catch {
      this.errorEl.textContent = "Не удалось открыть мем.";
    }
  }

  private closeMemeViewer(): void {
    this.memeViewer.classList.add("hidden");
    this.memeViewerImg.removeAttribute("src");
  }

  private async uploadMemeFile(file: File): Promise<void> {
    if (!this.joinedRoomId || this.viewingHistory || this.state?.readOnly) return;
    try {
      this.errorEl.textContent = "";
      await uploadRetroMeme(this.joinedRoomId, file);
    } catch (e) {
      this.errorEl.textContent = e instanceof Error ? e.message : "Не удалось загрузить мем.";
    }
  }

  private async loadMemeImage(imageUrl: string, img: HTMLImageElement): Promise<void> {
    let blobUrl = this.memeBlobs.get(imageUrl);
    if (!blobUrl) {
      try {
        blobUrl = await fetchRetroMemeBlob(imageUrl);
        this.memeBlobs.set(imageUrl, blobUrl);
      } catch {
        img.alt = "не удалось загрузить";
        return;
      }
    }
    img.src = blobUrl;
  }

  private revokeMemeBlobs(): void {
    for (const url of this.memeBlobs.values()) URL.revokeObjectURL(url);
    this.memeBlobs.clear();
  }

  private renderSummary(): void {
    const state = this.state!;
    this.stageSummary.innerHTML = "";
    const root = document.createElement("div");
    root.className = "retro-summary";

    const moodBlock = document.createElement("div");
    moodBlock.className = "retro-summary-block";
    moodBlock.innerHTML = "<h3>Среднее настроение команды</h3>";
    const moods = state.moods;
    if (moods.length === 0) {
      const p = document.createElement("div");
      p.textContent = "Пока никто не оценил настроение.";
      moodBlock.appendChild(p);
    } else {
      // value 0..1 → шкала 1..5
      const avg01 = moods.reduce((s, m) => s + m.value, 0) / moods.length;
      const avg5 = avg01 * 4 + 1;
      const faceIdx = Math.min(MOOD_FACES.length - 1, Math.max(0, Math.round(avg01 * (MOOD_FACES.length - 1))));
      const face = MOOD_FACES[faceIdx];
      const row = document.createElement("div");
      row.className = "retro-summary-mood";
      row.textContent = `${face} ${avg5.toFixed(1)} / 5 · проголосовали: ${moods.length}`;
      moodBlock.appendChild(row);
    }
    root.appendChild(moodBlock);

    const actionsBlock = document.createElement("div");
    actionsBlock.className = "retro-summary-block";
    actionsBlock.innerHTML = "<h3>Что делаем?</h3>";
    const actions = state.stickers.actions ?? [];
    if (actions.length === 0) {
      const p = document.createElement("div");
      p.textContent = "Action item'ов пока нет.";
      actionsBlock.appendChild(p);
    } else {
      const list = document.createElement("div");
      list.className = "retro-board actions";
      list.style.minHeight = "auto";
      list.style.setProperty("--sticker-size", "140px");
      for (const s of actions) {
        const card = document.createElement("div");
        card.className = "retro-sticker";
        card.innerHTML = `<div class="retro-sticker-text"></div><div class="retro-sticker-author"></div>`;
        (card.firstChild as HTMLElement).textContent = s.text;
        (card.lastChild as HTMLElement).textContent = s.authorLogin;
        list.appendChild(card);
      }
      actionsBlock.appendChild(list);
      queueMicrotask(() => {
        const size = fitTileSize(actions.length, list.clientWidth || 600, Math.max(list.clientHeight, 200), {
          gap: 10,
          pad: 24,
          min: 72,
          max: 220,
          aspect: 0.7,
        });
        list.style.setProperty("--sticker-size", `${size}px`);
      });
    }
    root.appendChild(actionsBlock);

    const memeBlock = document.createElement("div");
    memeBlock.className = "retro-summary-block";
    memeBlock.innerHTML = "<h3>Лучший мем</h3>";
    const scored = state.memes.map((m) => {
      const laughs = m.reactions.find((r) => r.emoji === MEME_EMOJI)?.count ?? 0;
      return { meme: m, laughs };
    });
    const max = scored.reduce((a, b) => Math.max(a, b.laughs), 0);
    const best = scored.filter((s) => s.laughs === max && (max > 0 || scored.length > 0));
    if (state.memes.length === 0) {
      const p = document.createElement("div");
      p.textContent = "Мемов пока нет.";
      memeBlock.appendChild(p);
    } else {
      const title = document.createElement("div");
      title.style.marginBottom = "8px";
      title.textContent = max > 0 ? `Лучшие мемы (${max} ${MEME_EMOJI})` : "Все мемы (пока без реакций)";
      memeBlock.appendChild(title);
      const wrap = document.createElement("div");
      wrap.className = "retro-best-memes";
      for (const { meme, laughs } of best.length ? best : scored) {
        const card = document.createElement("div");
        card.className = "retro-meme";
        card.style.width = "180px";
        const img = document.createElement("img");
        img.alt = "мем";
        void this.loadMemeImage(meme.imageUrl, img);
        card.appendChild(img);
        const meta = document.createElement("div");
        meta.className = "retro-meme-meta";
        meta.textContent = `${meme.authorLogin} · ${MEME_EMOJI} ${laughs}`;
        card.appendChild(meta);
        img.style.cursor = "zoom-in";
        img.onclick = () => void this.openMemeViewer(meme.imageUrl);
        wrap.appendChild(card);
      }
      memeBlock.appendChild(wrap);
    }
    root.appendChild(memeBlock);
    this.stageSummary.appendChild(root);
  }

  private renderAdmin(state: RetroStateView): void {
    this.adminEl.innerHTML = "";
    if (state.readOnly || !state.isAdmin) return;
    const closeRoom = document.createElement("button");
    closeRoom.className = "retro-btn retro-btn-danger";
    closeRoom.textContent = "Завершить ретро";
    closeRoom.onclick = () => {
      if (confirm("Вы действительно хотите завершить ретро?")) this.net.close();
    };
    this.adminEl.appendChild(closeRoom);
  }

  /** Подгоняет размер плиток под текущую площадь доски (в т.ч. после fullscreen). */
  private observeBoardFit(boardEl: HTMLElement, count: number, kind: "sticker" | "meme"): void {
    this.disconnectBoardFit();
    const varName = kind === "sticker" ? "--sticker-size" : "--meme-size";
    const apply = () => {
      const w = boardEl.clientWidth;
      const h = boardEl.clientHeight;
      if (w < 40 || h < 40) return;
      const size = kind === "sticker"
        ? fitTileSize(count, w, h, { gap: 10, pad: 24, min: 72, max: 260, aspect: 0.7 })
        : fitTileSize(count, w, h, { gap: 10, pad: 24, min: 100, max: 280, aspect: 1.15 });
      boardEl.style.setProperty(varName, `${size}px`);
    };
    this.boardResizeObs = new ResizeObserver(() => apply());
    this.boardResizeObs.observe(boardEl);
    requestAnimationFrame(apply);
  }

  private disconnectBoardFit(): void {
    this.boardResizeObs?.disconnect();
    this.boardResizeObs = null;
  }
}

/** Максимальный размер плитки, при котором count штук влезает в доску. */
function fitTileSize(
  count: number,
  boardW: number,
  boardH: number,
  opts: { gap: number; pad: number; min: number; max: number; aspect: number },
): number {
  if (count <= 0) return Math.min(opts.max, Math.floor((boardW - opts.pad) / 2) || opts.max);
  const availW = Math.max(opts.min, boardW - opts.pad);
  const availH = Math.max(opts.min, boardH - opts.pad);
  const maxByBoard = Math.min(
    opts.max,
    Math.floor(availW),
    Math.floor(availH / opts.aspect),
  );
  let best = opts.min;
  for (let s = Math.max(opts.min, maxByBoard); s >= opts.min; s -= 2) {
    const cols = Math.max(1, Math.floor((availW + opts.gap) / (s + opts.gap)));
    const rows = Math.ceil(count / cols);
    const needH = rows * (s * opts.aspect + opts.gap) - opts.gap;
    if (needH <= availH + 0.5) {
      best = s;
      break;
    }
  }
  return best;
}

/** Кластеры по порядку: при первом groupId собираем ВСЕ стикеры этой группы (не только подряд). */
function clusterStickers(stickers: RetroStickerView[]): Array<
  | { type: "group"; id: string; items: RetroStickerView[] }
  | { type: "single"; item: RetroStickerView }
> {
  const out: Array<
    | { type: "group"; id: string; items: RetroStickerView[] }
    | { type: "single"; item: RetroStickerView }
  > = [];
  const seenGroups = new Set<string>();
  for (const s of stickers) {
    if (!s.groupId) {
      out.push({ type: "single", item: s });
      continue;
    }
    if (seenGroups.has(s.groupId)) continue;
    seenGroups.add(s.groupId);
    const items = stickers.filter((x) => x.groupId === s.groupId);
    out.push({ type: "group", id: s.groupId, items });
  }
  return out;
}

/** Ближайший стикер справа/ниже точки дропа — для вставки before. */
function findBeforeStickerId(
  boardEl: HTMLElement,
  x: number,
  y: number,
  excludeId: string,
): string | null {
  let best: { id: string; dist: number } | null = null;
  for (const node of boardEl.querySelectorAll<HTMLElement>(".retro-sticker")) {
    const id = node.dataset.stickerId;
    if (!id || id === excludeId) continue;
    const r = node.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    // Берём стикеры, центр которых правее или ниже точки дропа.
    if (cx < x - 8 && cy < y - 8) continue;
    const dist = Math.hypot(cx - x, cy - y);
    if (!best || dist < best.dist) best = { id, dist };
  }
  return best?.id ?? null;
}

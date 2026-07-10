import { getToken } from "./api";

// Адрес WS берётся из VITE_WS_URL (задаётся при сборке), для dev — localhost.
const WS_BASE = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";
const RECONNECT_DELAY = 1000;

// Состояние чужого игрока в комнате (то, что приходит с сервера).
export interface RemoteState {
  id: string;
  login: string;
  role: string;
  x: number;
  y: number;
  facing: boolean;
}

// Состояние физичного предмета в комнате (приходит с сервера). Сервер знает
// только предметы, по которым уже били: остальные стоят на точках из карты.
export interface RemoteItemState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// Активная покер-комната в лобби.
export interface PokerRoomSummary {
  id: string;
  name: string;
  adminLogin: string;
  participants: number;
}

export interface PokerParticipantView {
  login: string;
  role: string;
  admin: boolean;
  voted: boolean;
}

// Вскрытый голос (после завершения голосования).
export interface PokerVoteView {
  login: string;
  role: string;
  value: string;
}

export interface PokerCurrentView {
  title: string;
  revealed: boolean;
  average: number | null;
  recommended: number | null;
  votes: PokerVoteView[];
}

export interface PokerDoneTaskView {
  title: string;
  average: number | null;
  recommended: number | null;
}

// Полное состояние покер-комнаты (персонализировано сервером: isAdmin, myVote).
export interface PokerStateView {
  id: string;
  name: string;
  isAdmin: boolean;
  remainingMs: number;
  myVote: string | null;
  participants: PokerParticipantView[];
  current: PokerCurrentView | null;
  tasks: PokerDoneTaskView[];
}

export interface RealtimeHandlers {
  onOpen?: () => void; // соединение открыто (в т.ч. после реконнекта) — здесь шлём join
  onSnapshot?: (players: RemoteState[]) => void;
  onJoined?: (player: RemoteState) => void;
  onMoved?: (id: string, x: number, y: number, facing: boolean) => void;
  onChat?: (id: string, login: string, text: string) => void;
  onEmote?: (id: string, emote: string) => void;
  onLeft?: (id: string) => void;
  onItems?: (items: RemoteItemState[]) => void; // снапшот предметов комнаты
  onItemKicked?: (itemId: string, kickId: string, x: number, y: number, vx: number, vy: number) => void;
  onItemMoved?: (itemId: string, x: number, y: number, vx: number, vy: number) => void;
  onPokerRooms?: (rooms: PokerRoomSummary[]) => void;
  onPokerState?: (state: PokerStateView) => void;
  onPokerClosed?: () => void;
  onPokerError?: (message: string) => void;
}

// Клиент реалтайма мультиплеера. Токен передаётся в query (браузерный WebSocket не
// умеет слать заголовки). При обрыве — авто-реконнект; после переподключения снова
// зовётся onOpen, чтобы владелец переслал join для текущей комнаты.
export class Realtime {
  private ws: WebSocket | null = null;
  private handlers: RealtimeHandlers = {};
  private closedByUs = false;

  connect(handlers: RealtimeHandlers): void {
    this.handlers = handlers;
    this.closedByUs = false;
    this.open();
  }

  disconnect(): void {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }

  join(role: string, locationId: string, x: number, y: number, facing: boolean): void {
    this.send({ type: "join", role, locationId, x, y, facing });
  }

  room(locationId: string, x: number, y: number, facing: boolean): void {
    this.send({ type: "room", locationId, x, y, facing });
  }

  move(x: number, y: number, facing: boolean): void {
    this.send({ type: "move", x, y, facing });
  }

  chat(text: string): void {
    this.send({ type: "chat", text });
  }

  emote(emote: string): void {
    this.send({ type: "emote", emote });
  }

  // Удар по предмету: сервер выбирает один из конкурентных ударов и рассылает itemKicked.
  itemKick(itemId: string, kickId: string, x: number, y: number, vx: number, vy: number): void {
    this.send({ type: "itemKick", itemId, kickId, x, y, vx, vy });
  }

  // Стрим позиции предмета владельцем (последним ударившим).
  itemMove(itemId: string, x: number, y: number, vx: number, vy: number): void {
    this.send({ type: "itemMove", itemId, x, y, vx, vy });
  }

  pokerList(): void {
    this.send({ type: "pokerList" });
  }

  pokerCreate(name: string): void {
    this.send({ type: "pokerCreate", name });
  }

  pokerJoin(roomId: string): void {
    this.send({ type: "pokerJoin", roomId });
  }

  pokerLeave(): void {
    this.send({ type: "pokerLeave" });
  }

  pokerAddTask(title: string): void {
    this.send({ type: "pokerAddTask", title });
  }

  pokerVote(value: string): void {
    this.send({ type: "pokerVote", value });
  }

  pokerFinish(): void {
    this.send({ type: "pokerFinish" });
  }

  pokerClose(): void {
    this.send({ type: "pokerClose" });
  }

  private open(): void {
    const token = getToken() ?? "";
    const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.addEventListener("open", () => this.handlers.onOpen?.());
    ws.addEventListener("message", (e) => this.dispatch(JSON.parse(e.data)));
    ws.addEventListener("close", () => {
      if (!this.closedByUs) setTimeout(() => this.open(), RECONNECT_DELAY);
    });
  }

  private dispatch(msg: any): void {
    switch (msg.type) {
      case "snapshot": this.handlers.onSnapshot?.(msg.players); break;
      case "joined": this.handlers.onJoined?.(msg.player); break;
      case "moved": this.handlers.onMoved?.(msg.id, msg.x, msg.y, msg.facing); break;
      case "chat": this.handlers.onChat?.(msg.id, msg.login, msg.text); break;
      case "emote": this.handlers.onEmote?.(msg.id, msg.emote); break;
      case "left": this.handlers.onLeft?.(msg.id); break;
      case "items": this.handlers.onItems?.(msg.items); break;
      case "itemKicked": this.handlers.onItemKicked?.(msg.itemId, msg.kickId, msg.x, msg.y, msg.vx, msg.vy); break;
      case "itemMoved": this.handlers.onItemMoved?.(msg.itemId, msg.x, msg.y, msg.vx, msg.vy); break;
      case "pokerRooms": this.handlers.onPokerRooms?.(msg.rooms); break;
      case "pokerState": this.handlers.onPokerState?.(msg); break;
      case "pokerClosed": this.handlers.onPokerClosed?.(); break;
      case "pokerError": this.handlers.onPokerError?.(msg.message); break;
    }
  }

  private send(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

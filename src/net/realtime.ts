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

export interface RealtimeHandlers {
  onOpen?: () => void; // соединение открыто (в т.ч. после реконнекта) — здесь шлём join
  onSnapshot?: (players: RemoteState[]) => void;
  onJoined?: (player: RemoteState) => void;
  onMoved?: (id: string, x: number, y: number, facing: boolean) => void;
  onChat?: (id: string, login: string, text: string) => void;
  onLeft?: (id: string) => void;
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
      case "left": this.handlers.onLeft?.(msg.id); break;
    }
  }

  private send(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

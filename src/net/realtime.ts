import { getToken } from "./api";

// Адрес WS берётся из VITE_WS_URL (задаётся при сборке), для dev — localhost.
const WS_BASE = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";
const RECONNECT_DELAY = 1000;

// Состояние чужого игрока в комнате (то, что приходит с сервера).
// heldItemType — предмет в его лапах (null — руки пусты).
export interface RemoteState {
  id: string;
  login: string;
  role: string;
  x: number;
  y: number;
  facing: boolean;
  heldItemId: string | null;
  heldItemType: string | null;
}

// Предмет, стоящий на столе (виден всем в локации). expiresAt — epoch ms.
export interface RemotePlacedItem {
  id: string;
  type: string;
  tableIndex: number;
  x: number;
  y: number;
  expiresAt: number;
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

/** Состояние проектора в локации (владелец колоды — id персонажа). */
export interface ProjectorStateView {
  on: boolean;
  ownerId: string | null;
  index: number;
}

export type AirHockeySide = "red" | "blue";

export interface AirHockeyLobbyView {
  redSessionId: string | null;
  redLogin: string | null;
  blueSessionId: string | null;
  blueLogin: string | null;
  phase: string;
}

export interface AirHockeyStateView {
  phase: string;
  mySide: AirHockeySide | null;
  redScore: number;
  blueScore: number;
  remainingMs: number;
  puckX: number;
  puckY: number;
  myX: number;
  myY: number;
  oppX: number;
  oppY: number;
  redLogin: string | null;
  blueLogin: string | null;
  redConnected: boolean;
  blueConnected: boolean;
  winnerSide: AirHockeySide | null;
  winnerLogin: string | null;
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
  onItemDropped?: (itemId: string, itemType: string, x: number, y: number) => void; // предмет бросили на пол
  onPlacedItems?: (items: RemotePlacedItem[]) => void;          // снапшот предметов на столах
  onItemPlaced?: (item: RemotePlacedItem) => void;              // кто-то поставил предмет на стол
  onItemRemoved?: (itemId: string) => void;                     // предмет убрали со стола
  onItemHeld?: (id: string, itemId: string, itemType: string) => void; // игрок взял предмет в лапы
  onItemReleased?: (id: string) => void;                        // игрок освободил лапы
  onPokerRooms?: (rooms: PokerRoomSummary[]) => void;
  onPokerState?: (state: PokerStateView) => void;
  onPokerClosed?: () => void;
  onPokerError?: (message: string) => void;
  onProjectorState?: (state: ProjectorStateView) => void;
  onAchievement?: (code: string, title: string, description: string, image: string) => void; // выдана ачивка
  onAirHockeyLobby?: (lobby: AirHockeyLobbyView) => void;
  onAirHockeyState?: (state: AirHockeyStateView) => void;
  onAirHockeyError?: (message: string) => void;
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

  // Взял предмет в лапы: остальные нарисуют его на мне и уберут из мира.
  itemGrab(itemId: string, itemType: string): void {
    this.send({ type: "itemGrab", itemId, itemType });
  }

  // Бросил мяч на пол — он замирает в этой точке у всех.
  itemDrop(itemId: string, itemType: string, x: number, y: number): void {
    this.send({ type: "itemDrop", itemId, itemType, x, y });
  }

  // Поставил чашку на стол (место tableIndex из слоя tables).
  itemPlace(itemId: string, itemType: string, tableIndex: number, x: number, y: number): void {
    this.send({ type: "itemPlace", itemId, itemType, tableIndex, x, y });
  }

  // У предмета в лапах вышел срок (чашка кофе) — руки свободны.
  itemGone(itemId: string): void {
    this.send({ type: "itemGone", itemId });
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

  projectorOn(ownerId: string): void {
    this.send({ type: "projectorOn", ownerId });
  }

  projectorOff(): void {
    this.send({ type: "projectorOff" });
  }

  projectorIndex(index: number): void {
    this.send({ type: "projectorIndex", index });
  }

  airhockeyJoin(side: AirHockeySide): void {
    this.send({ type: "airhockeyJoin", side });
  }

  airhockeyLeave(): void {
    this.send({ type: "airhockeyLeave" });
  }

  airhockeyPaddle(x: number, y: number): void {
    this.send({ type: "airhockeyPaddle", x, y });
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
      case "itemDropped": this.handlers.onItemDropped?.(msg.itemId, msg.itemType, msg.x, msg.y); break;
      case "placedItems": this.handlers.onPlacedItems?.(msg.items); break;
      case "itemPlaced": this.handlers.onItemPlaced?.(msg.item); break;
      case "itemRemoved": this.handlers.onItemRemoved?.(msg.itemId); break;
      case "itemHeld": this.handlers.onItemHeld?.(msg.id, msg.itemId, msg.itemType); break;
      case "itemReleased": this.handlers.onItemReleased?.(msg.id); break;
      case "pokerRooms": this.handlers.onPokerRooms?.(msg.rooms); break;
      case "pokerState": this.handlers.onPokerState?.(msg); break;
      case "pokerClosed": this.handlers.onPokerClosed?.(); break;
      case "pokerError": this.handlers.onPokerError?.(msg.message); break;
      case "projectorState":
        this.handlers.onProjectorState?.({
          on: !!msg.on,
          ownerId: msg.ownerId ?? null,
          index: msg.index ?? 0,
        });
        break;
      case "achievement": this.handlers.onAchievement?.(msg.code, msg.title, msg.description, msg.image); break;
      case "airhockeyLobby":
        this.handlers.onAirHockeyLobby?.({
          redSessionId: msg.redSessionId ?? null,
          redLogin: msg.redLogin ?? null,
          blueSessionId: msg.blueSessionId ?? null,
          blueLogin: msg.blueLogin ?? null,
          phase: msg.phase ?? "idle",
        });
        break;
      case "airhockeyState":
        this.handlers.onAirHockeyState?.(parseAirHockeyState(msg));
        break;
      case "airhockeyError": this.handlers.onAirHockeyError?.(msg.message); break;
    }
  }

  private send(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

/** Поле аэрохоккея (как на сервере). Нужно только для legacy-стейта. */
const AH_W = 420;
const AH_H = 700;

/**
 * Сервер шлёт плоские координаты ВИДА (my/opp/puck).
 * Старый формат с redPaddle/bluePaddle/puck в абсолюте — конвертим на клиенте.
 */
function parseAirHockeyState(msg: any): AirHockeyStateView {
  const mySide: AirHockeySide | null = msg.mySide ?? null;
  const base = {
    phase: msg.phase ?? "idle",
    mySide,
    redScore: msg.redScore ?? 0,
    blueScore: msg.blueScore ?? 0,
    remainingMs: msg.remainingMs ?? 0,
    redLogin: msg.redLogin ?? null,
    blueLogin: msg.blueLogin ?? null,
    redConnected: msg.redConnected !== false,
    blueConnected: msg.blueConnected !== false,
    winnerSide: msg.winnerSide ?? null,
    winnerLogin: msg.winnerLogin ?? null,
  };

  // Новый протокол: уже вид получателя.
  if (msg.puckX != null || msg.oppX != null || msg.myX != null) {
    return {
      ...base,
      puckX: num(msg.puckX, AH_W * 0.5),
      puckY: num(msg.puckY, AH_H * 0.5),
      myX: num(msg.myX, AH_W * 0.5),
      myY: num(msg.myY, AH_H * 0.78),
      oppX: num(msg.oppX, AH_W * 0.5),
      oppY: num(msg.oppY, AH_H * 0.22),
    };
  }

  // Legacy: абсолютные nested-координаты → вид.
  const flip = mySide === "blue";
  const toView = (x: number, y: number) =>
    flip ? { x: AH_W - x, y: AH_H - y } : { x, y };
  const puck = toView(num(msg.puck?.x, AH_W * 0.5), num(msg.puck?.y, AH_H * 0.5));
  const red = {
    x: num(msg.redPaddle?.x, AH_W * 0.5),
    y: num(msg.redPaddle?.y, AH_H * 0.78),
  };
  const blue = {
    x: num(msg.bluePaddle?.x, AH_W * 0.5),
    y: num(msg.bluePaddle?.y, AH_H * 0.22),
  };
  const me = mySide === "blue" ? blue : red;
  const opp = mySide === "blue" ? red : blue;
  const meV = toView(me.x, me.y);
  const oppV = toView(opp.x, opp.y);
  return {
    ...base,
    puckX: puck.x,
    puckY: puck.y,
    myX: meV.x,
    myY: meV.y,
    oppX: oppV.x,
    oppY: oppV.y,
  };
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

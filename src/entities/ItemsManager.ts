import Phaser from "phaser";
import type { PlacedItemDef } from "../data/items";
import type { Rect } from "../scenes/LocationLoader";
import { PhysicsItem } from "./PhysicsItem";
import type { RemoteItemState } from "../net/realtime";

const KICK_COOLDOWN_MS = 350; // не бить один мяч чаще: игрок касается его много кадров подряд
const SYNC_INTERVAL_MS = 100; // частота стрима позиции владельцем (как у move игрока)
const REACH_Z = 64;           // выше этой высоты мяч не достать: физика предмета плоская
                              // (круги по x/y), без порога удар срабатывал бы по «тени»
                              // высоко летящего мяча

// Круглое препятствие для отскока: NPC или чужой игрок.
export interface ObstacleCircle {
  x: number;
  y: number;
  r: number;
}

// Игрок для взаимодействия с предметами: круг + текущая скорость.
export interface PlayerCircle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
}

// Предметы текущей локации: создание/снос при переходе, удары игрока, отскоки от
// препятствий и людей, сетевая синхронизация. Про сеть менеджер знает только через
// колбэки — их ставит WorldScene в мультиплеере, в одиночке они пустые.
export class ItemsManager {
  private items = new Map<string, PhysicsItem>();
  private physicsWalls: Rect[] = [];
  private syncAcc = 0;

  // Мой удар по предмету — отправить на сервер на арбитраж.
  onKick: ((itemId: string, kickId: string, x: number, y: number, vx: number, vy: number) => void) | null = null;
  // Стрим позиции предмета, которым я владею (последним ударил).
  onSync: ((itemId: string, x: number, y: number, vx: number, vy: number) => void) | null = null;

  constructor(private scene: Phaser.Scene) {}

  // Пересоздать предметы под локацию (вызывается из loadLocation, всё — из tmj:
  // точки предметов из слоя items, стены для них из слоя collisions_physics).
  load(defs: PlacedItemDef[], physicsWalls: Rect[]): void {
    this.physicsWalls = physicsWalls;
    for (const item of this.items.values()) item.destroy();
    this.items.clear();
    for (const def of defs) {
      this.items.set(def.id, new PhysicsItem(this.scene, def));
    }
  }

  update(delta: number, player: PlayerCircle | null, obstacles: ObstacleCircle[]): void {
    this.syncAcc += delta;
    const doSync = this.syncAcc >= SYNC_INTERVAL_MS;
    if (doSync) this.syncAcc = 0;

    for (const item of this.items.values()) {
      // Высоко летящий мяч пролетает над головами — персонажи его не касаются.
      if (item.height < REACH_Z) {
        for (const o of obstacles) item.bounceOffCircle(o.x, o.y, o.r);
        if (player) this.interactWithPlayer(item, player);
      }
      // Стены — последними: если мяч зажат между персонажем и стеной, побеждает
      // стена (мяч не должен оказаться внутри неё даже визуально).
      this.bounceOffWalls(item);
      item.update(delta);
      if (doSync) this.syncIfOwned(item);
    }
  }

  private bounceOffWalls(item: PhysicsItem): void {
    for (const w of this.physicsWalls) {
      item.bounceOffRect(w.x, w.y, w.x + w.w, w.y + w.h);
    }
  }

  // Касание игрока: движется — удар по направлению движения со случайной силой,
  // стоит — мяч просто упруго отскакивает от него.
  private interactWithPlayer(item: PhysicsItem, player: PlayerCircle): void {
    const moving = player.vx !== 0 || player.vy !== 0;
    if (!moving) {
      item.bounceOffCircle(player.x, player.y, player.r);
      return;
    }
    const touched = item.bounceOffCircle(player.x, player.y, player.r);
    if (!touched || this.scene.time.now < item.kickCooldownUntil) return;

    item.kickCooldownUntil = this.scene.time.now + KICK_COOLDOWN_MS;
    const len = Math.hypot(player.vx, player.vy);
    const force = Phaser.Math.FloatBetween(item.type.kickMin, item.type.kickMax);
    item.kick(player.vx / len, player.vy / len, force);

    // Оптимистично считаем себя владельцем; если сервер выберет чужой одновременный
    // удар, придёт itemKicked с чужим kickId и мы переключимся на него.
    item.ownedByMe = true;
    item.lastKickId = Math.random().toString(36).slice(2, 10);
    const v = item.base.body.velocity;
    this.onKick?.(item.id, item.lastKickId, Math.round(item.base.x), Math.round(item.base.y), Math.round(v.x), Math.round(v.y));
  }

  // Владелец стримит позицию, пока мяч движется, и один раз после остановки —
  // чтобы у всех совпала точка покоя.
  private syncIfOwned(item: PhysicsItem): void {
    if (!item.ownedByMe) return;
    const moving = item.isMoving();
    if (!moving && !item.wasMoving) return;
    item.wasMoving = moving;
    const v = item.base.body.velocity;
    this.onSync?.(item.id, Math.round(item.base.x), Math.round(item.base.y), Math.round(v.x), Math.round(v.y));
  }

  // Снапшот предметов комнаты с сервера (после join/room).
  applySnapshot(states: RemoteItemState[]): void {
    for (const s of states) this.items.get(s.id)?.applyState(s.x, s.y, s.vx, s.vy);
  }

  // Сервер принял чей-то удар. Своё эхо узнаём по kickId — его не применяем,
  // локальный мяч уже летит (позиция чуть точнее серверной копии).
  applyKicked(itemId: string, kickId: string, x: number, y: number, vx: number, vy: number): void {
    const item = this.items.get(itemId);
    if (!item || kickId === item.lastKickId) return;
    item.applyRemoteKick(x, y, vx, vy);
  }

  applyMoved(itemId: string, x: number, y: number, vx: number, vy: number): void {
    this.items.get(itemId)?.applyRemoteMove(x, y, vx, vy);
  }
}

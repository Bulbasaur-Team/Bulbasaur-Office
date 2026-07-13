import Phaser from "phaser";
import { ITEM_TYPES, type PlacedItemDef } from "../data/items";
import type { Rect } from "../scenes/LocationLoader";
import { PhysicsItem } from "./PhysicsItem";
import type { RemoteItemState, RemotePlacedItem } from "../net/realtime";

const KICK_COOLDOWN_MS = 350; // не бить один мяч чаще: игрок касается его много кадров подряд
const SYNC_INTERVAL_MS = 100; // частота стрима позиции владельцем (как у move игрока)
const REACH_Z = 64;           // выше этой высоты мяч не достать: физика предмета плоская
                              // (круги по x/y), без порога удар срабатывал бы по «тени»
                              // высоко летящего мяча
const GRAB_DIST = 60;         // на каком расстоянии можно схватить предмет
const DROP_AHEAD = 28;        // на сколько px впереди игрока кладётся брошенный мяч
const TABLE_REACH = 90;       // на каком расстоянии от места на столе можно поставить чашку

// Чашка, стоящая на столе: живёт между локациями (данные, не объект сцены), пока не
// истечёт срок. Заходя в локацию, из этих данных предмет пересоздаётся на своём месте.
// В мультиплеере источник правды — сервер, он же присылает эти записи всем в комнате.
interface PlacedCoffee {
  id: string;
  loc: string;
  tableIndex: number;
  x: number;
  y: number;
  expiresAt: number; // epoch ms
}

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
// препятствий и людей, захват/переноска и сетевая синхронизация. Про сеть менеджер
// знает только через колбэки — их ставит WorldScene в мультиплеере, в одиночке они пустые.
export class ItemsManager {
  private items = new Map<string, PhysicsItem>();
  private physicsWalls: Rect[] = [];
  private tableSpots: Rect[] = [];
  private loc = "";
  private carried: PhysicsItem | null = null;
  private placed = new Map<string, PlacedCoffee>();
  private syncAcc = 0;

  // Мой удар по предмету — отправить на сервер на арбитраж.
  onKick: ((itemId: string, kickId: string, x: number, y: number, vx: number, vy: number) => void) | null = null;
  // Стрим позиции предмета, которым я владею (последним ударил).
  onSync: ((itemId: string, x: number, y: number, vx: number, vy: number) => void) | null = null;
  // Взял предмет в лапы — остальные нарисуют его на мне.
  onGrab: ((itemId: string, itemType: string) => void) | null = null;
  // Бросил мяч на пол.
  onDrop: ((itemId: string, itemType: string, x: number, y: number) => void) | null = null;
  // Поставил чашку на стол.
  onPlace: ((itemId: string, itemType: string, tableIndex: number, x: number, y: number) => void) | null = null;
  // Предмет в лапах исчез сам (у чашки вышел срок).
  onGone: ((itemId: string) => void) | null = null;

  constructor(private scene: Phaser.Scene) {}

  // Пересоздать предметы под локацию (вызывается из loadLocation, всё — из tmj: точки
  // предметов из слоя items, стены для них из слоя collisions_physics, места под чашки —
  // из слоя tables). Взятый в лапы предмет переезжает с игроком, поэтому его не трогаем.
  load(defs: PlacedItemDef[], physicsWalls: Rect[], tableSpots: Rect[], loc: string): void {
    this.physicsWalls = physicsWalls;
    this.tableSpots = tableSpots;
    this.loc = loc;
    for (const item of this.items.values()) item.destroy();
    this.items.clear();
    for (const def of defs) {
      this.items.set(def.id, new PhysicsItem(this.scene, def));
    }
    for (const c of this.placed.values()) {
      if (c.loc === loc) this.spawnPlaced(c);
    }
  }

  private spawnPlaced(c: PlacedCoffee): void {
    if (Date.now() >= c.expiresAt) return;
    this.items.get(c.id)?.destroy();
    const item = new PhysicsItem(this.scene, { id: c.id, type: "coffee", x: c.x, y: c.y });
    item.expiresAt = c.expiresAt;
    item.place(c.x, c.y);
    this.items.set(c.id, item);
  }

  update(delta: number, player: PlayerCircle | null, obstacles: ObstacleCircle[]): void {
    this.pruneExpired();

    this.syncAcc += delta;
    const doSync = this.syncAcc >= SYNC_INTERVAL_MS;
    if (doSync) this.syncAcc = 0;

    for (const item of this.items.values()) {
      // Непинаемые предметы (чашка на столе) статичны: без ударов и синхронизации.
      if (!item.type.kickable) {
        item.update(delta);
        continue;
      }
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

  // Держим предмет ровно по центру спрайта игрока (зовётся каждый кадр из WorldScene).
  carry(x: number, y: number): void {
    this.carried?.carryTo(x, y);
  }

  carrying(): boolean {
    return this.carried !== null;
  }

  carriedIsCoffee(): boolean {
    return this.carried?.type.tableOnly === true;
  }

  // Можно ли прямо сейчас поставить предмет из лап: рядом есть свободное место на столе.
  canPlaceCarried(x: number, y: number): boolean {
    return this.carried?.type.tableOnly === true && this.freeTableNear(x, y) >= 0;
  }

  // Есть ли рядом предмет, который можно схватить (для подсказки).
  grabbableNear(x: number, y: number): boolean {
    return this.nearestGrabbable(x, y) !== null;
  }

  private nearestGrabbable(x: number, y: number): PhysicsItem | null {
    let best: PhysicsItem | null = null;
    let bestDist = GRAB_DIST;
    for (const item of this.items.values()) {
      if (!item.type.grabbable || item.height >= REACH_Z) continue;
      const d = Phaser.Math.Distance.Between(x, y, item.base.x, item.base.y);
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  // Схватить ближайший подходящий предмет. true — получилось.
  grabNear(x: number, y: number): boolean {
    if (this.carried) return false;
    const item = this.nearestGrabbable(x, y);
    if (!item) return false;
    this.items.delete(item.id);
    this.placed.delete(item.id); // если сняли со стола — место освободилось
    this.carried = item;
    this.onGrab?.(item.id, item.typeKey);
    return true;
  }

  // Выдать чашку кофе в лапы (кухня чилл-зоны). false — руки заняты.
  giveCoffee(x: number, y: number): boolean {
    if (this.carried) return false;
    const id = `coffee-${Math.random().toString(36).slice(2, 10)}`;
    const item = new PhysicsItem(this.scene, { id, type: "coffee", x, y });
    item.expiresAt = Date.now() + (ITEM_TYPES.coffee.ttlMs ?? 0);
    this.carried = item;
    this.onGrab?.(id, "coffee");
    return true;
  }

  // Поставить/бросить предмет из лап. Чашку — только на свободное место на столе.
  releaseCarried(x: number, y: number, facing: boolean): boolean {
    const item = this.carried;
    if (!item) return false;

    if (item.type.tableOnly) {
      const table = this.freeTableNear(x, y);
      if (table < 0) return false;
      const spot = this.tableSpots[table];
      const cx = spot.x + spot.w / 2;
      const cy = spot.y + spot.h / 2;
      item.place(cx, cy);
      this.items.set(item.id, item);
      this.placed.set(item.id, {
        id: item.id, loc: this.loc, tableIndex: table, x: cx, y: cy, expiresAt: item.expiresAt,
      });
      this.carried = null;
      this.onPlace?.(item.id, item.typeKey, table, cx, cy);
      return true;
    }

    const dropX = x + (facing ? DROP_AHEAD : -DROP_AHEAD);
    item.place(dropX, y);
    this.items.set(item.id, item);
    this.carried = null;
    this.onDrop?.(item.id, item.typeKey, dropX, y);
    return true;
  }

  // Индекс ближайшего свободного места на столе в пределах досягаемости; -1 — нет такого.
  private freeTableNear(x: number, y: number): number {
    let best = -1;
    let bestDist = TABLE_REACH;
    for (let i = 0; i < this.tableSpots.length; i++) {
      if (this.isTableTaken(i)) continue;
      const r = this.tableSpots[i];
      const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
      const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // На одно место — одна чашка.
  private isTableTaken(tableIndex: number): boolean {
    for (const c of this.placed.values()) {
      if (c.loc === this.loc && c.tableIndex === tableIndex) return true;
    }
    return false;
  }

  private pruneExpired(): void {
    const now = Date.now();
    if (this.carried && this.carried.expiresAt && now >= this.carried.expiresAt) {
      const id = this.carried.id;
      this.carried.destroy();
      this.carried = null;
      this.onGone?.(id);
    }
    for (const [id, c] of this.placed) {
      if (now >= c.expiresAt) this.placed.delete(id);
    }
    for (const [id, item] of this.items) {
      if (item.expiresAt && now >= item.expiresAt) {
        item.destroy();
        this.items.delete(id);
      }
    }
  }

  // --- события сервера ---

  // Кто-то поставил чашку на стол (или снапшот при входе в комнату).
  applyPlaced(item: RemotePlacedItem): void {
    const c: PlacedCoffee = {
      id: item.id, loc: this.loc, tableIndex: item.tableIndex,
      x: item.x, y: item.y, expiresAt: item.expiresAt,
    };
    this.placed.set(c.id, c);
    this.spawnPlaced(c);
  }

  // Чашку убрали со стола: забрали в лапы или вышел срок.
  applyRemoved(itemId: string): void {
    this.placed.delete(itemId);
    this.items.get(itemId)?.destroy();
    this.items.delete(itemId);
  }

  // Снапшот столов комнаты: серверный список — источник правды для этой локации.
  applyPlacedSnapshot(items: RemotePlacedItem[]): void {
    for (const [id, c] of this.placed) {
      if (c.loc === this.loc && !items.some((i) => i.id === id)) this.applyRemoved(id);
    }
    for (const item of items) this.applyPlaced(item);
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

  // Чужой игрок взял предмет: у нас в мире его больше нет (он «висит» на том игроке).
  applyHeldByOther(itemId: string): void {
    this.items.get(itemId)?.destroy();
    this.items.delete(itemId);
    this.placed.delete(itemId);
  }

  // Чужой игрок бросил предмет на пол. Пока предмет был в лапах, мы его уничтожили,
  // поэтому создаём заново — по типу, который прислал сервер.
  applyDropped(itemId: string, itemType: string, x: number, y: number): void {
    const known = this.items.get(itemId);
    if (known) {
      known.place(x, y);
      return;
    }
    if (!ITEM_TYPES[itemType]) return;
    const item = new PhysicsItem(this.scene, { id: itemId, type: itemType, x, y });
    item.place(x, y);
    this.items.set(itemId, item);
  }
}

import Phaser from "phaser";
import { CHARACTERS, type Character } from "../data/characters";
import type { LocationDef } from "../data/locations";
import { ITEM_TYPES, type PlacedItemDef } from "../data/items";
import { spriteScale } from "../entities/sprites";

export type Spawn = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

// NPC вместе с его позицией на карте (позиция берётся из слоя spawns, не из данных).
export interface PlacedNpc {
  char: Character;
  x: number;
  y: number;
}

export interface LoadedLocation {
  npcs: PlacedNpc[];                 // NPC этой локации с координатами
  doors: Map<string, Spawn>;         // двери (слой doors, ключ — id соседней локации)
  spawns: Map<string, Spawn>;        // точки появления персонажей (слой spawns, ключ — id персонажа)
  interactions: Map<string, Spawn>;  // интерактивные точки (слой interactions, напр. "tv")
  rects: Map<string, Rect>;          // прямоугольные объекты слоя interactions (напр. "tvScreen")
  items: PlacedItemDef[];            // физичные предметы (слой items, имя точки = тип предмета)
  physicsWalls: Rect[];              // стены для предметов (слой collisions_physics)
  tableRects: Rect[];                // столы для чашки кофе (слой tables)
  routes: Map<string, Spawn[]>;      // маршруты NPC (слой routes, polyline, имя = id маршрута)
}

// Строит сцену локации: фон, overlay двери, коллизии и NPC. Держит у себя список
// созданных объектов, чтобы снести их при переходе в следующую локацию.
export class LocationLoader {
  private scenery: Phaser.GameObjects.GameObject[] = [];

  constructor(
    private scene: Phaser.Scene,
    private walls: Phaser.Physics.Arcade.StaticGroup,
    private targetH: number,
    private doorOverlayDepth: number,
  ) {}

  load(cfg: LocationDef, locIndex: number, chosenId: string, hideNpcs = false): LoadedLocation {
    this.scenery.forEach((o) => o.destroy());
    this.scenery = [];
    this.walls.clear(true, true);

    this.scenery.push(this.scene.add.image(0, 0, cfg.bg).setOrigin(0).setDepth(0));

    if (cfg.overlay && this.scene.textures.exists(cfg.overlay)) {
      this.scenery.push(
        this.scene.add.image(0, 0, cfg.overlay).setOrigin(0).setDepth(this.doorOverlayDepth),
      );
    }

    const empty = () => new Map<string, Spawn>();
    const { doors, spawns, interactions, rects, items, physicsWalls, tableRects, routes } = cfg.map
      ? this.buildFromMap(cfg.map)
      : {
          doors: empty(), spawns: empty(), interactions: empty(),
          rects: new Map<string, Rect>(), items: [], physicsWalls: [], tableRects: [],
          routes: new Map<string, Spawn[]>(),
        };

    const npcs: PlacedNpc[] = cfg.isParking || hideNpcs
      ? []
      : CHARACTERS.filter((c) => (c.locationIndex ?? 0) === locIndex && c.id !== chosenId)
          .map((char) => ({ char, ...(spawns.get(char.id) ?? { x: 0, y: 0 }) }));
    for (const npc of npcs) this.addNpc(npc);

    return { npcs, doors, spawns, interactions, rects, items, physicsWalls, tableRects, routes };
  }

  // Из карты Tiled: collision -> стены игрока, collisions_physics -> стены предметов,
  // doors -> двери (имя = id соседней локации), spawns -> точки персонажей (имя = id
  // персонажа), interactions -> интерактивные объекты, items -> физичные предметы
  // (имя = тип предмета), routes -> polyline-маршруты (имя = id маршрута).
  private buildFromMap(mapKey: string): {
    doors: Map<string, Spawn>;
    spawns: Map<string, Spawn>;
    interactions: Map<string, Spawn>;
    rects: Map<string, Rect>;
    items: PlacedItemDef[];
    physicsWalls: Rect[];
    tableRects: Rect[];
    routes: Map<string, Spawn[]>;
  } {
    const doors = new Map<string, Spawn>();
    const spawns = new Map<string, Spawn>();
    const interactions = new Map<string, Spawn>();
    const rects = new Map<string, Rect>();
    const items: PlacedItemDef[] = [];
    const physicsWalls: Rect[] = [];
    const tableRects: Rect[] = [];
    const routes = new Map<string, Spawn[]>();
    if (!this.scene.cache.tilemap.exists(mapKey)) {
      return { doors, spawns, interactions, rects, items, physicsWalls, tableRects, routes };
    }

    const map = this.scene.make.tilemap({ key: mapKey });

    map.getObjectLayer("collision")?.objects.forEach((o) => {
      const w = o.width ?? 0;
      const h = o.height ?? 0;
      const rect = this.scene.add.rectangle((o.x ?? 0) + w / 2, (o.y ?? 0) + h / 2, w, h);
      this.scene.physics.add.existing(rect, true);
      this.walls.add(rect);
    });

    const readPoints = (layer: string, into: Map<string, Spawn>) =>
      map.getObjectLayer(layer)?.objects.forEach((o) => {
        into.set(o.name, { x: o.x ?? 0, y: o.y ?? 0 });
      });

    readPoints("doors", doors);
    readPoints("spawns", spawns);
    readPoints("interactions", interactions);

    // Прямоугольные объекты слоя interactions (не точки) — напр. экран TV.
    map.getObjectLayer("interactions")?.objects.forEach((o) => {
      if (o.width && o.height) {
        rects.set(o.name, { x: o.x ?? 0, y: o.y ?? 0, w: o.width, h: o.height });
      }
    });

    // Предметы: id объекта Tiled стабилен и уникален в пределах карты — из него
    // строится id предмета, общий для всех клиентов и сервера.
    map.getObjectLayer("items")?.objects.forEach((o) => {
      if (!ITEM_TYPES[o.name]) return;
      items.push({ id: `${o.name}-${o.id}`, type: o.name, x: o.x ?? 0, y: o.y ?? 0 });
    });

    // Стены для предметов — отдельный слой: геометрия отскоков может отличаться
    // от коллизий игрока (например, мяч залетает туда, куда игроку нельзя).
    map.getObjectLayer("collisions_physics")?.objects.forEach((o) => {
      if (o.width && o.height) {
        physicsWalls.push({ x: o.x ?? 0, y: o.y ?? 0, w: o.width, h: o.height });
      }
    });

    // Места под чашку кофе (по одной на объект). Принимаем и точки, и прямоугольники:
    // точка — это место нулевого размера, чашка встаёт ровно в неё.
    map.getObjectLayer("tables")?.objects.forEach((o) => {
      tableRects.push({ x: o.x ?? 0, y: o.y ?? 0, w: o.width ?? 0, h: o.height ?? 0 });
    });

    // Маршруты: polyline (точки относительно объекта) + позиция объекта = абсолютные точки.
    // Замыкающую точку, совпадающую с первой, отбрасываем — маршрут зацикливается сам.
    map.getObjectLayer("routes")?.objects.forEach((o) => {
      if (!o.name || !o.polyline?.length) return;
      const ox = o.x ?? 0;
      const oy = o.y ?? 0;
      const pts: Spawn[] = o.polyline.map((p) => ({ x: ox + (p.x ?? 0), y: oy + (p.y ?? 0) }));
      if (pts.length >= 2) {
        const a = pts[0];
        const b = pts[pts.length - 1];
        if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) pts.pop();
      }
      if (pts.length >= 2) routes.set(o.name, pts);
    });

    return { doors, spawns, interactions, rects, items, physicsWalls, tableRects, routes };
  }

  private addNpc(npc: PlacedNpc): void {
    const { char, x, y } = npc;
    this.scenery.push(
      this.scene.add
        .image(x, y, char.sprite)
        .setScale(spriteScale(this.scene, char.sprite, this.targetH))
        .setOrigin(0.5, 0.5)
        .setFlipX(!!char.faceRight)
        .setDepth(y),
    );
    this.scenery.push(
      this.scene.add
        .text(x, y - this.targetH * 0.62, char.name, {
          fontFamily: "Trebuchet MS",
          fontSize: "13px",
          color: "#ffffff",
          backgroundColor: "#00000099",
          padding: { x: 5, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(y),
    );
  }
}

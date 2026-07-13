// Типы физичных предметов мира. Расстановка по локациям живёт в Tiled, в слое
// items: точка с именем = тип предмета (ключ ITEM_TYPES). Новый предмет = запись
// здесь + картинка в public/assets/items + точки в tmj нужных локаций.
// Серверу каталог не нужен: он заводит состояние предмета при первом ударе.

export interface ItemTypeDef {
  texture: string;   // ключ текстуры Phaser
  file: string;      // файл в public/assets/items
  radius: number;    // радиус круглого тела, px мира
  bounce: number;    // упругость отскока от стен (0..1)
  drag: number;      // экспоненциальное затухание скорости (доля скорости через секунду)
  kickMin: number;   // минимальная скорость после удара, px/с
  kickMax: number;   // максимальная скорость после удара, px/с
  hopFactor: number; // доля силы удара, уходящая в вертикальный прыжок
  kickable: boolean; // можно ли пинать (мячи — да, чашка кофе — нет)
  grabbable: boolean; // можно ли хватать и носить с собой
  tableOnly?: boolean; // ставить можно только на стол (слой tables) — для чашки кофе
  ttlMs?: number;    // время жизни предмета, после чего он исчезает (чашка кофе)
  alwaysOnTop?: boolean; // рисовать поверх всего мира, включая overlay локации (чашка кофе)
}

export const ITEM_TYPES: Record<string, ItemTypeDef> = {
  volleyball: {
    texture: "item-volleyball",
    file: "volleyball.png",
    radius: 26,
    bounce: 0.8,
    drag: 0.35,
    kickMin: 520,
    kickMax: 680,
    hopFactor: 0.7,
    kickable: true,
    grabbable: false,
  },
  tennis: {
    texture: "item-tennis",
    file: "tennis.png",
    radius: 14,
    bounce: 0.85,
    drag: 0.4,
    kickMin: 560,
    kickMax: 740,
    hopFactor: 0.5,
    kickable: true,
    grabbable: true,
  },
  basketball: {
    texture: "item-basketball",
    file: "basketball.png",
    radius: 30,
    bounce: 0.75,
    drag: 0.3,
    kickMin: 480,
    kickMax: 640,
    hopFactor: 0.8,
    kickable: true,
    grabbable: true,
  },
  coffee: {
    texture: "item-coffee",
    file: "coffee.png",
    radius: 16,
    bounce: 0,
    drag: 0.9,
    kickMin: 0,
    kickMax: 0,
    hopFactor: 0,
    kickable: false,
    grabbable: true,
    tableOnly: true,
    ttlMs: 30 * 60 * 1000,
    alwaysOnTop: true,
  },
};

// Предмет, поставленный на карту (из слоя items в tmj). id стабилен, пока объект
// живёт в Tiled: строится из типа и id объекта карты — по нему синхронизируется
// состояние между клиентами и сервером.
export interface PlacedItemDef {
  id: string;
  type: string; // ключ ITEM_TYPES
  x: number;
  y: number;
}

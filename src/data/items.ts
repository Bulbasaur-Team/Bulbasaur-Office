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
    hopFactor: 0.45,
  },
  tennis: {
    texture: "item-tennis",
    file: "tennis.png",
    radius: 12,
    bounce: 0.85,
    drag: 0.4,
    kickMin: 560,
    kickMax: 740,
    hopFactor: 0.6,
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

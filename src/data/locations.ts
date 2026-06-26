// Локации игры и связи между ними.
// overlay и map (коллизии) могут отсутствовать — тогда просто не рисуются.
// Все координаты зон и точек появления — заготовки, их подгоняют под двери на картинках.

export interface ExitDef {
  to: number;                                            // индекс целевой локации в LOCATIONS
  zone: { x: number; y: number; w: number; h: number };  // зона у двери (для парковки игнорируется)
  spawn: { x: number; y: number };                       // где появится игрок в целевой локации
}

export interface LocationDef {
  id: string;
  name: string;        // человекочитаемое имя
  enterLabel: string;  // надпись на кнопке перехода СЮДА: «В чилл-зону», «На парковку»
  bg: string;          // ключ текстуры фона
  overlay?: string;    // ключ текстуры overlay (верх двери); может не существовать
  map?: string;        // ключ карты Tiled с коллизиями; может не существовать
  isParking?: boolean; // на парковке нельзя ходить — показывается меню выбора локации
  exits: ExitDef[];    // двери/переходы наружу (для парковки — пункты меню)
}

export const LOC = {
  mainOffice: 0,
  chillZone: 1,
  vietnamBeach: 2,
  dataCenter: 3,
  parking: 4,
} as const;

export const LOCATIONS: LocationDef[] = [
  {
    id: "main-office",
    name: "Главный офис",
    enterLabel: "В главный офис",
    bg: "main-office-bg",
    overlay: "main-office-overlay",
    map: "main-office-map",
    exits: [
      // Дверь в чилл-зону — вдоль верхней стены комнаты с ноутбуками.
      { to: LOC.chillZone, zone: { x: 300, y: 28, w: 88, h: 56 }, spawn: { x: 704, y: 672 } },
      // Дверь в дата-центр — вдоль левой стены комнаты с ноутбуками (двери на картинке пока нет).
      { to: LOC.dataCenter, zone: { x: 28, y: 150, w: 56, h: 96 }, spawn: { x: 245, y: 660 } },
      // Выход на парковку — внизу карты.
      { to: LOC.parking, zone: { x: 588, y: 704, w: 88, h: 64 }, spawn: { x: 0, y: 0 } },
    ],
  },
  {
    id: "chill-zone",
    name: "Чилл-зона",
    enterLabel: "В чилл-зону",
    bg: "chill-zone-bg",
    overlay: "chill-zone-overlay",
    map: "chill-zone-map",
    exits: [
      // Назад в главный офис — игрок появляется у верхней стены комнаты с ноутбуками.
      { to: LOC.mainOffice, zone: { x: 660, y: 704, w: 88, h: 64 }, spawn: { x: 344, y: 110 } },
    ],
  },
  {
    id: "vietnam-beach",
    name: "Вьетнамский пляж",
    enterLabel: "На вьетнамский пляж",
    bg: "vietnam-beach-bg",
    overlay: "vietnam-beach-overlay",
    map: "vietnam-beach-map",
    exits: [
      // С пляжа можно вернуться только на парковку.
      { to: LOC.parking, zone: { x: 660, y: 704, w: 88, h: 64 }, spawn: { x: 0, y: 0 } },
    ],
  },
  {
    id: "data-center",
    name: "Дата-центр",
    enterLabel: "В дата-центр",
    bg: "data-center-bg",
    overlay: "data-center-overlay",
    map: "data-center-map",
    exits: [
      // Единственная дверь дата-центра — внизу. Через неё возвращаемся в офис,
      // где появляемся у левой стены комнаты с ноутбуками.
      { to: LOC.mainOffice, zone: { x: 196, y: 700, w: 104, h: 64 }, spawn: { x: 110, y: 198 } },
    ],
  },
  {
    id: "parking",
    name: "Парковка",
    enterLabel: "На парковку",
    bg: "parking-bg",
    isParking: true,
    // Для парковки zone не используется — это пункты меню. Указан только spawn в целевой локации.
    exits: [
      { to: LOC.mainOffice, zone: { x: 0, y: 0, w: 0, h: 0 }, spawn: { x: 631, y: 668 } },
      { to: LOC.chillZone, zone: { x: 0, y: 0, w: 0, h: 0 }, spawn: { x: 704, y: 672 } },
      { to: LOC.vietnamBeach, zone: { x: 0, y: 0, w: 0, h: 0 }, spawn: { x: 704, y: 672 } },
      { to: LOC.dataCenter, zone: { x: 0, y: 0, w: 0, h: 0 }, spawn: { x: 245, y: 660 } },
    ],
  },
];

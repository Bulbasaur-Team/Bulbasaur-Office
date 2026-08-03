// Каталог одежды (зеркало серверного seed). Пути — относительно public/assets/.

export type WardrobeCategory = "HAT" | "GLASSES" | "TOP" | "BOTTOM" | "SHOES";

export interface PlayerAppearance {
  hat: string | null;
  glasses: string | null;
  top: string | null;
  bottom: string | null;
  shoes: string | null;
}

export interface WardrobeItemDef {
  code: string;
  category: WardrobeCategory;
  name: string;
  price: number;
  sellable: boolean;
  /** Путь относительно assets/, напр. wardrobe/hat/hat_cap_red.png */
  file: string;
}

export const BODY_TEXTURE = "wardrobe_body";
export const BODY_FILE = "wardrobe/body/bulbasaur_body.png";

export const WARDROBE_ITEMS: WardrobeItemDef[] = [
  { code: "bottom_beach_shorts", category: "BOTTOM", name: "Пляжные шорты", price: 1000, sellable: true, file: "wardrobe/bottom/bottom_beach_shorts.png" },
  { code: "bottom_beige_shorts", category: "BOTTOM", name: "Бежевые шорты", price: 1000, sellable: true, file: "wardrobe/bottom/bottom_beige_shorts.png" },
  { code: "bottom_black_shorts", category: "BOTTOM", name: "Чёрные шорты", price: 0, sellable: false, file: "wardrobe/bottom/bottom_black_shorts.png" },
  { code: "bottom_denim_shorts", category: "BOTTOM", name: "Джинсовые шорты", price: 1000, sellable: true, file: "wardrobe/bottom/bottom_denim_shorts.png" },
  { code: "bottom_office_shorts", category: "BOTTOM", name: "Офисные шорты", price: 1000, sellable: true, file: "wardrobe/bottom/bottom_office_shorts.png" },
  { code: "bottom_sport_shorts", category: "BOTTOM", name: "Спортивные шорты", price: 1000, sellable: true, file: "wardrobe/bottom/bottom_sport_shorts.png" },
  { code: "bottom_white_shorts", category: "BOTTOM", name: "Белые шорты", price: 1000, sellable: true, file: "wardrobe/bottom/bottom_white_shorts.png" },
  { code: "glasses_black", category: "GLASSES", name: "Чёрные очки", price: 1000, sellable: true, file: "wardrobe/glasses/glasses_black.png" },
  { code: "glasses_pince_nez", category: "GLASSES", name: "Пенсне", price: 1000, sellable: true, file: "wardrobe/glasses/glasses_pince_nez.png" },
  { code: "glasses_pince_nez_orange", category: "GLASSES", name: "Пенсне оранжевое", price: 2000, sellable: true, file: "wardrobe/glasses/glasses_pince_nez_orange.png" },
  { code: "top_hoodie_black", category: "TOP", name: "Чёрная толстовка", price: 0, sellable: false, file: "wardrobe/top/top_hoodie_black.png" },
  { code: "top_hoodie_green", category: "TOP", name: "Зелёное худи", price: 1000, sellable: true, file: "wardrobe/top/top_hoodie_green.png" },
  { code: "top_hoodie_white", category: "TOP", name: "Белое худи", price: 1000, sellable: true, file: "wardrobe/top/top_hoodie_white.png" },
  { code: "top_hoodie_white_a", category: "TOP", name: "Худи Альфа", price: 1000, sellable: true, file: "wardrobe/top/top_hoodie_white_a.png" },
];

const BY_CODE = new Map(WARDROBE_ITEMS.map((i) => [i.code, i]));

export function wardrobeItem(code: string): WardrobeItemDef | undefined {
  return BY_CODE.get(code);
}

export function textureKeyForItem(code: string): string {
  return `wardrobe_${code}`;
}

/** Порядок слоёв снизу вверх. */
export const LAYER_ORDER: (keyof PlayerAppearance | "body")[] = [
  "body",
  "bottom",
  "top",
  "shoes",
  "hat",
  "glasses",
];

export const CATEGORY_LABELS: Record<WardrobeCategory, string> = {
  HAT: "Шляпы, кепки",
  GLASSES: "Очки",
  TOP: "Верх",
  BOTTOM: "Низ",
  SHOES: "Обувь",
};

export const CATEGORIES: WardrobeCategory[] = ["HAT", "GLASSES", "TOP", "BOTTOM", "SHOES"];

export function defaultAppearance(): PlayerAppearance {
  return {
    hat: null,
    glasses: null,
    top: "top_hoodie_black",
    bottom: "bottom_black_shorts",
    shoes: null,
  };
}

export function slotOf(appearance: PlayerAppearance, category: WardrobeCategory): string | null {
  switch (category) {
    case "HAT": return appearance.hat;
    case "GLASSES": return appearance.glasses;
    case "TOP": return appearance.top;
    case "BOTTOM": return appearance.bottom;
    case "SHOES": return appearance.shoes;
  }
}

export function withSlot(
  appearance: PlayerAppearance,
  category: WardrobeCategory,
  itemCode: string | null,
): PlayerAppearance {
  switch (category) {
    case "HAT": return { ...appearance, hat: itemCode };
    case "GLASSES": return { ...appearance, glasses: itemCode };
    case "TOP": return { ...appearance, top: itemCode };
    case "BOTTOM": return { ...appearance, bottom: itemCode };
    case "SHOES": return { ...appearance, shoes: itemCode };
  }
}

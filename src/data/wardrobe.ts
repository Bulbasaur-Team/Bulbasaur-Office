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
  /** Id цветовой группы; нет → отдельная карточка */
  colorGroup?: string;
  /** Заливка кружка цвета в UI */
  colorHex?: string;
  /** Имя карточки без цвета («Толстовка») */
  displayName?: string;
}

export interface WardrobeColorGroup<T extends { code: string; name: string } = { code: string; name: string }> {
  groupId: string;
  displayName: string;
  variants: Array<T & { colorHex?: string }>;
}

export const BODY_TEXTURE = "wardrobe_body";
export const BODY_FILE = "wardrobe/body/bulbasaur_body.png";

/** Тело без ушей — под шляпу/кепку, чтобы уши не торчали из-под головного убора. */
export const BODY_NO_EARS_TEXTURE = "wardrobe_body_no_ears";
export const BODY_NO_EARS_FILE = "wardrobe/body/bulbasaur_body_no_ears.png";

/** Базовый спрайт тела: без ушей, если надет HAT. */
export function bodyTextureFor(appearance: PlayerAppearance): string {
  return appearance.hat ? BODY_NO_EARS_TEXTURE : BODY_TEXTURE;
}

export const WARDROBE_ITEMS: WardrobeItemDef[] = [
  { code: "bottom_beach_shorts", category: "BOTTOM", name: "Пляжные шорты", price: 500, sellable: true, file: "wardrobe/bottom/bottom_beach_shorts.png" },
  { code: "bottom_beige_shorts", category: "BOTTOM", name: "Бежевые шорты", price: 500, sellable: true, file: "wardrobe/bottom/bottom_beige_shorts.png", colorGroup: "basic_shorts", colorHex: "#c6b092", displayName: "Шорты" },
  { code: "bottom_black_shorts", category: "BOTTOM", name: "Чёрные шорты", price: 0, sellable: false, file: "wardrobe/bottom/bottom_black_shorts.png", colorGroup: "basic_shorts", colorHex: "#1a1a1a", displayName: "Шорты" },
  { code: "bottom_blue_shorts", category: "BOTTOM", name: "Синие шорты", price: 1500, sellable: true, file: "wardrobe/bottom/bottom_blue_shorts.png", colorGroup: "basic_shorts", colorHex: "#4777c3", displayName: "Шорты" },
  { code: "bottom_denim_shorts", category: "BOTTOM", name: "Джинсовые шорты", price: 500, sellable: true, file: "wardrobe/bottom/bottom_denim_shorts.png" },
  { code: "bottom_green_shorts", category: "BOTTOM", name: "Зелёные шорты", price: 1500, sellable: true, file: "wardrobe/bottom/bottom_green_shorts.png", colorGroup: "basic_shorts", colorHex: "#419353", displayName: "Шорты" },
  { code: "bottom_office_shorts", category: "BOTTOM", name: "Офисные шорты", price: 500, sellable: true, file: "wardrobe/bottom/bottom_office_shorts.png" },
  { code: "bottom_orange_shorts", category: "BOTTOM", name: "Оранжевые шорты", price: 1500, sellable: true, file: "wardrobe/bottom/bottom_orange_shorts.png", colorGroup: "basic_shorts", colorHex: "#d7863a", displayName: "Шорты" },
  { code: "bottom_pink_shorts", category: "BOTTOM", name: "Розовые шорты", price: 1500, sellable: true, file: "wardrobe/bottom/bottom_pink_shorts.png", colorGroup: "basic_shorts", colorHex: "#d76e9d", displayName: "Шорты" },
  { code: "bottom_purple_shorts", category: "BOTTOM", name: "Фиолетовые шорты", price: 1500, sellable: true, file: "wardrobe/bottom/bottom_purple_shorts.png", colorGroup: "basic_shorts", colorHex: "#7b4d98", displayName: "Шорты" },
  { code: "bottom_red_shorts", category: "BOTTOM", name: "Красные шорты", price: 1500, sellable: true, file: "wardrobe/bottom/bottom_red_shorts.png", colorGroup: "basic_shorts", colorHex: "#bd4747", displayName: "Шорты" },
  { code: "bottom_sport_shorts", category: "BOTTOM", name: "Спортивные шорты", price: 500, sellable: true, file: "wardrobe/bottom/bottom_sport_shorts.png" },
  { code: "bottom_white_shorts", category: "BOTTOM", name: "Белые шорты", price: 500, sellable: true, file: "wardrobe/bottom/bottom_white_shorts.png", colorGroup: "basic_shorts", colorHex: "#f2f2f2", displayName: "Шорты" },
  { code: "hat_wdm_white_cap", category: "HAT", name: "Белая кепка WDM", price: 5000, sellable: true, file: "wardrobe/hat/hat_wdm_white_cap.png", colorGroup: "wdm_cap", colorHex: "#f2f2f2", displayName: "Кепка WDM" },
  { code: "hat_wdm_blue_cap", category: "HAT", name: "Синяя кепка WDM", price: 5000, sellable: true, file: "wardrobe/hat/hat_wdm_blue_cap.png", colorGroup: "wdm_cap", colorHex: "#4777c3", displayName: "Кепка WDM" },
  { code: "hat_wdm_red_cap", category: "HAT", name: "Красная кепка WDM", price: 5000, sellable: true, file: "wardrobe/hat/hat_wdm_red_cap.png", colorGroup: "wdm_cap", colorHex: "#bd4747", displayName: "Кепка WDM" },
  { code: "hat_wdm_black_cap", category: "HAT", name: "Чёрная кепка WDM", price: 5000, sellable: true, file: "wardrobe/hat/hat_wdm_black_cap.png", colorGroup: "wdm_cap", colorHex: "#23262d", displayName: "Кепка WDM" },
  { code: "hat_wdm_green_cap", category: "HAT", name: "Зелёная кепка WDM", price: 5000, sellable: true, file: "wardrobe/hat/hat_wdm_green_cap.png", colorGroup: "wdm_cap", colorHex: "#419353", displayName: "Кепка WDM" },
  { code: "hat_wdm_orange_cap", category: "HAT", name: "Оранжевая кепка WDM", price: 5000, sellable: true, file: "wardrobe/hat/hat_wdm_orange_cap.png", colorGroup: "wdm_cap", colorHex: "#d7863a", displayName: "Кепка WDM" },
  { code: "hat_wdm_pink_cap", category: "HAT", name: "Розовая кепка WDM", price: 5000, sellable: true, file: "wardrobe/hat/hat_wdm_pink_cap.png", colorGroup: "wdm_cap", colorHex: "#d76e9d", displayName: "Кепка WDM" },
  { code: "hat_non_la", category: "HAT", name: "Вьетнамская шляпа", price: 5000, sellable: true, file: "wardrobe/hat/hat_non_la.png" },
  { code: "glasses_black", category: "GLASSES", name: "Чёрные очки", price: 1500, sellable: true, file: "wardrobe/glasses/glasses_black.png", colorGroup: "glasses", colorHex: "#1a1a1a", displayName: "Очки" },
  { code: "glasses_orange", category: "GLASSES", name: "Оранжевые очки", price: 2000, sellable: true, file: "wardrobe/glasses/glasses_orange.png", colorGroup: "glasses", colorHex: "#ffa028", displayName: "Очки" },
  { code: "glasses_blue", category: "GLASSES", name: "Синие очки", price: 2000, sellable: true, file: "wardrobe/glasses/glasses_blue.png", colorGroup: "glasses", colorHex: "#468cff", displayName: "Очки" },
  { code: "glasses_red", category: "GLASSES", name: "Красные очки", price: 2000, sellable: true, file: "wardrobe/glasses/glasses_red.png", colorGroup: "glasses", colorHex: "#e63c3c", displayName: "Очки" },
  { code: "glasses_pink", category: "GLASSES", name: "Розовые очки", price: 2000, sellable: true, file: "wardrobe/glasses/glasses_pink.png", colorGroup: "glasses", colorHex: "#ff69b4", displayName: "Очки" },
  { code: "glasses_deal_with_it", category: "GLASSES", name: "Очки Deal with it", price: 5000, sellable: true, file: "wardrobe/glasses/glasses_deal_with_it.png" },
  { code: "glasses_pince_nez", category: "GLASSES", name: "Пенсне", price: 500, sellable: true, file: "wardrobe/glasses/glasses_pince_nez.png", colorGroup: "pince_nez", colorHex: "#c8c8c8", displayName: "Пенсне" },
  { code: "glasses_pince_nez_orange", category: "GLASSES", name: "Пенсне оранжевое", price: 1000, sellable: true, file: "wardrobe/glasses/glasses_pince_nez_orange.png", colorGroup: "pince_nez", colorHex: "#e67e22", displayName: "Пенсне" },
  { code: "glasses_pince_nez_pink", category: "GLASSES", name: "Пенсне розовое", price: 1500, sellable: true, file: "wardrobe/glasses/glasses_pince_nez_pink.png", colorGroup: "pince_nez", colorHex: "#ff69b4", displayName: "Пенсне" },
  { code: "glasses_pince_nez_green", category: "GLASSES", name: "Пенсне зелёное", price: 1500, sellable: true, file: "wardrobe/glasses/glasses_pince_nez_green.png", colorGroup: "pince_nez", colorHex: "#50c850", displayName: "Пенсне" },
  { code: "glasses_pince_nez_red", category: "GLASSES", name: "Пенсне красное", price: 1500, sellable: true, file: "wardrobe/glasses/glasses_pince_nez_red.png", colorGroup: "pince_nez", colorHex: "#e63c3c", displayName: "Пенсне" },
  { code: "shoes_crocs_beige", category: "SHOES", name: "Бежевые кроксы", price: 5000, sellable: true, file: "wardrobe/shoes/shoes_crocs_beige.png", colorGroup: "crocs", colorHex: "#c6b092", displayName: "Кроксы" },
  { code: "shoes_crocs_blue", category: "SHOES", name: "Синие кроксы", price: 5000, sellable: true, file: "wardrobe/shoes/shoes_crocs_blue.png", colorGroup: "crocs", colorHex: "#4777c3", displayName: "Кроксы" },
  { code: "shoes_crocs_green", category: "SHOES", name: "Зелёные кроксы", price: 5000, sellable: true, file: "wardrobe/shoes/shoes_crocs_green.png", colorGroup: "crocs", colorHex: "#419353", displayName: "Кроксы" },
  { code: "shoes_crocs_pink", category: "SHOES", name: "Розовые кроксы", price: 5000, sellable: true, file: "wardrobe/shoes/shoes_crocs_pink.png", colorGroup: "crocs", colorHex: "#d76e9d", displayName: "Кроксы" },
  { code: "shoes_crocs_red", category: "SHOES", name: "Красные кроксы", price: 5000, sellable: true, file: "wardrobe/shoes/shoes_crocs_red.png", colorGroup: "crocs", colorHex: "#bd4747", displayName: "Кроксы" },
  { code: "shoes_crocs_white", category: "SHOES", name: "Белые кроксы", price: 5000, sellable: true, file: "wardrobe/shoes/shoes_crocs_white.png", colorGroup: "crocs", colorHex: "#f2f2f2", displayName: "Кроксы" },
  { code: "shoes_crocs_yellow", category: "SHOES", name: "Жёлтые кроксы", price: 5000, sellable: true, file: "wardrobe/shoes/shoes_crocs_yellow.png", colorGroup: "crocs", colorHex: "#ceaf37", displayName: "Кроксы" },
  { code: "top_hoodie_black", category: "TOP", name: "Чёрная толстовка", price: 0, sellable: false, file: "wardrobe/top/top_hoodie_black.png", colorGroup: "hoodie", colorHex: "#1a1a1a", displayName: "Толстовка" },
  { code: "top_hoodie_beige", category: "TOP", name: "Бежевая толстовка", price: 4000, sellable: true, file: "wardrobe/top/top_hoodie_beige.png", colorGroup: "hoodie", colorHex: "#c8a878", displayName: "Толстовка" },
  { code: "top_hoodie_blue", category: "TOP", name: "Синяя толстовка", price: 4000, sellable: true, file: "wardrobe/top/top_hoodie_blue.png", colorGroup: "hoodie", colorHex: "#3770d2", displayName: "Толстовка" },
  { code: "top_hoodie_green", category: "TOP", name: "Зелёное худи", price: 500, sellable: true, file: "wardrobe/top/top_hoodie_green.png", colorGroup: "hoodie", colorHex: "#2d8a3e", displayName: "Толстовка" },
  { code: "top_hoodie_orange", category: "TOP", name: "Оранжевая толстовка", price: 4000, sellable: true, file: "wardrobe/top/top_hoodie_orange.png", colorGroup: "hoodie", colorHex: "#e6822d", displayName: "Толстовка" },
  { code: "top_hoodie_pink", category: "TOP", name: "Розовая толстовка", price: 4000, sellable: true, file: "wardrobe/top/top_hoodie_pink.png", colorGroup: "hoodie", colorHex: "#e664a0", displayName: "Толстовка" },
  { code: "top_hoodie_purple", category: "TOP", name: "Фиолетовая толстовка", price: 4000, sellable: true, file: "wardrobe/top/top_hoodie_purple.png", colorGroup: "hoodie", colorHex: "#7b3fa0", displayName: "Толстовка" },
  { code: "top_hoodie_red", category: "TOP", name: "Красная толстовка", price: 4000, sellable: true, file: "wardrobe/top/top_hoodie_red.png", colorGroup: "hoodie", colorHex: "#c83746", displayName: "Толстовка" },
  { code: "top_hoodie_white", category: "TOP", name: "Белое худи", price: 500, sellable: true, file: "wardrobe/top/top_hoodie_white.png", colorGroup: "hoodie", colorHex: "#f2f2f2", displayName: "Толстовка" },
  { code: "top_hoodie_white_a", category: "TOP", name: "Худи Альфа", price: 500, sellable: true, file: "wardrobe/top/top_hoodie_white_a.png" },
  { code: "top_tshirt_beige", category: "TOP", name: "Бежевая футболка", price: 2000, sellable: true, file: "wardrobe/top/top_tshirt_beige.png", colorGroup: "basic_tshirt", colorHex: "#c6b092", displayName: "Футболка" },
  { code: "top_tshirt_black", category: "TOP", name: "Чёрная футболка", price: 2000, sellable: true, file: "wardrobe/top/top_tshirt_black.png", colorGroup: "basic_tshirt", colorHex: "#1a1a1a", displayName: "Футболка" },
  { code: "top_tshirt_blue", category: "TOP", name: "Синяя футболка", price: 2000, sellable: true, file: "wardrobe/top/top_tshirt_blue.png", colorGroup: "basic_tshirt", colorHex: "#4777c3", displayName: "Футболка" },
  { code: "top_tshirt_green", category: "TOP", name: "Зелёная футболка", price: 2000, sellable: true, file: "wardrobe/top/top_tshirt_green.png", colorGroup: "basic_tshirt", colorHex: "#419353", displayName: "Футболка" },
  { code: "top_tshirt_orange", category: "TOP", name: "Оранжевая футболка", price: 2000, sellable: true, file: "wardrobe/top/top_tshirt_orange.png", colorGroup: "basic_tshirt", colorHex: "#d7863a", displayName: "Футболка" },
  { code: "top_tshirt_pink", category: "TOP", name: "Розовая футболка", price: 2000, sellable: true, file: "wardrobe/top/top_tshirt_pink.png", colorGroup: "basic_tshirt", colorHex: "#d76e9d", displayName: "Футболка" },
  { code: "top_tshirt_purple", category: "TOP", name: "Фиолетовая футболка", price: 2000, sellable: true, file: "wardrobe/top/top_tshirt_purple.png", colorGroup: "basic_tshirt", colorHex: "#7b4d98", displayName: "Футболка" },
  { code: "top_tshirt_red", category: "TOP", name: "Красная футболка", price: 2000, sellable: true, file: "wardrobe/top/top_tshirt_red.png", colorGroup: "basic_tshirt", colorHex: "#bd4747", displayName: "Футболка" },
  { code: "top_tshirt_white", category: "TOP", name: "Белая футболка", price: 2000, sellable: true, file: "wardrobe/top/top_tshirt_white.png", colorGroup: "basic_tshirt", colorHex: "#f2f2f2", displayName: "Футболка" },
];

const BY_CODE = new Map(WARDROBE_ITEMS.map((i) => [i.code, i]));

export function wardrobeItem(code: string): WardrobeItemDef | undefined {
  return BY_CODE.get(code);
}

/** Склеивает серверный каталог с клиентскими colorGroup — одна группа = одна карточка. */
export function groupWardrobeItems<T extends { code: string; name: string }>(
  items: T[],
): WardrobeColorGroup<T>[] {
  const groups: WardrobeColorGroup<T>[] = [];
  const byGroupId = new Map<string, WardrobeColorGroup<T>>();

  for (const item of items) {
    const def = BY_CODE.get(item.code);
    const colorGroup = def?.colorGroup;
    const colorHex = def?.colorHex;
    const variant = { ...item, colorHex };

    if (!colorGroup) {
      groups.push({
        groupId: item.code,
        displayName: def?.displayName ?? item.name,
        variants: [variant],
      });
      continue;
    }

    let group = byGroupId.get(colorGroup);
    if (!group) {
      group = {
        groupId: colorGroup,
        displayName: def?.displayName ?? item.name,
        variants: [],
      };
      byGroupId.set(colorGroup, group);
      groups.push(group);
    }
    group.variants.push(variant);
  }

  return groups;
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
  "glasses",
  "hat",
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

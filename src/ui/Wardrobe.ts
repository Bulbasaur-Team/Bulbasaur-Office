import {
  buyWardrobeItem,
  equipWardrobeItem,
  fetchWardrobeCatalog,
  sellWardrobeItem,
  type WardrobeCatalogItem,
} from "../net/api";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  defaultAppearance,
  groupWardrobeItems,
  withSlot,
  type PlayerAppearance,
  type WardrobeCategory,
  type WardrobeColorGroup,
} from "../data/wardrobe";
import { drawAppearance, loadWardrobeDomImages } from "../entities/PlayerAvatar";

type CatalogColorGroup = WardrobeColorGroup<WardrobeCatalogItem>;
type CatalogVariant = CatalogColorGroup["variants"][number];

/** Гардероб: единый каталог — примерка, покупка, надевание, продажа. */
export class Wardrobe {
  isOpen = false;

  private root = document.getElementById("wardrobe")!;
  private tabsEl = document.getElementById("wardrobeTabs")!;
  private listEl = document.getElementById("wardrobeList")!;
  private statusEl = document.getElementById("wardrobeStatus")!;
  private balanceEl = document.getElementById("wardrobeBalance")!;
  private equippedCanvas = document.getElementById("wardrobeEquippedPreview") as HTMLCanvasElement;
  private tryOnCanvas = document.getElementById("wardrobeTryOnPreview") as HTMLCanvasElement;
  private category: WardrobeCategory = "TOP";
  private items: WardrobeCatalogItem[] = [];
  private balance = 0;
  /** Реально надетая одежда («Твой Бульбазавр»). */
  private equippedAppearance: PlayerAppearance = defaultAppearance();
  /** Локальная примерка («Примерка»). */
  private tryOnAppearance: PlayerAppearance = defaultAppearance();
  private images: Map<string, HTMLImageElement> | null = null;
  private selectedCode: string | null = null;

  constructor(
    private hooks: {
      onBalance: (balance: number) => void;
      onAppearance: (appearance: PlayerAppearance) => void;
    },
  ) {
    document.getElementById("wardrobeClose")!.onclick = () => this.close();
    this.buildTabs();
  }

  async open(): Promise<void> {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    this.statusEl.textContent = "Загрузка...";
    this.listEl.innerHTML = "";
    try {
      if (!this.images) this.images = await loadWardrobeDomImages();
      const data = await fetchWardrobeCatalog();
      this.items = data.items;
      this.equippedAppearance = { ...data.appearance };
      this.tryOnAppearance = { ...data.appearance };
      this.selectedCode = null;
      this.setBalance(data.balance);
      this.statusEl.textContent = "";
      this.renderList();
      this.drawPreviews();
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
    }
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
  }

  private setBalance(balance: number): void {
    this.balance = balance;
    this.balanceEl.textContent = String(balance);
    this.hooks.onBalance(balance);
  }

  private buildTabs(): void {
    this.tabsEl.innerHTML = "";
    for (const cat of CATEGORIES) {
      const btn = document.createElement("button");
      btn.className = "wardrobe-tab";
      btn.textContent = CATEGORY_LABELS[cat];
      btn.onclick = () => {
        this.category = cat;
        this.selectedCode = null;
        this.renderList();
        this.highlightTabs();
      };
      this.tabsEl.appendChild(btn);
    }
    this.highlightTabs();
  }

  private highlightTabs(): void {
    const buttons = this.tabsEl.querySelectorAll("button");
    CATEGORIES.forEach((cat, i) => {
      buttons[i]?.classList.toggle("sel", cat === this.category);
    });
  }

  private renderList(): void {
    this.listEl.innerHTML = "";
    const items = this.items.filter((i) => i.category === this.category);
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "wardrobe-empty";
      empty.textContent = "В этой категории пока ничего нет";
      this.listEl.appendChild(empty);
      return;
    }
    for (const group of groupWardrobeItems(items)) {
      this.listEl.appendChild(this.card(group));
    }
  }

  private activeVariant(group: CatalogColorGroup): CatalogVariant {
    const selected = group.variants.find((v) => v.code === this.selectedCode);
    if (selected) return selected;
    const equipped = group.variants.find((v) => v.equipped);
    if (equipped) return equipped;
    const owned = group.variants.find((v) => v.owned);
    if (owned) return owned;
    return group.variants[0]!;
  }

  private card(group: CatalogColorGroup): HTMLDivElement {
    const item = this.activeVariant(group);
    const anyEquipped = group.variants.some((v) => v.equipped);
    const anySelected = group.variants.some((v) => v.code === this.selectedCode);

    const card = document.createElement("div");
    card.className = "wardrobe-card";
    if (anySelected) card.classList.add("sel");
    if (anyEquipped) card.classList.add("equipped");

    const preview = document.createElement("canvas");
    preview.className = "wardrobe-card-preview";
    preview.width = 160;
    preview.height = 160;
    this.drawCardPreview(preview, item);

    const name = document.createElement("div");
    name.className = "wardrobe-card-name";
    name.textContent = group.displayName;

    if (group.variants.length > 1) {
      const swatches = document.createElement("div");
      swatches.className = "wardrobe-color-swatches";
      for (const variant of group.variants) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "wardrobe-color-swatch";
        swatch.title = variant.name;
        swatch.setAttribute("aria-label", variant.name);
        if (variant.colorHex) swatch.style.background = variant.colorHex;
        if (variant.code === item.code) swatch.classList.add("active");
        if (variant.owned) swatch.classList.add("owned");
        swatch.onclick = (e) => {
          e.stopPropagation();
          this.selectedCode = variant.code;
          this.tryOnAppearance = withSlot(this.tryOnAppearance, variant.category, variant.code);
          this.drawPreviews();
          this.renderList();
        };
        swatches.appendChild(swatch);
      }
      card.append(preview, name, swatches);
    } else {
      card.append(preview, name);
    }

    const meta = document.createElement("div");
    meta.className = "wardrobe-card-meta";
    if (item.owned) {
      const owned = document.createElement("div");
      owned.className = "wardrobe-card-owned";
      owned.textContent = "Куплено";
      meta.appendChild(owned);
    } else if (item.sellable) {
      const price = document.createElement("div");
      price.className = "wardrobe-card-price";
      if (this.balance < item.price) price.classList.add("insufficient");
      price.textContent = `${item.price} BC`;
      meta.appendChild(price);
    }

    const actions = document.createElement("div");
    actions.className = "wardrobe-card-actions";

    const tryBtn = document.createElement("button");
    tryBtn.textContent = "Примерить";
    tryBtn.onclick = (e) => {
      e.stopPropagation();
      this.selectedCode = item.code;
      this.tryOnAppearance = withSlot(this.tryOnAppearance, item.category, item.code);
      this.drawPreviews();
      this.renderList();
    };
    actions.appendChild(tryBtn);

    if (item.owned) {
      if (item.equipped) {
        const unequipBtn = document.createElement("button");
        unequipBtn.textContent = "Снять";
        unequipBtn.onclick = (e) => {
          e.stopPropagation();
          void this.equip(item.category, null);
        };
        actions.appendChild(unequipBtn);
      } else {
        const equipBtn = document.createElement("button");
        equipBtn.textContent = "Надеть";
        equipBtn.onclick = (e) => {
          e.stopPropagation();
          this.selectedCode = item.code;
          void this.equip(item.category, item.code);
        };
        actions.appendChild(equipBtn);
      }
      if (item.sellable) {
        const sellBtn = document.createElement("button");
        sellBtn.textContent = `Продать (${Math.floor(item.price / 2)} BC)`;
        sellBtn.onclick = (e) => {
          e.stopPropagation();
          void this.sell(item);
        };
        actions.appendChild(sellBtn);
      }
    } else if (item.sellable) {
      const buyBtn = document.createElement("button");
      buyBtn.textContent = "Купить";
      buyBtn.disabled = this.balance < item.price;
      buyBtn.onclick = (e) => {
        e.stopPropagation();
        void this.buy(item);
      };
      actions.appendChild(buyBtn);
    }

    card.append(meta, actions);
    card.onclick = () => {
      this.selectedCode = item.code;
      this.renderList();
    };
    return card;
  }

  private drawPreviews(): void {
    this.drawOn(this.equippedCanvas, this.equippedAppearance);
    this.drawOn(this.tryOnCanvas, this.tryOnAppearance);
  }

  private drawOn(canvas: HTMLCanvasElement, appearance: PlayerAppearance): void {
    const ctx = canvas.getContext("2d");
    if (!ctx || !this.images) return;
    drawAppearance(ctx, canvas.width, appearance, this.images);
  }

  private drawCardPreview(canvas: HTMLCanvasElement, item: WardrobeCatalogItem): void {
    const ctx = canvas.getContext("2d");
    if (!ctx || !this.images) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const img = this.images.get(`wardrobe_${item.code}`);
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  private async buy(item: WardrobeCatalogItem): Promise<void> {
    try {
      const res = await buyWardrobeItem(item.code);
      this.setBalance(res.balance);
      this.selectedCode = item.code;
      await this.reload({ keepTryOn: true });
      this.statusEl.textContent = `Куплено: ${item.name}`;
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
    }
  }

  private async equip(category: WardrobeCategory, itemCode: string | null): Promise<void> {
    try {
      const res = await equipWardrobeItem(category, itemCode);
      if (itemCode) this.selectedCode = itemCode;
      this.items = this.items.map((item) => (
        item.category === category
          ? { ...item, equipped: item.code === (itemCode ?? "") }
          : item
      ));
      this.equippedAppearance = { ...res.appearance };
      this.hooks.onAppearance(res.appearance);
      this.renderList();
      this.drawPreviews();
      this.statusEl.textContent = itemCode ? "Одежда надета" : "Одежда снята";
      void this.reload({ keepTryOn: true });
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
    }
  }

  private async sell(item: WardrobeCatalogItem): Promise<void> {
    if (!confirm(`Продать «${item.name}» за ${Math.floor(item.price / 2)} BC?`)) return;
    try {
      const res = await sellWardrobeItem(item.code);
      if (this.selectedCode === item.code) this.selectedCode = null;
      this.setBalance(res.balance);
      this.equippedAppearance = { ...res.appearance };
      this.tryOnAppearance = { ...res.appearance };
      this.hooks.onAppearance(res.appearance);
      await this.reload({ keepTryOn: false });
      this.statusEl.textContent = `Продано: ${item.name} (+${res.refund} BC)`;
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
    }
  }

  private async reload(opts: { keepTryOn: boolean }): Promise<void> {
    const tryOnBefore = this.tryOnAppearance;
    const data = await fetchWardrobeCatalog();
    this.items = data.items;
    this.setBalance(data.balance);
    this.equippedAppearance = { ...data.appearance };
    if (opts.keepTryOn) {
      this.tryOnAppearance = { ...tryOnBefore };
    } else if (this.selectedCode) {
      const selected = data.items.find((i) => i.code === this.selectedCode);
      this.tryOnAppearance = selected
        ? withSlot(data.appearance, selected.category, selected.code)
        : { ...data.appearance };
    } else {
      this.tryOnAppearance = { ...data.appearance };
    }
    this.renderList();
    this.drawPreviews();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };
}

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
  withSlot,
  type PlayerAppearance,
  type WardrobeCategory,
} from "../data/wardrobe";
import { drawAppearance, loadWardrobeDomImages } from "../entities/PlayerAvatar";

/** Гардероб: единый каталог — примерка, покупка, надевание, продажа. */
export class Wardrobe {
  isOpen = false;

  private root = document.getElementById("wardrobe")!;
  private tabsEl = document.getElementById("wardrobeTabs")!;
  private listEl = document.getElementById("wardrobeList")!;
  private statusEl = document.getElementById("wardrobeStatus")!;
  private balanceEl = document.getElementById("wardrobeBalance")!;
  private preview = document.getElementById("wardrobePreview") as HTMLCanvasElement;
  private category: WardrobeCategory = "TOP";
  private items: WardrobeCatalogItem[] = [];
  private balance = 0;
  private previewAppearance: PlayerAppearance = defaultAppearance();
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
      this.previewAppearance = { ...data.appearance };
      this.setBalance(data.balance);
      this.statusEl.textContent = "";
      this.renderList();
      this.drawPreview();
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
    const items = this.items
      .filter((i) => i.category === this.category)
      .sort((a, b) => {
        if (a.owned !== b.owned) return a.owned ? -1 : 1;
        if (a.owned && b.owned) {
          const at = a.purchasedAt ? Date.parse(a.purchasedAt) : 0;
          const bt = b.purchasedAt ? Date.parse(b.purchasedAt) : 0;
          if (at !== bt) return at - bt;
        } else if (!a.owned && !b.owned) {
          if (a.price !== b.price) return a.price - b.price;
        }
        return a.code.localeCompare(b.code);
      });
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "wardrobe-empty";
      empty.textContent = "В этой категории пока ничего нет";
      this.listEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      this.listEl.appendChild(this.card(item));
    }
  }

  private card(item: WardrobeCatalogItem): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "wardrobe-card";
    if (this.selectedCode === item.code) card.classList.add("sel");
    if (item.equipped) card.classList.add("equipped");

    const preview = document.createElement("canvas");
    preview.className = "wardrobe-card-preview";
    preview.width = 160;
    preview.height = 160;
    this.drawCardPreview(preview, item);

    const name = document.createElement("div");
    name.className = "wardrobe-card-name";
    name.textContent = item.name;

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
      this.previewAppearance = withSlot(this.previewAppearance, item.category, item.code);
      this.drawPreview();
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

    card.append(preview, name, meta, actions);
    card.onclick = () => {
      this.selectedCode = item.code;
      this.renderList();
    };
    return card;
  }

  private drawPreview(): void {
    const ctx = this.preview.getContext("2d");
    if (!ctx || !this.images) return;
    drawAppearance(ctx, this.preview.width, this.previewAppearance, this.images);
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
      // Покупка не примеряет и не надевает — превью остаётся с реальной экипировкой.
      this.selectedCode = null;
      await this.reload();
      this.statusEl.textContent = `Куплено: ${item.name}`;
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
    }
  }

  private async equip(category: WardrobeCategory, itemCode: string | null): Promise<void> {
    try {
      const res = await equipWardrobeItem(category, itemCode);
      this.selectedCode = null;
      this.items = this.items.map((item) => (
        item.category === category
          ? { ...item, equipped: item.code === (itemCode ?? "") }
          : item
      ));
      this.previewAppearance = { ...res.appearance };
      this.hooks.onAppearance(res.appearance);
      this.renderList();
      this.drawPreview();
      this.statusEl.textContent = itemCode ? "Одежда надета" : "Одежда снята";
      void this.reload();
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
      this.previewAppearance = { ...res.appearance };
      this.hooks.onAppearance(res.appearance);
      await this.reload();
      this.drawPreview();
      this.statusEl.textContent = `Продано: ${item.name} (+${res.refund} BC)`;
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
    }
  }

  private async reload(): Promise<void> {
    const data = await fetchWardrobeCatalog();
    this.items = data.items;
    this.setBalance(data.balance);
    this.previewAppearance = { ...data.appearance };
    if (this.selectedCode) {
      const selected = data.items.find((i) => i.code === this.selectedCode);
      if (selected) {
        this.previewAppearance = withSlot(data.appearance, selected.category, selected.code);
      }
    }
    this.renderList();
    this.drawPreview();
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

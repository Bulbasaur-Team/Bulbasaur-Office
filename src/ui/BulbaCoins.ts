import { fetchBulbaCoinHistory } from "../net/api";
import { publicPath } from "../publicPath";

/** Модалка истории Bulba Coins. */
export class BulbaCoins {
  isOpen = false;

  private root = document.getElementById("bulbaCoins")!;
  private balanceEl = document.getElementById("bcModalBalance")!;
  private listEl = document.getElementById("bcList")!;
  private statusEl = document.getElementById("bulbaCoinsStatus")!;

  constructor(private onBalance?: (balance: number) => void) {
    document.getElementById("bulbaCoinsClose")!.onclick = () => this.close();
  }

  async open(): Promise<void> {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    this.listEl.innerHTML = "";
    this.statusEl.textContent = "Загрузка...";
    try {
      const data = await fetchBulbaCoinHistory();
      this.balanceEl.textContent = String(data.balance);
      this.onBalance?.(data.balance);
      this.statusEl.textContent = data.transactions.length === 0 ? "Пока нет операций" : "";
      for (const tx of data.transactions) {
        this.listEl.appendChild(this.row(tx.amount, tx.title, tx.createdAt));
      }
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
    }
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
  }

  private row(amount: number, title: string, createdAt: string): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "bc-row";
    const sign = amount > 0 ? "+" : "";
    const amountEl = document.createElement("span");
    amountEl.className = amount >= 0 ? "bc-amount bc-plus" : "bc-amount bc-minus";
    amountEl.textContent = `${sign}${amount}`;
    const titleEl = document.createElement("span");
    titleEl.className = "bc-title";
    titleEl.textContent = title;
    const dateEl = document.createElement("span");
    dateEl.className = "bc-date";
    dateEl.textContent = formatDate(createdAt);
    row.append(amountEl, titleEl, dateEl);
    return row;
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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export const BC_COIN_SRC = publicPath("assets/wardrobe/ui/bc_coin.png");

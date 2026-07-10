import { publicPath } from "../publicPath";

const VISIBLE_MS = 7000;

// Всплывающий попап о получении ачивки: картинка, название и надпись «Получена ачивка».
// Показывается по одному; если ачивки приходят пачкой — становятся в очередь.
export class AchievementPopup {
  private root = document.getElementById("achPopup")!;
  private queue: { title: string; description: string; image: string }[] = [];
  private showing = false;

  show(title: string, description: string, image: string): void {
    this.queue.push({ title, description, image });
    if (!this.showing) this.next();
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item) {
      this.showing = false;
      return;
    }
    this.showing = true;
    this.root.innerHTML = "";

    const img = document.createElement("img");
    img.className = "ach-popup-img";
    img.src = publicPath(`achievements/${item.image}`);
    img.alt = item.title;

    const text = document.createElement("div");
    text.className = "ach-popup-text";
    const caption = document.createElement("div");
    caption.className = "ach-popup-caption";
    caption.textContent = "Получена ачивка";
    const name = document.createElement("div");
    name.className = "ach-popup-name";
    name.textContent = item.title;
    const desc = document.createElement("div");
    desc.className = "ach-popup-desc";
    desc.textContent = item.description;
    text.append(caption, name, desc);

    this.root.append(img, text);
    this.root.classList.remove("hidden");
    // Перезапуск анимации появления.
    this.root.classList.remove("ach-popup-in");
    void this.root.offsetWidth;
    this.root.classList.add("ach-popup-in");

    window.setTimeout(() => {
      this.root.classList.add("hidden");
      window.setTimeout(() => this.next(), 200);
    }, VISIBLE_MS);
  }
}

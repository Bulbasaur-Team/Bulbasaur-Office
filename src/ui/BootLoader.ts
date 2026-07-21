// Стартовый оверлей: виден из HTML ещё до загрузки Phaser, прогресс обновляет BootScene.
const root = document.getElementById("bootLoader")!;
const fill = document.getElementById("bootLoaderFill")!;
const label = document.getElementById("bootLoaderLabel")!;

export function setBootProgress(value: number): void {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  fill.style.width = `${pct}%`;
  label.textContent = `Загрузка… ${pct}%`;
}

export function hideBootLoader(): void {
  root.classList.add("hidden");
}

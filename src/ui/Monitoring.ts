import { fetchOfficeMetrics, type OfficeMetricsPoint } from "../net/api";

interface Series {
  key: keyof OfficeMetricsPoint;
  label: string;
  color: string;
}

interface ChartSlide {
  title: string;
  panelTitle: string;
  series: Series[];
}

const SLIDES: ChartSlide[] = [
  {
    title: "Мониторинг · онлайн",
    panelTitle: "Бульбазавры онлайн",
    series: [{ key: "online", label: "онлайн", color: "#73bf69" }],
  },
  {
    title: "Мониторинг · мячи",
    panelTitle: "Пинки мячей",
    series: [
      { key: "tennisKicks", label: "теннис", color: "#f2cc0c" },
      { key: "volleyballKicks", label: "волейбол", color: "#5794f2" },
    ],
  },
  {
    title: "Мониторинг · кофе",
    panelTitle: "Налитые чашки кофе",
    series: [{ key: "coffeeCups", label: "кофе", color: "#ff9830" }],
  },
];

const PAD = { top: 12, right: 12, bottom: 28, left: 44 };

// Модалка с Grafana-подобными графиками в комнате мониторинга дата-центра.
// Три слайда: онлайн / пинки мячей / кофе; данные — 5‑минутные бакеты за 48 часов.
export class Monitoring {
  isOpen = false;

  private root = document.getElementById("monitoring")!;
  private titleEl = document.getElementById("monTitle")!;
  private metaEl = document.getElementById("monMeta")!;
  private statusEl = document.getElementById("monStatus")!;
  private panelTitleEl = document.getElementById("monPanelTitle")!;
  private legendEl = document.getElementById("monLegend")!;
  private pageEl = document.getElementById("monPage")!;
  private dotsEl = document.getElementById("monDots")!;
  private canvas = document.getElementById("monCanvas") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;

  private index = 0;
  private points: OfficeMetricsPoint[] = [];
  private bucketMinutes = 5;

  constructor() {
    document.getElementById("monClose")!.onclick = () => this.close();
    document.getElementById("monPrev")!.onclick = () => this.step(-1);
    document.getElementById("monNext")!.onclick = () => this.step(1);
  }

  async open(): Promise<void> {
    this.isOpen = true;
    this.index = 0;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onResize);
    this.statusEl.textContent = "Загрузка...";
    this.points = [];
    this.draw();
    try {
      const data = await fetchOfficeMetrics();
      this.points = data.points;
      this.bucketMinutes = data.bucketMinutes;
      this.metaEl.textContent = `last 48h · ${this.bucketMinutes}m`;
      this.statusEl.textContent = "";
      this.renderSlide();
    } catch (e) {
      this.statusEl.textContent = (e as Error).message;
      this.renderSlide();
    }
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onResize);
  }

  private step(delta: number): void {
    this.index = (this.index + delta + SLIDES.length) % SLIDES.length;
    this.renderSlide();
  }

  private renderSlide(): void {
    const slide = SLIDES[this.index];
    this.titleEl.textContent = slide.title;
    this.panelTitleEl.textContent = slide.panelTitle;
    this.pageEl.textContent = `${this.index + 1} / ${SLIDES.length}`;
    this.legendEl.innerHTML = slide.series
      .map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`)
      .join("");
    const dots = this.dotsEl.querySelectorAll("i");
    dots.forEach((d, i) => d.classList.toggle("on", i === this.index));
    this.draw();
  }

  private onResize = (): void => {
    if (this.isOpen) this.draw();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      this.step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      this.step(1);
    }
  };

  private draw(): void {
    const wrap = this.canvas.parentElement!;
    const cssW = Math.max(1, wrap.clientWidth);
    const cssH = Math.max(1, wrap.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#181b1f";
    ctx.fillRect(0, 0, cssW, cssH);

    const slide = SLIDES[this.index];
    const plotW = cssW - PAD.left - PAD.right;
    const plotH = cssH - PAD.top - PAD.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    let maxY = 1;
    for (const p of this.points) {
      for (const s of slide.series) {
        const v = Number(p[s.key]);
        if (v > maxY) maxY = v;
      }
    }
    // Небольшой запас сверху, как в Grafana.
    maxY = niceMax(maxY);

    this.drawGrid(cssW, cssH, plotW, plotH, maxY);
    this.drawSeries(slide.series, plotW, plotH, maxY);
    this.drawTimeAxis(plotW, plotH, cssH);
  }

  private drawGrid(cssW: number, cssH: number, plotW: number, plotH: number, maxY: number): void {
    const ctx = this.ctx;
    const ticks = 4;
    ctx.font = "11px SF Mono, Consolas, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= ticks; i++) {
      const y = PAD.top + (plotH * i) / ticks;
      const value = Math.round(maxY * (1 - i / ticks));
      ctx.strokeStyle = i === ticks ? "#2c3235" : "#22252b";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = "#8e8e8e";
      ctx.fillText(String(value), PAD.left - 8, y);
    }

    // Рамка плот-области.
    ctx.strokeStyle = "#2c3235";
    ctx.strokeRect(PAD.left + 0.5, PAD.top + 0.5, plotW - 1, plotH - 1);

    // Заглушка, если данных нет.
    if (this.points.length === 0) {
      ctx.fillStyle = "#6e6e6e";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "13px Trebuchet MS, sans-serif";
      ctx.fillText("Нет данных", PAD.left + plotW / 2, PAD.top + plotH / 2);
      void cssW;
      void cssH;
    }
  }

  private drawSeries(series: Series[], plotW: number, plotH: number, maxY: number): void {
    if (this.points.length < 2) return;
    const n = this.points.length;
    const xAt = (i: number) => PAD.left + (plotW * i) / (n - 1);
    const yAt = (v: number) => PAD.top + plotH * (1 - v / maxY);

    for (const s of series) {
      const color = s.color;
      // Заливка под линией.
      this.ctx.beginPath();
      this.ctx.moveTo(xAt(0), PAD.top + plotH);
      for (let i = 0; i < n; i++) {
        this.ctx.lineTo(xAt(i), yAt(Number(this.points[i][s.key])));
      }
      this.ctx.lineTo(xAt(n - 1), PAD.top + plotH);
      this.ctx.closePath();
      const grad = this.ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
      grad.addColorStop(0, hexAlpha(color, 0.28));
      grad.addColorStop(1, hexAlpha(color, 0.02));
      this.ctx.fillStyle = grad;
      this.ctx.fill();

      // Линия.
      this.ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xAt(i);
        const y = yAt(Number(this.points[i][s.key]));
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 1.75;
      this.ctx.lineJoin = "round";
      this.ctx.stroke();
    }
  }

  private drawTimeAxis(plotW: number, plotH: number, cssH: number): void {
    if (this.points.length === 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = "#8e8e8e";
    ctx.font = "11px SF Mono, Consolas, Menlo, monospace";
    ctx.textBaseline = "top";
    const labels = timeLabels(this.points);
    for (const lab of labels) {
      const x = PAD.left + plotW * lab.ratio;
      ctx.textAlign = lab.ratio < 0.05 ? "left" : lab.ratio > 0.95 ? "right" : "center";
      ctx.fillText(lab.text, x, PAD.top + plotH + 8);
    }
    void cssH;
  }
}

function niceMax(raw: number): number {
  if (raw <= 1) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const scaled = raw / base;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * base;
}

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function timeLabels(points: OfficeMetricsPoint[]): { ratio: number; text: string }[] {
  const first = Date.parse(points[0].t);
  const last = Date.parse(points[points.length - 1].t);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
    return [{ ratio: 0, text: formatTick(first) }, { ratio: 1, text: formatTick(last) }];
  }
  const span = last - first;
  const out: { ratio: number; text: string }[] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    const ms = first + span * ratio;
    out.push({ ratio, text: formatTick(ms) });
  }
  return out;
}

function formatTick(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mi}`;
}

// Bulba Quiz — викторина с энергией, бустерами и сундуками (сервер — источник истины).

import * as api from "../net/api";
import type { QuizAttempt, QuizChestReward, QuizState, QuizTopic } from "../net/api";
import { defaultAppearance, quizChestLootCards, wardrobeItem, type PlayerAppearance } from "../data/wardrobe";
import { drawAppearance, loadWardrobeDomImages } from "../entities/PlayerAvatar";
import { publicPath } from "../publicPath";
import { stage } from "./orientation";

type Screen = "hub" | "topics" | "shop" | "question" | "result" | "chest";

const AVATAR_SIZE = 56;
const CORRECT_FEEDBACK_MS = 800;
const LEVEL_MOVE_MS = 800;

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
}

export class BulbaQuiz {
  isOpen = false;
  onLeaderboard: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onBalance: ((balance: number) => void) | null = null;

  private root = document.getElementById("bulbaquiz")!;
  private closeBtn = document.getElementById("bqClose") as HTMLButtonElement;
  private cornerActions = this.root.querySelector(".bq-corner-actions") as HTMLElement;
  private screenEls: Record<Screen, HTMLElement> = {
    hub: document.getElementById("bqHub")!,
    topics: document.getElementById("bqTopics")!,
    shop: document.getElementById("bqShop")!,
    question: document.getElementById("bqQuestion")!,
    result: document.getElementById("bqResult")!,
    chest: document.getElementById("bqChest")!,
  };

  private statusEl = document.getElementById("bqStatus")!;
  private energyEl = document.getElementById("bqEnergy")!;
  private energyTimerEl = document.getElementById("bqEnergyTimer")!;
  private shopEnergyEl = document.getElementById("bqShopEnergy")!;
  private shopEnergyTimerEl = document.getElementById("bqShopEnergyTimer")!;
  private shopBalanceEl = document.getElementById("bqShopBalance")!;
  private rerollCountEl = document.getElementById("bqRerollCount")!;
  private fiftyCountEl = document.getElementById("bqFiftyCount")!;
  private rerollPlayCountEl = document.getElementById("bqRerollPlayCount")!;
  private fiftyPlayCountEl = document.getElementById("bqFiftyPlayCount")!;
  private trackEl = document.getElementById("bqTrack")!;
  private avatarEl = document.getElementById("bqAvatar") as HTMLCanvasElement;
  private topicsList = document.getElementById("bqTopicsList")!;
  private qProgress = document.getElementById("bqQProgress")!;
  private qTimer = document.getElementById("bqQTimer")!;
  private qText = document.getElementById("bqQText")!;
  private qOptions = document.getElementById("bqQOptions")!;
  private feedbackEl = document.getElementById("bqFeedback")!;
  private questionMenuBtn = document.getElementById("bqQuestionMenu") as HTMLButtonElement;
  private boostersEl = this.root.querySelector(".bq-boosters") as HTMLElement;
  private resultTitle = document.getElementById("bqResultTitle")!;
  private resultText = document.getElementById("bqResultText")!;
  private chestTitle = document.getElementById("bqChestTitle")!;
  private chestStage = document.getElementById("bqChestStage")!;
  private chestRewards = document.getElementById("bqChestRewards")!;
  private chestPreview = document.getElementById("bqChestPreview") as HTMLCanvasElement;
  private coinAmount = document.getElementById("bqCoinAmount")!;
  private energyAmount = document.getElementById("bqEnergyAmount")!;
  private dupNote = document.getElementById("bqDupNote")!;
  private chestLootList = document.getElementById("bqChestLootList")!;
  private chestText = document.getElementById("bqChestText")!;
  private openChestBtn = document.getElementById("bqOpenChest") as HTMLButtonElement;
  private chestOpenBtn = document.getElementById("bqChestOpen") as HTMLButtonElement;
  private playBtn = document.getElementById("bqPlay") as HTMLButtonElement;
  private rerollBtn = document.getElementById("bqReroll") as HTMLButtonElement;
  private fiftyBtn = document.getElementById("bqFifty") as HTMLButtonElement;
  private errEl = document.getElementById("bqError")!;
  private confetti = document.getElementById("bqConfetti") as HTMLCanvasElement;
  private confettiCtx = this.confetti.getContext("2d")!;

  private state: QuizState | null = null;
  private topics: QuizTopic[] = [];
  private attempt: QuizAttempt | null = null;
  private tickTimer = 0;
  private energyTimer = 0;
  private levelAnimationTimer = 0;
  private answering = false;
  private screen: Screen = "hub";
  private appearance: PlayerAppearance = defaultAppearance();
  private wardrobeImages: Map<string, HTMLImageElement> | null = null;
  private confettiParticles: ConfettiParticle[] = [];
  private confettiRaf = 0;
  private confettiLast = 0;

  constructor() {
    this.closeBtn.onclick = () => this.close();
    document.getElementById("bqLb")!.onclick = () => this.onLeaderboard?.();
    this.playBtn.onclick = () => void this.showTopics();
    document.getElementById("bqShopBtn")!.onclick = () => this.showShop();
    document.getElementById("bqShopBack")!.onclick = () => void this.showHub();
    document.getElementById("bqTopicsBack")!.onclick = () => void this.showHub();
    document.getElementById("bqBuyEnergy")!.onclick = () => void this.buyEnergy();
    document.getElementById("bqBuyReroll")!.onclick = () => void this.buyBooster("reroll");
    document.getElementById("bqBuyFifty")!.onclick = () => void this.buyBooster("fifty");
    this.openChestBtn.onclick = () => this.showClosedChest();
    this.chestOpenBtn.onclick = () => void this.openChest();
    document.getElementById("bqResultOk")!.onclick = () => void this.afterResult();
    document.getElementById("bqChestOk")!.onclick = () => void this.showHub();
    this.questionMenuBtn.onclick = () => void this.showHub();
    this.rerollBtn.onclick = () => void this.useBooster("reroll");
    this.fiftyBtn.onclick = () => void this.useBooster("fifty");
  }

  open(appearance?: PlayerAppearance): void {
    this.isOpen = true;
    if (appearance) this.appearance = appearance;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKeyDown);
    void this.showHub();
  }

  setAppearance(appearance: PlayerAppearance): void {
    this.appearance = appearance;
    if (this.isOpen && this.screen === "hub") this.drawAvatar();
  }

  close(): void {
    if (!this.isOpen) return;
    if (this.state?.pendingChest) {
      this.showClosedChest(true);
      return;
    }
    this.isOpen = false;
    this.stopTimer();
    this.stopEnergyTimer();
    this.stopLevelAnimation();
    this.stopConfetti();
    window.removeEventListener("keydown", this.onKeyDown);
    this.root.classList.add("hidden");
    this.onClose?.();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  private setScreen(screen: Screen): void {
    this.screen = screen;
    for (const [name, el] of Object.entries(this.screenEls)) {
      el.classList.toggle("hidden", name !== screen);
    }
  }

  private setError(msg: string | null): void {
    this.errEl.textContent = msg ?? "";
    this.errEl.classList.toggle("hidden", !msg);
  }

  private applyState(state: QuizState): void {
    this.state = state;
    this.onBalance?.(state.bulbaCoinBalance);
    this.energyEl.textContent = `${state.energy}/${state.maxEnergy}`;
    this.shopEnergyEl.textContent = `${state.energy}/${state.maxEnergy}`;
    this.shopBalanceEl.textContent = String(state.bulbaCoinBalance);
    this.rerollCountEl.textContent = String(state.boosterReroll);
    this.fiftyCountEl.textContent = String(state.boosterFifty);
    this.rerollPlayCountEl.textContent = String(state.boosterReroll);
    this.fiftyPlayCountEl.textContent = String(state.boosterFifty);
    this.startEnergyTimer(state);
    this.renderTrack(state.level);
    // Сундук нельзя отложить: при pendingChest игрок сразу попадёт на обязательный экран.
    this.openChestBtn.classList.add("hidden");
    this.playBtn.disabled = state.energy < 1;
    this.statusEl.textContent = state.pendingChest
      ? "Сундук ждёт! Открой приз или продолжай играть."
      : state.energy < 1
        ? "Энергия на нуле — подожди или купи в лавке."
        : "";
    this.rerollBtn.disabled = state.boosterReroll < 1;
    this.fiftyBtn.disabled = state.boosterFifty < 1;
    const energyPrice = document.getElementById("bqEnergyPrice");
    const rerollPrice = document.getElementById("bqRerollPrice");
    const fiftyPrice = document.getElementById("bqFiftyPrice");
    if (energyPrice) energyPrice.textContent = String(state.energyPrice);
    if (rerollPrice) rerollPrice.textContent = String(state.rerollPrice);
    if (fiftyPrice) fiftyPrice.textContent = String(state.fiftyPrice);
  }

  private renderTrack(level: number): void {
    const from = Math.floor(level / 5) * 5;
    const steps = 5;
    const progress = Math.min(1, Math.max(0, (level - from) / steps));
    const marks: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const lv = from + i;
      const isChest = lv > 0 && lv % 5 === 0;
      const reached = level >= lv;
      const here = level === lv;
      marks.push(
        `<div class="bq-mark${reached ? " bq-reached" : ""}${here ? " bq-here" : ""}${isChest ? " bq-chest-mark" : ""}">` +
          `<span class="bq-marker">${isChest ? `<img class="bq-chest-icon" src="${publicPath("assets/bulbaquiz/chest.png")}" alt="">` : '<span class="bq-mark-dot"></span>'}</span>` +
          `<span class="bq-mark-n">${lv}</span>` +
          `</div>`,
      );
    }
    this.trackEl.innerHTML =
      `<div class="bq-track-rail"></div>` +
      `<div class="bq-track-fill" style="width:${progress * 83.34}%"></div>` +
      marks.join("");
    // Крайние маркеры занимают половину колонки, поэтому рельс идёт от 8.33% до 91.67%.
    this.avatarEl.style.left = `${8.33 + progress * 83.34}%`;
    void this.drawAvatar();
  }

  private showHubWithLevelAnimation(fromLevel: number, toLevel: number): void {
    this.setError(null);
    this.stopTimer();
    this.stopLevelAnimation();
    this.setScreen("hub");
    this.renderTrack(fromLevel);
    this.playBtn.disabled = true;

    const segmentStart = Math.floor(fromLevel / 5) * 5;
    const targetProgress = Math.min(1, Math.max(0, (toLevel - segmentStart) / 5));
    const fill = this.trackEl.querySelector<HTMLElement>(".bq-track-fill");
    if (!fill) {
      this.renderTrack(toLevel);
      this.playBtn.disabled = (this.state?.energy ?? 0) < 1;
      return;
    }

    fill.style.transition = `width ${LEVEL_MOVE_MS}ms linear`;
    this.avatarEl.style.transition = `left ${LEVEL_MOVE_MS}ms linear`;
    // Сначала браузер должен зафиксировать начальную позицию.
    void this.trackEl.offsetWidth;
    requestAnimationFrame(() => {
      fill.style.width = `${targetProgress * 83.34}%`;
      this.avatarEl.style.left = `${8.33 + targetProgress * 83.34}%`;
    });

    this.levelAnimationTimer = window.setTimeout(() => {
      this.levelAnimationTimer = 0;
      this.avatarEl.style.transition = "";
      this.renderTrack(toLevel);
      this.playBtn.disabled = (this.state?.energy ?? 0) < 1;
      if (this.state?.pendingChest) this.showClosedChest(true);
    }, LEVEL_MOVE_MS);
  }

  private stopLevelAnimation(): void {
    if (this.levelAnimationTimer) {
      clearTimeout(this.levelAnimationTimer);
      this.levelAnimationTimer = 0;
    }
    this.avatarEl.style.transition = "";
  }

  private startEnergyTimer(state: QuizState): void {
    this.stopEnergyTimer();
    if (state.energy >= state.maxEnergy || !state.nextEnergyAt) {
      this.energyTimerEl.textContent = "";
      this.shopEnergyTimerEl.textContent = "";
      return;
    }
    const deadline = Date.parse(state.nextEnergyAt);
    const tick = () => {
      const leftMs = Math.max(0, deadline - Date.now());
      const totalSeconds = Math.ceil(leftMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const text = `+1⚡ через ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      this.energyTimerEl.textContent = text;
      this.shopEnergyTimerEl.textContent = text;
      if (leftMs <= 0) {
        this.stopEnergyTimer();
        if (this.isOpen) void this.refreshEnergyState();
      }
    };
    tick();
    this.energyTimer = window.setInterval(tick, 1000);
  }

  private stopEnergyTimer(): void {
    if (this.energyTimer) {
      clearInterval(this.energyTimer);
      this.energyTimer = 0;
    }
  }

  private async refreshEnergyState(): Promise<void> {
    try {
      this.applyState(await api.fetchQuizState());
    } catch {
      this.energyTimerEl.textContent = "";
      this.shopEnergyTimerEl.textContent = "";
    }
  }

  private async drawAvatar(): Promise<void> {
    if (!this.wardrobeImages) this.wardrobeImages = await loadWardrobeDomImages();
    const ctx = this.avatarEl.getContext("2d");
    if (!ctx) return;
    drawAppearance(ctx, AVATAR_SIZE, this.appearance, this.wardrobeImages);
    // Базовый спрайт смотрит влево; на шкале персонаж идёт вправо.
    const copy = document.createElement("canvas");
    copy.width = AVATAR_SIZE;
    copy.height = AVATAR_SIZE;
    copy.getContext("2d")!.drawImage(this.avatarEl, 0, 0);
    ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    ctx.save();
    ctx.translate(AVATAR_SIZE, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(copy, 0, 0);
    ctx.restore();
  }

  private async showHub(): Promise<void> {
    this.setError(null);
    this.stopTimer();
    this.stopLevelAnimation();
    this.stopConfetti();
    this.setScreen("hub");
    try {
      const state = await api.fetchQuizState();
      this.applyState(state);
      if (state.pendingChest) this.showClosedChest(true);
    } catch (e) {
      this.setError(e instanceof Error ? e.message : "Не удалось загрузить квиз");
    }
  }

  private async showTopics(): Promise<void> {
    this.setError(null);
    if (!this.state || this.state.energy < 1) {
      this.setError("Недостаточно энергии");
      return;
    }
    this.setScreen("topics");
    try {
      const res = await api.fetchQuizTopics();
      this.topics = res.topics;
      this.topicsList.innerHTML = "";
      for (const t of this.topics) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bq-topic";
        const icon = document.createElement("span");
        icon.className = "bq-topic-icon";
        icon.textContent = this.topicIcon(t.code);
        const name = document.createElement("span");
        name.textContent = t.name;
        btn.append(icon, name);
        btn.onclick = () => void this.startTopic(t.code);
        this.topicsList.appendChild(btn);
      }
    } catch (e) {
      this.setError(e instanceof Error ? e.message : "Не удалось загрузить темы");
      void this.showHub();
    }
  }

  private topicIcon(code: string): string {
    return ({
      art: "🎨",
      cinema: "🎬",
      popculture: "✨",
      science: "🔬",
      it: "💻",
      music: "🎵",
      nature: "🌿",
      sport: "🏆",
      ecom: "📦",
    } as Record<string, string>)[code] ?? "❓";
  }

  private showShop(): void {
    this.setError(null);
    if (this.state) this.applyState(this.state);
    this.setScreen("shop");
  }

  private async buyEnergy(): Promise<void> {
    this.setError(null);
    try {
      this.applyState(await api.buyQuizEnergy());
    } catch (e) {
      this.setError(e instanceof Error ? e.message : "Покупка не удалась");
    }
  }

  private async buyBooster(type: api.QuizBoosterCode): Promise<void> {
    this.setError(null);
    try {
      this.applyState(await api.buyQuizBooster(type));
    } catch (e) {
      this.setError(e instanceof Error ? e.message : "Покупка не удалась");
    }
  }

  private async startTopic(topicCode: string): Promise<void> {
    this.setError(null);
    try {
      const attempt = await api.startQuizAttempt(topicCode);
      this.attempt = attempt;
      this.applyState(attempt.state);
      this.showQuestion(attempt);
    } catch (e) {
      this.setError(e instanceof Error ? e.message : "Не удалось начать");
      void this.showHub();
    }
  }

  private showQuestion(attempt: QuizAttempt): void {
    this.setScreen("question");
    this.answering = false;
    this.feedbackEl.textContent = "";
    this.feedbackEl.className = "bq-feedback";
    this.questionMenuBtn.classList.add("hidden");
    this.boostersEl.classList.remove("hidden");
    this.qProgress.textContent = `Вопрос ${attempt.currentIndex + 1} из ${attempt.totalQuestions}`;
    const q = attempt.question;
    if (!q) {
      this.setError("Нет вопроса");
      return;
    }
    this.qText.textContent = q.text;
    this.qOptions.innerHTML = "";
    const masked = new Set(q.maskedIndices ?? []);
    q.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bq-opt";
      const letter = document.createElement("span");
      letter.className = "bq-opt-letter";
      letter.textContent = String.fromCharCode(65 + i);
      const text = document.createElement("span");
      text.textContent = opt;
      btn.append(letter, text);
      if (masked.has(i)) {
        btn.disabled = true;
        btn.classList.add("bq-masked");
      } else {
        btn.onclick = () => void this.answer(i);
      }
      this.qOptions.appendChild(btn);
    });
    if (this.state) {
      this.rerollBtn.disabled = this.state.boosterReroll < 1 || this.answering;
      this.fiftyBtn.disabled =
        this.state.boosterFifty < 1 || this.answering || masked.size > 0;
    }
    this.startTimer(attempt.deadlineAt);
  }

  private startTimer(deadlineAt: string): void {
    this.stopTimer();
    const deadline = Date.parse(deadlineAt);
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      const sec = left / 1000;
      this.qTimer.textContent = sec.toFixed(1);
      this.qTimer.classList.toggle("bq-urgent", sec <= 5);
      if (left <= 0) {
        this.stopTimer();
        void this.onTimeout();
      }
    };
    tick();
    this.tickTimer = window.setInterval(tick, 100);
  }

  private stopTimer(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = 0;
    }
  }

  private async onTimeout(): Promise<void> {
    if (!this.attempt || this.answering || this.screen !== "question") return;
    await this.answer(-1);
  }

  private async answer(optionIndex: number): Promise<void> {
    if (!this.attempt || this.answering) return;
    const previousLevel = this.state?.level ?? 0;
    this.answering = true;
    this.stopTimer();
    this.setError(null);
    const selected = optionIndex >= 0
      ? this.qOptions.querySelectorAll<HTMLButtonElement>(".bq-opt")[optionIndex] ?? null
      : null;
    this.disableQuestionControls();
    try {
      const res = await api.answerQuizAttempt(this.attempt.attemptId, optionIndex);
      this.attempt = res;
      this.applyState(res.state);

      if (res.status === "LOST") {
        selected?.classList.add("bq-wrong");
        const correctIndex = res.correctIndex;
        if (correctIndex != null && correctIndex >= 0) {
          const opts = this.qOptions.querySelectorAll<HTMLButtonElement>(".bq-opt");
          opts[correctIndex]?.classList.add("bq-correct");
        }
        this.feedbackEl.textContent = "";
        this.boostersEl.classList.add("hidden");
        this.questionMenuBtn.classList.remove("hidden");
        return;
      }

      selected?.classList.add("bq-correct");
      this.feedbackEl.textContent = "";
      await this.delay(CORRECT_FEEDBACK_MS);
      if (!this.isOpen || this.screen !== "question" || this.attempt !== res) return;
      if (res.status === "ACTIVE" && res.question) this.showQuestion(res);
      else this.showHubWithLevelAnimation(previousLevel, res.state.level);
    } catch (e) {
      this.setError(e instanceof Error ? e.message : "Ошибка ответа");
      this.answering = false;
      void this.showHub();
    }
  }

  private disableQuestionControls(): void {
    this.qOptions.querySelectorAll<HTMLButtonElement>(".bq-opt").forEach((btn) => {
      btn.disabled = true;
    });
    this.rerollBtn.disabled = true;
    this.fiftyBtn.disabled = true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private async useBooster(type: api.QuizBoosterCode): Promise<void> {
    if (!this.attempt || this.answering) return;
    this.answering = true;
    this.setError(null);
    try {
      const res = await api.useQuizBooster(this.attempt.attemptId, type);
      this.attempt = res;
      this.applyState(res.state);
      if (res.status === "ACTIVE" && res.question) {
        this.showQuestion(res);
      } else {
        this.showResult(res);
      }
    } catch (e) {
      this.setError(e instanceof Error ? e.message : "Бустер не сработал");
      this.answering = false;
    }
  }

  private showResult(res: QuizAttempt): void {
    this.setScreen("result");
    const won = res.status === "WON";
    this.resultTitle.textContent = won ? "Уровень пройден!" : "Попытка провалена";
    this.resultText.textContent = won
      ? `Уровень ${res.state.level}. ${res.state.pendingChest ? "Тебя ждёт сундук!" : "Так держать!"}`
      : "Неверный ответ или время вышло. Энергия уже потрачена.";
  }

  private async afterResult(): Promise<void> {
    if (this.state?.pendingChest) {
      this.showClosedChest();
      return;
    }
    await this.showHub();
  }

  private showClosedChest(forced = false): void {
    this.setError(null);
    this.stopConfetti();
    this.setScreen("chest");
    this.closeBtn.classList.toggle("hidden", forced);
    this.cornerActions.classList.toggle("hidden", forced);
    this.chestTitle.textContent = "";
    this.chestTitle.classList.add("hidden");
    this.chestStage.classList.remove("hidden");
    this.chestRewards.classList.add("hidden");
    this.chestPreview.classList.add("hidden");
    this.dupNote.classList.add("hidden");
    document.getElementById("bqRewardEnergy")!.classList.remove("hidden");
    this.chestText.textContent = "";
    this.chestOpenBtn.classList.remove("hidden");
    document.getElementById("bqChestOk")!.classList.add("hidden");
    this.renderChestLootTip();
  }

  private renderChestLootTip(): void {
    void this.loadChestLootTip();
  }

  private async loadChestLootTip(): Promise<void> {
    this.chestLootList.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "bq-loot-row";
    loading.textContent = "Загрузка шансов…";
    this.chestLootList.append(loading);
    try {
      const catalog = await api.fetchWardrobeCatalog();
      const cards = quizChestLootCards(catalog.items);
      this.chestLootList.replaceChildren();
      for (const card of cards) {
        const row = document.createElement("div");
        row.className = "bq-loot-row";

        const img = document.createElement("img");
        img.src = publicPath(`assets/${card.file}`);
        img.alt = card.displayName;

        const name = document.createElement("span");
        name.className = "bq-loot-name";
        name.textContent = card.displayName;

        const chance = document.createElement("span");
        chance.className = "bq-loot-chance";
        chance.textContent = formatChance(card.chance);

        row.append(img, name, chance);
        this.chestLootList.append(row);
      }
    } catch {
      this.chestLootList.replaceChildren();
      const err = document.createElement("div");
      err.className = "bq-loot-row";
      err.textContent = "Не удалось загрузить шансы";
      this.chestLootList.append(err);
    }
  }

  private async openChest(): Promise<void> {
    this.setError(null);
    this.setScreen("chest");
    this.chestText.textContent = "Открываем…";
    this.chestStage.classList.add("hidden");
    this.chestRewards.classList.add("hidden");
    this.chestPreview.classList.add("hidden");
    this.dupNote.classList.add("hidden");
    this.chestOpenBtn.classList.add("hidden");
    document.getElementById("bqChestOk")!.classList.add("hidden");
    try {
      const reward = await api.openQuizChest();
      this.applyState(reward.state);
      this.showChestReward(reward);
    } catch (e) {
      this.setError(e instanceof Error ? e.message : "Не удалось открыть сундук");
      void this.showHub();
    }
  }

  private showChestReward(reward: QuizChestReward): void {
    this.setScreen("chest");
    this.closeBtn.classList.remove("hidden");
    this.cornerActions.classList.remove("hidden");
    this.chestStage.classList.add("hidden");
    this.chestOpenBtn.classList.add("hidden");
    document.getElementById("bqChestOk")!.classList.remove("hidden");
    this.chestTitle.classList.remove("hidden");
    this.chestTitle.textContent = "Награда!";
    this.launchConfetti();

    this.coinAmount.textContent = `+${reward.coins}`;
    const energyPill = document.getElementById("bqRewardEnergy")!;
    if (reward.energy > 0) {
      this.energyAmount.textContent = `+${reward.energy}`;
      energyPill.classList.remove("hidden");
    } else {
      energyPill.classList.add("hidden");
    }
    this.chestRewards.classList.remove("hidden");

    if (reward.item) {
      this.drawItemPreview(reward.item.code);
      this.chestPreview.classList.remove("hidden");
      this.chestText.textContent = reward.item.name;
      if (reward.duplicateSold) {
        const refund = reward.sellRefund ?? Math.floor(reward.item.price / 2);
        this.dupNote.textContent = `Уже есть — продано за ${refund} BC`;
        this.dupNote.classList.remove("hidden");
      } else {
        this.dupNote.classList.add("hidden");
      }
    } else {
      this.chestPreview.classList.add("hidden");
      this.chestText.textContent = "";
      this.dupNote.classList.add("hidden");
    }
  }

  private drawItemPreview(code: string): void {
    const ctx = this.chestPreview.getContext("2d");
    if (!ctx) return;
    const w = this.chestPreview.width;
    const h = this.chestPreview.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1b1f24";
    ctx.fillRect(0, 0, w, h);
    const def = wardrobeItem(code);
    if (!def) {
      ctx.fillStyle = "#7ac07a";
      ctx.font = "16px Trebuchet MS";
      ctx.textAlign = "center";
      ctx.fillText(code, w / 2, h / 2);
      return;
    }
    const img = new Image();
    img.onload = () => {
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min((w - 20) / img.width, (h - 20) / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };
    img.src = publicPath(`assets/${def.file}`);
  }

  private launchConfetti(): void {
    const w = (this.confetti.width = stage.width);
    const h = (this.confetti.height = stage.height);
    const colors = ["#f94144", "#f8961e", "#f9c74f", "#90be6d", "#43aa8b", "#577590", "#ff70a6"];
    this.confettiParticles = [];
    const cx = w / 2;
    const cy = h * 0.42;
    for (let i = 0; i < 180; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 9;
      this.confettiParticles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.4,
        size: 6 + Math.random() * 6,
        color: colors[i % colors.length],
      });
    }
    this.confettiLast = performance.now();
    cancelAnimationFrame(this.confettiRaf);
    this.confettiLoop();
  }

  private confettiLoop = (): void => {
    const now = performance.now();
    const frame = Math.min((now - this.confettiLast) / 16.67, 3);
    this.confettiLast = now;
    const ctx = this.confettiCtx;
    const { width, height } = this.confetti;
    ctx.clearRect(0, 0, width, height);
    const alive: ConfettiParticle[] = [];
    for (const p of this.confettiParticles) {
      p.vy += 0.3 * frame;
      p.vx *= 0.99;
      p.x += p.vx * frame;
      p.y += p.vy * frame;
      p.rot += p.vrot * frame;
      if (p.y - p.size > height) continue;
      alive.push(p);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    this.confettiParticles = alive;
    if (alive.length) this.confettiRaf = requestAnimationFrame(this.confettiLoop);
    else ctx.clearRect(0, 0, width, height);
  };

  private stopConfetti(): void {
    cancelAnimationFrame(this.confettiRaf);
    this.confettiParticles = [];
    this.confettiCtx.clearRect(0, 0, this.confetti.width, this.confetti.height);
  }
}

function formatChance(chance: number): string {
  const pct = chance * 100;
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(3)}%`;
}

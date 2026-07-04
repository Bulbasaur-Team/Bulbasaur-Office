import Phaser from "phaser";
import { CHARACTERS, type Character } from "../data/characters";
import { LOCATIONS, LOC, type ExitDef } from "../data/locations";
import { registerSpriteImages, spriteScale } from "../entities/sprites";
import { Dialogue } from "../ui/Dialogue";
import { SpeechBubble } from "../ui/SpeechBubble";
import { ThoughtBubble } from "../ui/ThoughtBubble";
import { SlideViewer } from "../ui/SlideViewer";
import { Projector } from "../ui/Projector";
import { LocationMenu } from "../ui/LocationMenu";
import { GameMenu } from "../ui/GameMenu";
import { BulbaJump } from "../ui/BulbaJump";
import { BulbaPacker } from "../ui/BulbaPacker";
import { BulbaParking } from "../ui/BulbaParking";
import { BulbaGuess } from "../ui/BulbaGuess";
import { BulbaWordle } from "../ui/BulbaWordle";
import { TvScreen } from "../ui/TvScreen";

// Запущенная игра, которую можно свернуть на экран TV и развернуть обратно.
interface ArcadeGame {
  isOpen: boolean;     // сессия существует (полный экран или свёрнута)
  minimized: boolean;  // свёрнута на TV (на паузе, ход не блокирует)
  restore(): void;
  getCanvas(): HTMLCanvasElement;
}
import { KeyboardRouter } from "../ui/KeyboardRouter";
import { showCharacterSelect } from "../ui/CharacterSelect";
import { LocationLoader, type Spawn, type PlacedNpc } from "./LocationLoader";
import { AuthGate } from "../ui/AuthGate";
import { Leaderboard, type LeaderboardGame } from "../ui/Leaderboard";
import * as api from "../net/api";

// Мини-игры для лидерборда: порядок листания, заголовок и формат значения.
const GAMES: LeaderboardGame[] = [
  { id: "bulbajump", title: "Bulba Jump", format: (v) => String(v) },
  { id: "bulbapacker", title: "Bulba Packer", format: (v) => String(v) },
  { id: "bulbaparking", title: "Bulba Parking", format: (v) => (v / 1000).toFixed(1) + " с" },
  { id: "bulbaguess", title: "Bulba Guess", format: (v) => v + " поп." },
  { id: "bulbawordle", title: "Bulba Wordle", format: (v) => v + " слов" },
];

const SPEED = 400;
const INTERACT_DIST = 80;
const TARGET_H = 74;       // экранная высота персонажа в пикселях
const EXIT_ZONE_HALF = 52; // полразмера зоны срабатывания выхода вокруг точки двери

const THOUGHT_INTERVAL_MS = 5000;        // базовый интервал проверки «не подумать ли»
const THOUGHT_INTERVAL_JITTER_MS = 5000; // случайная добавка к интервалу — чтобы NPC думали не разом
const THOUGHT_PROBABILITY = 0.1;         // вероятность появления мысли при очередной проверке

const DEPTH = {
  prompt: 1_000_000,
  player: 1_000_001,
  doorOverlay: 2_000_000,
  bubble: 3_000_000,
} as const;

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private npcs: PlacedNpc[] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private router!: KeyboardRouter;
  private loader!: LocationLoader;
  private dialogue!: Dialogue;
  private bubble!: SpeechBubble;
  private thoughtBubbles: ThoughtBubble[] = []; // облачко мыслей на каждый NPC текущей локации (по индексу npcs)
  private thoughtTimers: Phaser.Time.TimerEvent[] = []; // персональный таймер проверки на каждый NPC
  private slides!: SlideViewer;
  private projector!: Projector;
  private gameMenu!: GameMenu;
  private bulbaJump!: BulbaJump;
  private bulbaPacker!: BulbaPacker;
  private bulbaParking!: BulbaParking;
  private bulbaGuess!: BulbaGuess;
  private bulbaWordle!: BulbaWordle;
  private tvScreen!: TvScreen;
  private authGate!: AuthGate;
  private leaderboard!: Leaderboard;
  private activeGame: ArcadeGame | null = null;
  private playerBaseScale = 1; // исходный масштаб игрока (анимация множит на него)
  private walkPhase = 0;       // фаза шага игрока
  private prompt!: Phaser.GameObjects.Text;
  private nearest: PlacedNpc | null = null;
  private talking: PlacedNpc | null = null;
  private started = false;

  private chosen!: Character;
  private locIndex = 0;
  private atParking = false;
  private doors: Map<string, Spawn> = new Map(); // двери текущей локации (ключ — id соседней локации)
  private tv: Spawn | null = null;               // точка телевизора в текущей локации, если есть
  private menu!: LocationMenu;
  private exitBtn = document.getElementById("exitBtn") as HTMLButtonElement;
  private exitLabel = document.getElementById("exitLabel") as HTMLSpanElement;
  private currentExit: ExitDef | null = null;

  constructor() {
    super("World");
  }

  create(): void {
    registerSpriteImages(this);
    this.walls = this.physics.add.staticGroup();
    this.router = new KeyboardRouter();
    this.loader = new LocationLoader(this, this.walls, TARGET_H, DEPTH.doorOverlay);

    this.bubble = new SpeechBubble(this, DEPTH.bubble);
    this.projector = new Projector(this, (slides, index) => {
      this.dialogue.paused = true;
      this.slides.open(slides, index);
    });
    this.slides = new SlideViewer((index) => {
      this.dialogue.paused = false;
      this.projector.setIndex(index);
    });
    this.dialogue = new Dialogue({
      onSay: (text) => {
        if (this.talking) this.bubble.show(text, this.talking.x, this.talking.y - TARGET_H / 2);
      },
      onShowSlides: (npc) => this.projector.show(npc),
      onClose: () => {
        this.bubble.hide();
        this.projector.hide();
      },
    });

    this.prompt = this.add
      .text(0, 0, "Пробел / Enter — поговорить", {
        fontFamily: "Trebuchet MS",
        fontSize: "14px",
        color: "#7ac07a",
        backgroundColor: "#000000c0",
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.prompt)
      .setVisible(false);

    this.bulbaJump = new BulbaJump();
    this.bulbaPacker = new BulbaPacker();
    this.bulbaParking = new BulbaParking();
    this.bulbaGuess = new BulbaGuess();
    this.bulbaWordle = new BulbaWordle();
    this.tvScreen = new TvScreen(this, () => this.expandGame());
    // Свернуть из любой игры -> показать мини-версию на экране TV.
    for (const g of [this.bulbaJump, this.bulbaPacker, this.bulbaParking, this.bulbaGuess, this.bulbaWordle]) {
      g.onMinimize = () => this.minimizeGame();
    }

    // По завершении партии игра отдаёт результат — отправляем его и показываем лидерборд.
    this.leaderboard = new Leaderboard(GAMES);
    document.getElementById("lbBtn")!.onclick = () => void this.leaderboard.open();
    document.getElementById("logoutBtn")!.onclick = () => {
      api.logout();
      window.location.reload();
    };
    this.bulbaJump.onGameOver = (v) => this.reportScore("bulbajump", v);
    this.bulbaPacker.onGameOver = (v) => this.reportScore("bulbapacker", v);
    this.bulbaParking.onGameOver = (v) => this.reportScore("bulbaparking", v);
    this.bulbaGuess.onGameOver = (v) => this.reportScore("bulbaguess", v);
    this.bulbaWordle.onGameOver = (v) => this.reportScore("bulbawordle", v);

    this.gameMenu = new GameMenu((id) => this.openGame(id));

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;

    this.menu = new LocationMenu((to) => this.goTo(to));

    // Потребители ввода по приоритету: полноэкранные окна (слайды, игра) поверх меню
    // (диалог, выбор игры, парковка). Выход в дверь и взаимодействие с NPC/TV
    // разбираются в update() — там Space и Enter равноценны.
    this.router.register(this.slides);
    this.router.register(this.dialogue);
    this.router.register(this.gameMenu);
    this.router.register(this.menu);
    // Взаимодействие в мире (NPC / TV / дверь) — ниже всех меню: срабатывает,
    // только если модалка не перехватила клавишу первой (иначе клавиша, которой
    // закрыли меню, «протекала» бы в мир и срабатывала повторно). Space и Enter
    // равноценны.
    this.router.register({
      isActive: () => this.started && !this.atParking && !this.modalOpen(),
      handleKey: (e) => {
        if (e.code !== "Space" && e.code !== "Enter") return false;
        return this.tryInteract();
      },
    });

    this.exitBtn.onclick = () => this.triggerExit();

    // Сначала вход/регистрация. Если игрок уже авторизован — сразу выбор персонажа.
    this.authGate = new AuthGate();
    const pickCharacter = () => showCharacterSelect(CHARACTERS, (chosen) => this.startAs(chosen));
    if (api.isAuthenticated()) pickCharacter();
    else void this.authGate.open().then(pickCharacter);
  }

  // Отправить результат мини-игры на сервер и показать лидерборд.
  private async reportScore(gameId: string, value: number): Promise<void> {
    try {
      const board = await api.submitScore(gameId, value);
      this.leaderboard.showBoard(gameId, board);
    } catch (e) {
      console.error("Не удалось отправить результат:", e);
    }
  }

  private startAs(chosen: Character): void {
    this.chosen = chosen;
    this.player = this.physics.add.sprite(0, 0, chosen.sprite);
    this.playerBaseScale = spriteScale(this, chosen.sprite, TARGET_H);
    this.player.setScale(this.playerBaseScale).setDepth(DEPTH.player);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);

    // Без fromId — игрок встанет на точку своего персонажа из слоя spawns.
    this.loadLocation(0);
    this.started = true;
    document.getElementById("lbBtn")!.classList.remove("hidden");
    document.getElementById("logoutBtn")!.classList.remove("hidden");
  }

  // Строит локацию index, снося предыдущую. fromId — id локации, откуда пришли:
  // игрок встаёт в одноимённую дверь (слой doors); если её нет (фаст-тревел с парковки
  // в локацию без её двери) — в первую дверь. undefined — старт игры: игрок встаёт в
  // точку своего персонажа (слой spawns).
  private loadLocation(index: number, fromId?: string): void {
    const cfg = LOCATIONS[index];
    this.locIndex = index;
    this.atParking = !!cfg.isParking;

    const { npcs, doors, spawns, interactions } = this.loader.load(cfg, index, this.chosen.id);
    this.npcs = npcs;
    this.thoughtBubbles.forEach((b) => b.destroy());
    this.thoughtTimers.forEach((t) => t.remove());
    this.thoughtBubbles = npcs.map(() => new ThoughtBubble(this, DEPTH.bubble));
    // У каждого NPC свой период и фазовый сдвиг старта — мысли всплывают вразнобой.
    this.thoughtTimers = npcs.map((npc, i) =>
      this.time.addEvent({
        delay: THOUGHT_INTERVAL_MS + Phaser.Math.Between(0, THOUGHT_INTERVAL_JITTER_MS),
        startAt: Phaser.Math.Between(0, THOUGHT_INTERVAL_MS),
        loop: true,
        callback: () => this.tryThink(npc, this.thoughtBubbles[i]),
      }),
    );
    this.doors = doors;
    this.tv = interactions.get("tv") ?? null;

    // Свёрнутая игра видна на экране TV только в чилл-зоне.
    if (this.activeGame && this.activeGame.minimized && index === LOC.chillZone) {
      this.tvScreen.show(this.activeGame.getCanvas());
    } else {
      this.tvScreen.hide();
    }

    this.player.setVisible(!this.atParking);
    if (this.atParking) {
      // На парковке ходить нельзя — прячем игрока и показываем меню локаций.
      this.player.setVelocity(0);
      this.menu.show(cfg);
    } else {
      this.menu.hide();
      const p =
        fromId !== undefined
          ? doors.get(fromId) ?? doors.values().next().value
          : spawns.get(this.chosen.id);
      if (p) this.player.setPosition(p.x, p.y);
    }
  }

  // Открыта ли модалка, перехватывающая ввод (диалог, меню игры или окно игры).
  private modalOpen(): boolean {
    return (
      this.dialogue.isOpen ||
      this.gameMenu.isOpen ||
      // Свёрнутая игра (minimized) ход не блокирует — только полноэкранная.
      (this.bulbaJump.isOpen && !this.bulbaJump.minimized) ||
      (this.bulbaPacker.isOpen && !this.bulbaPacker.minimized) ||
      (this.bulbaParking.isOpen && !this.bulbaParking.minimized) ||
      (this.bulbaGuess.isOpen && !this.bulbaGuess.minimized) ||
      (this.bulbaWordle.isOpen && !this.bulbaWordle.minimized) ||
      this.leaderboard.isOpen
    );
  }

  private openGame(id: string): void {
    this.gameMenu.close();
    this.tvScreen.hide();
    if (id === "bulbajump") { this.bulbaJump.open(this.chosen.sprite); this.activeGame = this.bulbaJump; }
    else if (id === "bulbapacker") { this.bulbaPacker.open(); this.activeGame = this.bulbaPacker; }
    else if (id === "bulbaparking") { this.bulbaParking.open(); this.activeGame = this.bulbaParking; }
    else if (id === "bulbaguess") { this.bulbaGuess.open(); this.activeGame = this.bulbaGuess; }
    else if (id === "bulbawordle") { this.bulbaWordle.open(); this.activeGame = this.bulbaWordle; }
  }

  // Свернуть текущую игру на экран TV (игра продолжает работать).
  private minimizeGame(): void {
    if (this.activeGame) this.tvScreen.show(this.activeGame.getCanvas());
  }

  // Развернуть свёрнутую игру обратно на весь экран.
  private expandGame(): void {
    if (!this.activeGame) return;
    this.activeGame.restore();
    this.tvScreen.hide();
  }

  private goTo(to: number): void {
    this.showExit(null);
    this.loadLocation(to, LOCATIONS[this.locIndex].id);
  }

  private triggerExit(): void {
    if (this.currentExit) this.goTo(this.currentExit.to);
  }

  private showExit(exit: ExitDef | null): void {
    if (exit === this.currentExit) return;
    this.currentExit = exit;
    if (exit) {
      this.exitLabel.textContent = LOCATIONS[exit.to].enterLabel;
      this.exitBtn.classList.remove("hidden");
    } else {
      this.exitBtn.classList.add("hidden");
    }
  }

  // Первый выход, рядом с дверью которого стоит игрок. Дверь — точка слоя doors
  // с именем = id целевой локации; зона срабатывания — квадрат вокруг неё.
  private findExit(): ExitDef | null {
    for (const exit of LOCATIONS[this.locIndex].exits) {
      const door = this.doors.get(LOCATIONS[exit.to].id);
      if (
        door &&
        Math.abs(this.player.x - door.x) <= EXIT_ZONE_HALF &&
        Math.abs(this.player.y - door.y) <= EXIT_ZONE_HALF
      ) {
        return exit;
      }
    }
    return null;
  }

  update(_time: number, delta: number): void {
    if (!this.started) return;

    // Мини-версия игры на TV: перерисовываем кадр; если игру закрыли — убираем.
    this.tvScreen.update();
    if (this.activeGame && !this.activeGame.isOpen) {
      this.activeGame = null;
      this.tvScreen.hide();
    }

    this.animateCharacters(delta);

    // На парковке управление недоступно — работает только меню.
    if (this.atParking) {
      this.player.setVelocity(0);
      this.prompt.setVisible(false);
      this.showExit(null);
      return;
    }

    if (this.modalOpen()) {
      this.player.setVelocity(0);
      this.prompt.setVisible(false);
      this.showExit(null);
      return;
    }

    this.player.setVelocity(0);
    if (this.cursors.left.isDown || this.keys.A.isDown) {
      this.player.setVelocityX(-SPEED);
      this.player.setFlipX(false);
    } else if (this.cursors.right.isDown || this.keys.D.isDown) {
      this.player.setVelocityX(SPEED);
      this.player.setFlipX(true);
    }
    if (this.cursors.up.isDown || this.keys.W.isDown) this.player.setVelocityY(-SPEED);
    else if (this.cursors.down.isDown || this.keys.S.isDown) this.player.setVelocityY(SPEED);
    this.player.body.velocity.normalize().scale(SPEED);

    this.nearest = null;
    let best = INTERACT_DIST;
    for (const c of this.npcs) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, c.x, c.y);
      if (d < best) {
        best = d;
        this.nearest = c;
      }
    }

    this.showExit(this.findExit());

    // Только подсказки: сами действия по Space/Enter выполняет консьюмер роутера
    // (tryInteract) — так клавиша, закрывшая меню, не срабатывает повторно в мире.
    if (this.nearest) {
      this.showPrompt("Пробел / Enter — поговорить", this.nearest.x, this.nearest.y);
    } else if (this.tv && this.near(this.tv)) {
      const label =
        this.activeGame && this.activeGame.minimized
          ? "Пробел / Enter — продолжить игру"
          : "Пробел / Enter — выбрать игру";
      this.showPrompt(label, this.tv.x, this.tv.y);
    } else {
      this.prompt.setVisible(false);
    }
  }

  // Действие по Space/Enter рядом с объектом. Приоритет: NPC → телевизор → дверь.
  // Опирается на nearest/tv/currentExit, которые обновляет update() каждый кадр.
  private tryInteract(): boolean {
    if (this.nearest) {
      this.talking = this.nearest;
      this.thoughtBubbles[this.npcs.indexOf(this.nearest)]?.hide();
      this.dialogue.open(this.nearest.char);
      return true;
    }
    if (this.tv && this.near(this.tv)) {
      if (this.activeGame && this.activeGame.minimized) this.expandGame();
      else this.gameMenu.open();
      return true;
    }
    if (this.currentExit) {
      this.triggerExit();
      return true;
    }
    return false;
  }

  // Процедурная анимация без отдельных кадров: при ходьбе игрок покачивается и
  // подпрыгивает. Меняем только масштаб и угол (визуально), физическое тело и
  // позиция не затрагиваются.
  private animateCharacters(delta: number): void {
    const moving = this.player.body.velocity.lengthSq() > 4;
    if (moving) {
      this.walkPhase += delta * 0.013;
      const swing = Math.sin(this.walkPhase);
      const bounce = Math.abs(Math.sin(this.walkPhase)); // дважды за шаг — на каждую ногу
      this.player.setAngle(swing * 5);
      this.player.scaleY = this.playerBaseScale * (1 + bounce * 0.05);
    } else {
      this.walkPhase = 0;
      this.player.setAngle(0);
      this.player.scaleY = this.playerBaseScale;
    }
  }

  // Срабатывает по персональному таймеру NPC: если он свободен, с вероятностью
  // THOUGHT_PROBABILITY всплывает облачко со случайной мыслью.
  private tryThink(npc: PlacedNpc, bubble: ThoughtBubble): void {
    if (!this.started || this.atParking || this.modalOpen()) return;
    if (bubble.isActive || npc === this.talking) return;
    if (Math.random() > THOUGHT_PROBABILITY) return;
    const thought = Phaser.Utils.Array.GetRandom(npc.char.thoughts);
    bubble.show(thought, npc.x, npc.y - TARGET_H / 2);
  }

  private near(p: Spawn): boolean {
    return Phaser.Math.Distance.Between(this.player.x, this.player.y, p.x, p.y) < INTERACT_DIST;
  }

  private showPrompt(text: string, x: number, y: number): void {
    this.prompt.setText(text).setPosition(x, y - TARGET_H * 0.85).setVisible(true);
  }
}

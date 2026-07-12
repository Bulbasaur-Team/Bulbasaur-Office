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
import { showModeSelect } from "../ui/ModeSelect";
import { showRoleSelect } from "../ui/RoleSelect";
import type { RoleDef } from "../data/roles";
import { ROLES, spriteForRole } from "../data/roles";
import { EMOTES, emojiForEmote } from "../data/emotes";
import { Realtime, type RemoteState } from "../net/realtime";
import { PlanningPoker } from "../ui/PlanningPoker";
import { RemotePlayer } from "../entities/RemotePlayer";
import { ItemsManager, type ObstacleCircle } from "../entities/ItemsManager";
import { LocationLoader, type Spawn, type Rect, type PlacedNpc } from "./LocationLoader";
import { AuthGate } from "../ui/AuthGate";
import { Leaderboard, type LeaderboardGame } from "../ui/Leaderboard";
import { Achievements } from "../ui/Achievements";
import { AchievementPopup } from "../ui/AchievementPopup";
import { Community } from "../ui/Community";
import { PasswordChange } from "../ui/PasswordChange";
import { Ancestors } from "../ui/Ancestors";
import { Logs } from "../ui/Logs";
import { Joystick, isTouch } from "../ui/TouchControls";
import * as api from "../net/api";

// Мини-игры для лидерборда: порядок листания, заголовок и формат значения.
const GAMES: LeaderboardGame[] = [
  // Отдельные лидерборды слова дня (по числу попыток, меньше — лучше).
  { id: "wotd-bulbaguess", code: "bulbaguess", daily: true, title: "Слово дня: Bulba Guess", format: (v) => v + " поп." },
  { id: "wotd-bulbawordle", code: "bulbawordle", daily: true, title: "Слово дня: Bulba Wordle", format: (v) => v + " поп." },
  { id: "bulbajump", title: "Bulba Jump", format: (v) => String(v) },
  { id: "bulbapacker", title: "Bulba Packer", format: (v) => String(v) },
  { id: "bulbaparking", title: "Bulba Parking", format: (v) => (v / 1000).toFixed(1) + " с" },
  { id: "bulbaguess", title: "Bulba Guess", format: (v) => v + " слов" },
  { id: "bulbawordle", title: "Bulba Wordle", format: (v) => v + " слов" },
];

// Соответствие базовой игры её id в списке дневных лидербордов.
// Флаг в sessionStorage: после «Сменить режим» показать экран выбора режима,
// который при обычном входе пропускается (по умолчанию — мультиплеер).
const PICK_MODE_KEY = "bulba_pick_mode";

const WOTD_BOARD_ID: Record<string, string> = {
  bulbaguess: "wotd-bulbaguess",
  bulbawordle: "wotd-bulbawordle",
};

const SPEED = 400;
const INTERACT_DIST = 80;
const BODY_RADIUS = 26; // радиус круга персонажа (игрок/NPC) для отскока мяча
const CHAT_HOLD_MS = 4000; // сколько держать облачко своего чата после печати
const EMOTE_HOLD_MS = 2500; // сколько держать свою реакцию
const EMOTE_FONT = 30;      // размер эмодзи-реакции
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
  private items!: ItemsManager;
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
  private poker!: PlanningPoker;
  private authGate!: AuthGate;
  private leaderboard!: Leaderboard;
  private achievements!: Achievements;
  private achievementPopup!: AchievementPopup;
  private community!: Community;
  private passwordChange!: PasswordChange;
  private ancestors!: Ancestors;
  private logs!: Logs;
  private joystick: Joystick | null = null;
  private activeGame: ArcadeGame | null = null;
  private playerBaseScale = 1; // исходный масштаб игрока (анимация множит на него)
  private walkPhase = 0;       // фаза шага игрока
  private playerLabel!: Phaser.GameObjects.Text; // бейдж с логином над игроком
  private prompt!: Phaser.GameObjects.Text;
  private nearest: PlacedNpc | null = null;
  private talking: PlacedNpc | null = null;
  private started = false;

  private multiplayer = false;
  private role: RoleDef | null = null;
  private realtime = new Realtime();
  private remotePlayers = new Map<string, RemotePlayer>(); // чужие игроки текущей комнаты, ключ — id сессии
  private moveAcc = 0;             // накопитель времени для троттлинга отправки move
  private lastSentX = -1;
  private lastSentY = -1;
  private lastSentFacing = false;

  private chosen!: Character;
  private locIndex = 0;
  private atParking = false;
  private doors: Map<string, Spawn> = new Map(); // двери текущей локации (ключ — id соседней локации)
  private tv: Spawn | null = null;               // точка телевизора в текущей локации, если есть
  private tvRect: Rect | null = null;            // прямоугольник экрана TV из карты (объект "tvScreen")
  private ancestorsRect: Rect | null = null;     // прямоугольник стены с портретами предков (объект "ancestors")
  private printerRect: Rect | null = null;       // прямоугольник принтера с логами в дата-центре (объект "printer")
  private pokerRect: Rect | null = null;         // прямоугольник столов для Planning Poker в дата-центре (объект "poker")
  private menu!: LocationMenu;
  private exitBtn = document.getElementById("exitBtn") as HTMLButtonElement;
  private exitLabel = document.getElementById("exitLabel") as HTMLSpanElement;
  private chatInput = document.getElementById("chatInput") as HTMLInputElement;
  private emoteBar = document.getElementById("emoteBar") as HTMLDivElement;
  private emoteBarBuilt = false;
  private currentExit: ExitDef | null = null;

  constructor() {
    super("World");
  }

  create(): void {
    // Только для dev/тестов: доступ к сцене из консоли/CDP (в проде вырезается).
    if (import.meta.env.DEV) (window as unknown as { __world?: WorldScene }).__world = this;

    registerSpriteImages(this);
    this.walls = this.physics.add.staticGroup();
    this.router = new KeyboardRouter();
    this.loader = new LocationLoader(this, this.walls, TARGET_H, DEPTH.doorOverlay);
    this.items = new ItemsManager(this);

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
    this.achievements = new Achievements();
    this.achievementPopup = new AchievementPopup();
    document.getElementById("achBtn")!.onclick = () => void this.achievements.open();
    this.community = new Community((login) => void this.achievements.open(login));
    document.getElementById("communityBtn")!.onclick = () => void this.community.open();
    this.passwordChange = new PasswordChange();
    this.ancestors = new Ancestors();
    this.logs = new Logs();
    document.getElementById("passBtn")!.onclick = () => {
      (document.getElementById("hudPanel") as HTMLDetailsElement).open = false;
      this.passwordChange.open();
    };
    // Сменить Бульбазавра: тот же экран выбора роли; после сохранения — перезагрузка,
    // чтобы чисто применить новый скин (как при смене режима).
    document.getElementById("roleBtn")!.onclick = () => {
      (document.getElementById("hudPanel") as HTMLDetailsElement).open = false;
      showRoleSelect((role) => {
        api.saveRole(role.id).then(
          () => window.location.reload(),
          (e) => console.error("Не удалось сохранить роль:", e),
        );
      });
    };
    document.getElementById("logoutBtn")!.onclick = () => {
      api.logout();
      window.location.reload();
    };
    // Сменить режим: перезагрузка (токен в localStorage сохраняется) чисто рвёт
    // мультиплеерное соединение/состояние; флаг заставляет показать выбор режима,
    // который при обычном входе пропускается.
    document.getElementById("modeBtn")!.onclick = () => {
      sessionStorage.setItem(PICK_MODE_KEY, "1");
      window.location.reload();
    };
    document.getElementById("deleteBtn")!.onclick = () => void this.deleteAccount();
    document.getElementById("wotdGuessBtn")!.onclick = () => void this.openDailyGame("bulbaguess");
    document.getElementById("wotdWordleBtn")!.onclick = () => void this.openDailyGame("bulbawordle");
    this.bulbaJump.onGameOver = (v) => this.reportScore("bulbajump", v);
    this.bulbaPacker.onGameOver = (v) => this.reportScore("bulbapacker", v);
    this.bulbaParking.onGameOver = (v) => this.reportScore("bulbaparking", v);
    this.bulbaGuess.onGameOver = (v) => this.reportScore("bulbaguess", v);
    this.bulbaWordle.onGameOver = (v) => this.reportScore("bulbawordle", v);
    this.bulbaGuess.onDailyOver = () => void this.showDailyBoard("bulbaguess");
    this.bulbaWordle.onDailyOver = () => void this.showDailyBoard("bulbawordle");
    // Возвращаем промис (а не void): игра ждёт подтверждения сохранения перед показом
    // лидерборда. При ошибке логируем, но резолвим — чтобы борд всё равно открылся.
    const saveDaily = (gameId: string, s: api.DailyProgress) =>
      api.saveDailyProgress(gameId, s).then(
        () => {},
        (e) => console.error("Не удалось сохранить прогресс слова дня:", e),
      );
    this.bulbaGuess.onDailyProgress = (s) => saveDaily("bulbaguess", s);
    this.bulbaWordle.onDailyProgress = (s) => saveDaily("bulbawordle", s);

    // Тач-управление (только на мобильных): джойстик двигает игрока, кнопка — действие.
    if (isTouch()) {
      this.joystick = new Joystick();
      this.joystick.onAction = () => void this.tryInteract();
    }

    this.gameMenu = new GameMenu((id) => this.openGame(id));

    // Planning poker (только мультиплеер): модалка шлёт команды в реалтайм,
    // ответы сервера роутятся в неё из handlers в startAsRole.
    this.poker = new PlanningPoker({
      list: () => this.realtime.pokerList(),
      create: (name) => this.realtime.pokerCreate(name),
      join: (roomId) => this.realtime.pokerJoin(roomId),
      leave: () => this.realtime.pokerLeave(),
      addTask: (title) => this.realtime.pokerAddTask(title),
      vote: (value) => this.realtime.pokerVote(value),
      finish: () => this.realtime.pokerFinish(),
      close: () => this.realtime.pokerClose(),
    });
    document.getElementById("pokerBtn")!.onclick = () => {
      (document.getElementById("hudPanel") as HTMLDetailsElement).open = false;
      this.poker.open();
    };

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;

    this.menu = new LocationMenu((to) => this.goTo(to));

    // Потребители ввода по приоритету: полноэкранные окна (слайды, игра) поверх меню
    // (диалог, выбор игры, парковка). Выход в дверь и взаимодействие с NPC/TV
    // разбираются в update() — там Space и Enter равноценны.
    this.router.register(this.slides);
    this.router.register(this.poker);
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
    // Ввод чата (мультиплеер): stopPropagation, чтобы клавиши не уходили в управление миром.
    this.chatInput.addEventListener("keydown", (e) => this.onChatKey(e));

    // Сначала вход/регистрация. Режим по умолчанию — мультиплеер; экран выбора режима
    // показывается только после кнопки «Сменить режим» (по флагу в sessionStorage).
    this.authGate = new AuthGate();
    const start = () => {
      if (sessionStorage.getItem(PICK_MODE_KEY)) {
        sessionStorage.removeItem(PICK_MODE_KEY);
        showModeSelect((mode) => {
          if (mode === "single") showCharacterSelect(CHARACTERS, (chosen) => this.startAs(chosen));
          else void this.startMultiplayer();
        });
      } else {
        void this.startMultiplayer();
      }
    };
    if (api.isAuthenticated()) start();
    else void this.authGate.open().then(start);
  }

  // Старт мультиплеера: сохранённая роль — сразу в игру; нет роли (первый вход) —
  // экран выбора, выбор запоминается на сервере.
  private async startMultiplayer(): Promise<void> {
    let savedRole: RoleDef | undefined;
    try {
      const profile = await api.fetchProfile();
      savedRole = ROLES.find((r) => r.id === profile.role);
    } catch (e) {
      console.error("Не удалось получить профиль:", e);
    }
    if (savedRole) {
      this.startAsRole(savedRole);
      return;
    }
    showRoleSelect((role) => {
      api.saveRole(role.id).catch((e) => console.error("Не удалось сохранить роль:", e));
      this.startAsRole(role);
    });
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

  // Показать дневной лидерборд слова дня (прогресс уже сохранён игрой при решении).
  private async showDailyBoard(gameId: string): Promise<void> {
    try {
      const board = await api.fetchDailyLeaderboard(gameId);
      this.leaderboard.showBoard(WOTD_BOARD_ID[gameId], board);
    } catch (e) {
      console.error("Не удалось показать лидерборд слова дня:", e);
    }
  }

  // Открыть игру в режиме слова дня: тянем сиды и сохранённый прогресс, передаём в игру.
  private async openDailyGame(gameId: "bulbaguess" | "bulbawordle"): Promise<void> {
    this.gameMenu.close();
    this.tvScreen.hide();
    try {
      const [wotd, progress] = await Promise.all([api.fetchWotd(), api.fetchDailyProgress(gameId)]);
      if (gameId === "bulbaguess") {
        await this.bulbaGuess.openDaily(wotd.guess.today, wotd.guess.prev, progress);
        this.activeGame = this.bulbaGuess;
      } else {
        await this.bulbaWordle.openDaily(wotd.wordle.today, wotd.wordle.prev, progress);
        this.activeGame = this.bulbaWordle;
      }
    } catch (e) {
      console.error("Не удалось открыть слово дня:", e);
    }
  }

  private startAs(chosen: Character): void {
    this.chosen = chosen;
    this.player = this.physics.add.sprite(0, 0, chosen.sprite);
    this.playerBaseScale = spriteScale(this, chosen.sprite, TARGET_H);
    this.player.setScale(this.playerBaseScale).setDepth(DEPTH.player);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);

    // Бейдж с логином над головой игрока — подсвечен акцентным цветом.
    this.playerLabel = this.add
      .text(0, 0, api.getLogin() ?? "Игрок", {
        fontFamily: "Trebuchet MS",
        fontSize: "14px",
        color: "#14210f",
        backgroundColor: "#7ac07a",
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.player);

    // Без fromId — игрок встанет на точку своего персонажа из слоя spawns.
    this.loadLocation(0);
    this.started = true;
    const hudPanel = document.getElementById("hudPanel") as HTMLDetailsElement;
    hudPanel.classList.remove("hidden");
    // На ПК меню сразу развёрнуто; на тач-устройствах — свёрнуто, чтобы не занимать экран.
    if (!isTouch()) hudPanel.open = true;
  }

  // Удалить аккаунт: подтверждение, запрос на сервер, затем выход и перезагрузка.
  private async deleteAccount(): Promise<void> {
    if (!confirm("Удалить аккаунт? Действие необратимо — ник и результаты будут удалены.")) return;
    try {
      await api.deleteAccount();
      api.logout();
      window.location.reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  // Старт в мультиплеере: скин по роли, NPC скрыты, подключаемся к реалтайму.
  private startAsRole(role: RoleDef): void {
    this.role = role;
    this.multiplayer = true;
    // Игрок в MP — не один из NPC, а роль. Собираем «пустышку» Character, чтобы
    // переиспользовать общий путь запуска (скин, спавн, переходы между локациями).
    const me: Character = {
      id: "__me__",
      name: api.getLogin() ?? "Игрок",
      sprite: role.sprite,
      roleLabel: role.label,
      areaLabel: "",
      slideCount: 0,
      lines: { greet: "", who: "", doing: "", did: "" },
      thoughts: [],
    };
    this.startAs(me);
    this.showEmoteBar();
    document.getElementById("workGroup")!.classList.remove("hidden");
    // Предметы: свои удары и стрим позиции уходят на сервер (в одиночке колбэки не заданы).
    this.items.onKick = (itemId, kickId, x, y, vx, vy) => this.realtime.itemKick(itemId, kickId, x, y, vx, vy);
    this.items.onSync = (itemId, x, y, vx, vy) => this.realtime.itemMove(itemId, x, y, vx, vy);
    // Чат временно отключён: поле ввода не показываем. Реакции (фиксированный набор) — есть.
    this.realtime.connect({
      onOpen: () => {
        this.sendJoin();
        this.poker.onReconnect();
      },
      onSnapshot: (players) => this.onSnapshot(players),
      onJoined: (player) => this.addRemote(player),
      onMoved: (id, x, y, facing) => this.remotePlayers.get(id)?.setTarget(x, y, facing),
      onEmote: (id, code) => this.showRemoteEmote(id, code),
      onLeft: (id) => this.removeRemote(id),
      onItems: (items) => this.items.applySnapshot(items),
      onItemKicked: (itemId, kickId, x, y, vx, vy) => this.items.applyKicked(itemId, kickId, x, y, vx, vy),
      onItemMoved: (itemId, x, y, vx, vy) => this.items.applyMoved(itemId, x, y, vx, vy),
      onPokerRooms: (rooms) => this.poker.onRooms(rooms),
      onPokerState: (state) => this.poker.onState(state),
      onPokerClosed: () => this.poker.onClosed(),
      onPokerError: (message) => this.poker.onError(message),
      onAchievement: (_code, title, description, image) => this.achievementPopup.show(title, description, image),
    });
  }

  // Панель реакций (мультиплеер): строим один раз из EMOTES, потом показываем.
  private showEmoteBar(): void {
    if (!this.emoteBarBuilt) {
      for (const e of EMOTES) {
        const btn = document.createElement("button");
        btn.textContent = e.emoji;
        btn.title = e.title;
        btn.onclick = () => {
          this.sendEmote(e.code);
          btn.blur(); // чтобы Space/Enter не «нажимали» кнопку повторно и уходили в мир
        };
        this.emoteBar.appendChild(btn);
      }
      this.emoteBarBuilt = true;
    }
    this.emoteBar.classList.remove("hidden");
  }

  private sendEmote(code: string): void {
    const emoji = emojiForEmote(code);
    if (!emoji) return;
    this.realtime.emote(code);
    // Свою реакцию показываем локально над своим бульбазавром; едет за игроком.
    this.bubble.show(emoji, this.player.x, this.player.y - TARGET_H * 0.95, EMOTE_HOLD_MS, () => ({
      x: this.player.x,
      y: this.player.y - TARGET_H * 0.95,
    }), EMOTE_FONT);
  }

  private showRemoteEmote(id: string, code: string): void {
    const emoji = emojiForEmote(code);
    if (emoji) this.remotePlayers.get(id)?.showEmote(emoji);
  }

  // Полный состав комнаты: пересобираем чужих аватаров с нуля.
  private onSnapshot(players: RemoteState[]): void {
    this.clearRemotes();
    for (const player of players) this.addRemote(player);
  }

  private addRemote(player: RemoteState): void {
    // На парковке ходить нельзя — это экран-меню, чужих аватаров там не показываем.
    if (this.atParking) return;
    this.remotePlayers.get(player.id)?.destroy();
    this.remotePlayers.set(
      player.id,
      new RemotePlayer(
        this, spriteForRole(player.role), player.login,
        player.x, player.y, player.facing, TARGET_H, DEPTH.bubble,
      ),
    );
  }

  private removeRemote(id: string): void {
    this.remotePlayers.get(id)?.destroy();
    this.remotePlayers.delete(id);
  }

  private clearRemotes(): void {
    for (const rp of this.remotePlayers.values()) rp.destroy();
    this.remotePlayers.clear();
  }

  private onChatKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      const text = this.chatInput.value.trim().slice(0, 200);
      this.chatInput.value = "";
      if (text) this.sendChat(text);
      this.chatInput.blur(); // вернуть управление миром
    } else if (e.key === "Escape") {
      this.chatInput.value = "";
      this.chatInput.blur();
    }
  }

  private sendChat(text: string): void {
    this.realtime.chat(text);
    // Своё сообщение показываем локально над своим бульбазавром; облачко едет за игроком.
    // Якорь выше бейджа с логином (0.7), чтобы облачко его не перекрывало.
    this.bubble.show(text, this.player.x, this.player.y - TARGET_H * 0.95, CHAT_HOLD_MS, () => ({
      x: this.player.x,
      y: this.player.y - TARGET_H * 0.95,
    }));
  }

  // Отправить роль/локацию/позицию как вход в мир (в т.ч. после реконнекта).
  private sendJoin(): void {
    if (!this.role) return;
    this.realtime.join(
      this.role.id,
      LOCATIONS[this.locIndex].id,
      Math.round(this.player.x),
      Math.round(this.player.y),
      this.player.flipX,
    );
  }

  // Строит локацию index, снося предыдущую. fromId — id локации, откуда пришли:
  // игрок встаёт в одноимённую дверь (слой doors); если её нет (фаст-тревел с парковки
  // в локацию без её двери) — в первую дверь. undefined — старт игры: игрок встаёт в
  // точку своего персонажа (слой spawns).
  private loadLocation(index: number, fromId?: string): void {
    const cfg = LOCATIONS[index];
    this.locIndex = index;
    this.atParking = !!cfg.isParking;

    const { npcs, doors, spawns, interactions, rects, items, physicsWalls } = this.loader.load(cfg, index, this.chosen.id, this.multiplayer);
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
    this.tvRect = rects.get("tvScreen") ?? null;
    this.ancestorsRect = rects.get("ancestors") ?? null;
    this.printerRect = rects.get("printer") ?? null;
    this.pokerRect = rects.get("poker") ?? null;
    this.items.load(items, physicsWalls);

    // Свёрнутая игра видна на экране TV только в чилл-зоне (где задан прямоугольник экрана).
    if (this.activeGame && this.activeGame.minimized && index === LOC.chillZone && this.tvRect) {
      this.tvScreen.show(this.tvRect, this.activeGame.getCanvas());
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
          : spawns.get(this.chosen.id) ?? (this.multiplayer ? spawns.values().next().value : undefined);
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
      this.leaderboard.isOpen ||
      this.achievements.isOpen ||
      this.community.isOpen ||
      this.passwordChange.isOpen ||
      this.ancestors.isOpen ||
      this.logs.isOpen ||
      this.poker.isOpen
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
    if (this.activeGame && this.tvRect) this.tvScreen.show(this.tvRect, this.activeGame.getCanvas());
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
    if (this.multiplayer) {
      this.clearRemotes(); // чужие из прежней комнаты не должны оставаться
      this.realtime.room(
        LOCATIONS[this.locIndex].id,
        Math.round(this.player.x),
        Math.round(this.player.y),
        this.player.flipX,
      );
    }
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
    this.updatePlayerLabel();
    this.bubble.update(); // своё чат-облачко едет за игроком (если follow задан)
    for (const rp of this.remotePlayers.values()) rp.update();
    this.updateItems(delta);

    // На парковке управление недоступно — работает только меню.
    if (this.atParking) {
      this.player.setVelocity(0);
      this.prompt.setVisible(false);
      this.showExit(null);
      this.joystick?.setVisible(false);
      return;
    }

    if (this.modalOpen()) {
      this.player.setVelocity(0);
      this.prompt.setVisible(false);
      this.showExit(null);
      this.joystick?.setVisible(false);
      return;
    }

    this.joystick?.setVisible(true);

    this.player.setVelocity(0);
    // Направление от клавиатуры; джойстик (если отклонён) перекрывает его.
    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.keys.A.isDown) vx = -1;
    else if (this.cursors.right.isDown || this.keys.D.isDown) vx = 1;
    if (this.cursors.up.isDown || this.keys.W.isDown) vy = -1;
    else if (this.cursors.down.isDown || this.keys.S.isDown) vy = 1;
    if (this.joystick && (this.joystick.vector.x !== 0 || this.joystick.vector.y !== 0)) {
      vx = this.joystick.vector.x;
      vy = this.joystick.vector.y;
    }
    if (vx !== 0 || vy !== 0) {
      this.player.setVelocity(vx * SPEED, vy * SPEED);
      if (vx !== 0) this.player.setFlipX(vx > 0);
      this.player.body.velocity.normalize().scale(SPEED);
    }

    if (this.multiplayer) this.syncMovement(delta);

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
    } else if (this.ancestorsRect && this.nearRect(this.ancestorsRect)) {
      this.showPrompt(
        "Пробел / Enter — прочитать",
        this.ancestorsRect.x + this.ancestorsRect.w / 2,
        this.ancestorsRect.y + this.ancestorsRect.h,
      );
    } else if (this.printerRect && this.nearRect(this.printerRect)) {
      this.showPrompt(
        "Пробел / Enter — посмотреть логи",
        this.printerRect.x + this.printerRect.w / 2,
        this.printerRect.y + this.printerRect.h,
      );
    } else if (this.pokerRect && this.nearRect(this.pokerRect)) {
      this.showPrompt(
        "Пробел / Enter — сыграть в Planning Poker",
        this.pokerRect.x + this.pokerRect.w / 2,
        this.pokerRect.y + this.pokerRect.h,
      );
    } else {
      this.prompt.setVisible(false);
    }
  }

  // Физика предметов: отскоки от NPC и чужих игроков, удары своего игрока.
  // Скорость игрока берётся с прошлого кадра — для направления удара этого достаточно.
  private updateItems(delta: number): void {
    const player = this.player.visible
      ? {
          x: this.player.x,
          y: this.player.y,
          r: BODY_RADIUS,
          vx: this.player.body.velocity.x,
          vy: this.player.body.velocity.y,
        }
      : null;
    const obstacles: ObstacleCircle[] = [];
    for (const npc of this.npcs) obstacles.push({ x: npc.x, y: npc.y, r: BODY_RADIUS });
    for (const rp of this.remotePlayers.values()) obstacles.push({ x: rp.x, y: rp.y, r: BODY_RADIUS });
    this.items.update(delta, player, obstacles);
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
    if (this.ancestorsRect && this.nearRect(this.ancestorsRect)) {
      this.ancestors.open();
      return true;
    }
    if (this.printerRect && this.nearRect(this.printerRect)) {
      void this.logs.open();
      return true;
    }
    if (this.pokerRect && this.nearRect(this.pokerRect)) {
      this.poker.open();
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

  // Шлём свою позицию не чаще ~10/сек и только при изменении.
  private syncMovement(delta: number): void {
    this.moveAcc += delta;
    if (this.moveAcc < 100) return;
    this.moveAcc = 0;
    const x = Math.round(this.player.x);
    const y = Math.round(this.player.y);
    const facing = this.player.flipX;
    if (x === this.lastSentX && y === this.lastSentY && facing === this.lastSentFacing) return;
    this.lastSentX = x;
    this.lastSentY = y;
    this.lastSentFacing = facing;
    this.realtime.move(x, y, facing);
  }

  // Бейдж следует за игроком над его головой; прячется вместе с игроком (напр. на парковке).
  private updatePlayerLabel(): void {
    this.playerLabel.setVisible(this.player.visible);
    if (this.player.visible) {
      this.playerLabel.setPosition(this.player.x, this.player.y - TARGET_H * 0.7);
    }
  }

  private near(p: Spawn): boolean {
    return Phaser.Math.Distance.Between(this.player.x, this.player.y, p.x, p.y) < INTERACT_DIST;
  }

  // Расстояние от игрока до ближайшей точки прямоугольника (0, если игрок внутри).
  private nearRect(r: Rect): boolean {
    const dx = Math.max(r.x - this.player.x, 0, this.player.x - (r.x + r.w));
    const dy = Math.max(r.y - this.player.y, 0, this.player.y - (r.y + r.h));
    return Math.hypot(dx, dy) < INTERACT_DIST;
  }

  private showPrompt(text: string, x: number, y: number): void {
    this.prompt.setText(text).setPosition(x, y - TARGET_H * 0.85).setVisible(true);
  }
}

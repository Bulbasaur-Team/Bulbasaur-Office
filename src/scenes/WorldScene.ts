import Phaser from "phaser";
import { CHARACTERS, type Character } from "../data/characters";
import { LOCATIONS, LOC, type ExitDef } from "../data/locations";
import { registerSpriteImages, spriteScale } from "../entities/sprites";
import { Dialogue } from "../ui/Dialogue";
import { SpeechBubble } from "../ui/SpeechBubble";
import { ThoughtBubble } from "../ui/ThoughtBubble";
import { SlideViewer } from "../ui/SlideViewer";
import { SlidePicker } from "../ui/SlidePicker";
import { Projector } from "../ui/Projector";
import { slidePathsByOwnerId } from "../ui/slides";
import { LocationMenu } from "../ui/LocationMenu";
import { GameMenu } from "../ui/GameMenu";
import { BulbaJump } from "../ui/BulbaJump";
import { BulbaPacker } from "../ui/BulbaPacker";
import { BulbaParking } from "../ui/BulbaParking";
import { BulbaTanks } from "../ui/BulbaTanks";
import { BulbaGuess } from "../ui/BulbaGuess";
import { BulbaWordle } from "../ui/BulbaWordle";
import { BulbaColors } from "../ui/BulbaColors";
import { BulbaSurki } from "../ui/BulbaSurki";
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
import { WallClock } from "../entities/WallClock";
import { LocationLoader, type Spawn, type Rect, type PlacedNpc } from "./LocationLoader";
import { AuthGate } from "../ui/AuthGate";
import { Leaderboard, type LeaderboardGame, boardChangedForYou, rankDeltas } from "../ui/Leaderboard";
import { Achievements } from "../ui/Achievements";
import { AchievementPopup } from "../ui/AchievementPopup";
import { Community } from "../ui/Community";
import { PasswordChange } from "../ui/PasswordChange";
import { Ancestors } from "../ui/Ancestors";
import { Logs } from "../ui/Logs";
import { Monitoring } from "../ui/Monitoring";
import { Computer } from "../ui/Computer";
import { Laptop } from "../ui/Laptop";
import { computerEnabled, embedded } from "../embed";
import { Joystick, isTouch } from "../ui/TouchControls";
import * as api from "../net/api";

// Русское склонение: 1 слово, 2 слова, 5 слов / 1 попытка, 3 попытки, 10 попыток.
function ruPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  const mod100 = abs % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function formatWords(v: number): string {
  return `${v} ${ruPlural(v, "слово", "слова", "слов")}`;
}

function formatAttempts(v: number): string {
  return `${v} ${ruPlural(v, "попытка", "попытки", "попыток")}`;
}

// Мини-игры для лидерборда: порядок листания, заголовок и формат значения.
const GAMES: LeaderboardGame[] = [
  // Отдельные лидерборды слова дня (по числу попыток, меньше — лучше).
  { id: "wotd-bulbaguess", code: "bulbaguess", daily: true, title: "Слово дня: Bulba Guess", format: formatAttempts },
  { id: "wotd-bulbawordle", code: "bulbawordle", daily: true, title: "Слово дня: Bulba Wordle", format: formatAttempts },
  { id: "bulbajump", title: "Bulba Jump", format: (v) => String(v) },
  { id: "bulbapacker", title: "Bulba Packer", format: (v) => String(v) },
  { id: "bulbaparking", title: "Bulba Parking", format: (v) => (v / 1000).toFixed(1) + " с" },
  { id: "bulbatanks", title: "Bulba Tanks", format: (v) => String(v) },
  { id: "bulbacolors", title: "Bulba Colors", format: (v) => String(v) },
  { id: "bulbasurki", title: "Bulba Surki", format: (v) => String(v) },
  { id: "bulbaguess", title: "Bulba Guess", format: formatWords },
  { id: "bulbawordle", title: "Bulba Wordle", format: formatWords },
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
  private slidePicker!: SlidePicker;
  private projector!: Projector;
  private projectorOn = false;              // включён ли проектор (walk-up / мультиплеер)
  private projectorOwnerId: string | null = null;
  private projectorIndex = 0;
  private projectorFromDialogue = false;    // сюжетный показ из диалога с NPC
  private gameMenu!: GameMenu;
  private bulbaJump!: BulbaJump;
  private bulbaPacker!: BulbaPacker;
  private bulbaParking!: BulbaParking;
  private bulbaTanks!: BulbaTanks;
  private bulbaGuess!: BulbaGuess;
  private bulbaWordle!: BulbaWordle;
  private bulbaColors!: BulbaColors;
  private bulbaSurki!: BulbaSurki;
  private poker!: PlanningPoker;
  private authGate!: AuthGate;
  private leaderboard!: Leaderboard;
  private achievements!: Achievements;
  private achievementPopup!: AchievementPopup;
  private community!: Community;
  private passwordChange!: PasswordChange;
  private ancestors!: Ancestors;
  private logs!: Logs;
  private monitoring!: Monitoring;
  private computer!: Computer;
  private laptop!: Laptop;
  private joystick: Joystick | null = null;
  private phaserAsleep = false; // Phaser loop усыплен, пока fullscreen-аркада жрёт свой rAF
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
  private ancestorsRect: Rect | null = null;     // прямоугольник стены с портретами предков (объект "ancestors")
  private printerRect: Rect | null = null;       // прямоугольник принтера с логами в дата-центре (объект "printer")
  private monitorRect: Rect | null = null;       // мониторы с графиками в комнате мониторинга (объект "monitor")
  private pokerRect: Rect | null = null;         // прямоугольник столов для Planning Poker в дата-центре (объект "poker")
  private coffeeRect: Rect | null = null;        // выдача чашки кофе на кухне чилл-зоны (объект "coffee")
  private computerRect: Rect | null = null;      // ретро-ПК в дата-центре (объект "computer")
  private laptopRects: Rect[] = [];              // ноутбуки в главном офисе (laptop1..laptop4)
  private projectorRect: Rect | null = null;     // зона проектора в главном офисе (объект "projector")
  private easelRect: Rect | null = null;         // мольберт Bulba Colors в главном офисе (объект "easel")
  private surkiRect: Rect | null = null;         // автомат Bulba Surki в чилл-зоне (объект "bulbasurki")
  private wallClock: WallClock | null = null;    // настенные часы (точка "clock" в interactions)
  private menu!: LocationMenu;
  private exitBtn = document.getElementById("exitBtn") as HTMLButtonElement;
  private exitLabel = document.getElementById("exitLabel") as HTMLSpanElement;
  private chatInput = document.getElementById("chatInput") as HTMLInputElement;
  private emoteBar = document.getElementById("emoteBar") as HTMLDivElement;
  private emoteBarBuilt = false;
  private currentExit: ExitDef | null = null;
  private wotdBoardSnap = new Map<string, api.Leaderboard>();

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
    this.slides = new SlideViewer(
      (index) => {
        this.projectorIndex = index;
        this.projector.setIndex(index);
        if (this.multiplayer && this.projectorOn) this.realtime.projectorIndex(index);
      },
      () => {
        this.dialogue.paused = false;
      },
    );
    this.slidePicker = new SlidePicker((owner) => this.turnProjectorOn(owner.id));
    this.dialogue = new Dialogue({
      onSay: (text) => {
        if (this.talking) this.bubble.show(text, this.talking.x, this.talking.y - TARGET_H / 2);
      },
      onShowSlides: (npc) => {
        this.projectorFromDialogue = true;
        this.projector.show(npc);
      },
      onClose: () => {
        this.bubble.hide();
        // Сюжетный показ не трогает общее состояние проектора.
        if (this.projectorFromDialogue && !this.projectorOn) this.projector.hide();
        this.projectorFromDialogue = false;
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
    this.bulbaTanks = new BulbaTanks();
    this.bulbaGuess = new BulbaGuess();
    this.bulbaWordle = new BulbaWordle();
    this.bulbaColors = new BulbaColors();
    this.bulbaSurki = new BulbaSurki();
    // Закрытие fullscreen-аркады будит Phaser: update() во сне не крутится.
    for (const g of [this.bulbaJump, this.bulbaPacker, this.bulbaParking, this.bulbaTanks, this.bulbaGuess, this.bulbaWordle, this.bulbaSurki]) {
      g.onClose = () => this.setPhaserAsleep(false);
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
    this.monitoring = new Monitoring();
    this.computer = new Computer();
    this.laptop = new Laptop();
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
    this.bulbaTanks.onGameOver = (v) => this.reportScore("bulbatanks", v);
    this.bulbaGuess.onGameOver = (v) => this.reportScore("bulbaguess", v);
    this.bulbaWordle.onGameOver = (v) => this.reportScore("bulbawordle", v);
    this.bulbaColors.onGameOver = (v) => this.reportScore("bulbacolors", v);
    this.bulbaSurki.onGameOver = (v) => this.reportScore("bulbasurki", v);
    this.bulbaJump.onLeaderboard = () => void this.leaderboard.open("bulbajump");
    this.bulbaPacker.onLeaderboard = () => void this.leaderboard.open("bulbapacker");
    this.bulbaParking.onLeaderboard = () => void this.leaderboard.open("bulbaparking");
    this.bulbaTanks.onLeaderboard = () => void this.leaderboard.open("bulbatanks");
    this.bulbaColors.onLeaderboard = () => void this.leaderboard.open("bulbacolors");
    this.bulbaSurki.onLeaderboard = () => void this.leaderboard.open("bulbasurki");
    this.bulbaGuess.onLeaderboard = () =>
      void this.leaderboard.open(this.bulbaGuess.isDaily ? "wotd-bulbaguess" : "bulbaguess");
    this.bulbaWordle.onLeaderboard = () =>
      void this.leaderboard.open(this.bulbaWordle.isDaily ? "wotd-bulbawordle" : "bulbawordle");
    this.bulbaGuess.onDailyOver = () => void this.reportDailyBoard("bulbaguess");
    this.bulbaWordle.onDailyOver = () => void this.reportDailyBoard("bulbawordle");
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
    this.router.register(this.slidePicker);
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
      // Игра внутри компьютера — всегда одиночная, выбор режима там не предлагается.
      if (embedded) {
        showCharacterSelect(CHARACTERS, (chosen) => this.startAs(chosen));
      } else if (sessionStorage.getItem(PICK_MODE_KEY)) {
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

  // Отправить результат: лидерборд показываем только если попытка изменила таблицу,
  // и тогда — со стрелками изменения ранга.
  private async reportScore(gameId: string, value: number): Promise<void> {
    try {
      const before = await api.fetchLeaderboard(gameId);
      const after = await api.submitScore(gameId, value);
      if (!boardChangedForYou(before, after)) return;
      this.leaderboard.showBoard(gameId, after, rankDeltas(before, after));
    } catch (e) {
      console.error("Не удалось отправить результат:", e);
    }
  }

  // Слово дня: сравниваем с бордом, снятым при открытии игры.
  private async reportDailyBoard(gameId: string): Promise<void> {
    const boardId = WOTD_BOARD_ID[gameId];
    try {
      const before = this.wotdBoardSnap.get(gameId) ?? { entries: [], you: null };
      const after = await api.fetchDailyLeaderboard(gameId);
      this.wotdBoardSnap.set(gameId, after);
      if (!boardChangedForYou(before, after)) return;
      this.leaderboard.showBoard(boardId, after, rankDeltas(before, after));
    } catch (e) {
      console.error("Не удалось показать лидерборд слова дня:", e);
    }
  }

  // Открыть игру в режиме слова дня: тянем сиды и сохранённый прогресс, передаём в игру.
  private async openDailyGame(gameId: "bulbaguess" | "bulbawordle"): Promise<void> {
    this.gameMenu.close();
    try {
      const [wotd, progress, boardSnap] = await Promise.all([
        api.fetchWotd(),
        api.fetchDailyProgress(gameId),
        api.fetchDailyLeaderboard(gameId),
      ]);
      this.wotdBoardSnap.set(gameId, boardSnap);
      if (gameId === "bulbaguess") {
        await this.bulbaGuess.openDaily(wotd.guess.today, wotd.guess.prev, progress);
      } else {
        await this.bulbaWordle.openDaily(wotd.wordle.today, wotd.wordle.prev, progress);
      }
      this.setPhaserAsleep(true);
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
    // Внутри компьютера меню не показываем совсем: мини-игр там нет, а лидерборд, ачивки
    // и настройки аккаунта — дело внешней игры.
    if (embedded) return;
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
    // Предметы: удары, стрим позиции, захват/бросок/постановка уходят на сервер
    // (в одиночке колбэки не заданы — предметы живут только локально).
    this.items.onKick = (itemId, kickId, x, y, vx, vy) => this.realtime.itemKick(itemId, kickId, x, y, vx, vy);
    this.items.onSync = (itemId, x, y, vx, vy) => this.realtime.itemMove(itemId, x, y, vx, vy);
    this.items.onGrab = (itemId, itemType) => this.realtime.itemGrab(itemId, itemType);
    this.items.onDrop = (itemId, itemType, x, y) => this.realtime.itemDrop(itemId, itemType, x, y);
    this.items.onPlace = (itemId, itemType, table, x, y) => this.realtime.itemPlace(itemId, itemType, table, x, y);
    this.items.onGone = (itemId) => this.realtime.itemGone(itemId);
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
      onItemDropped: (itemId, itemType, x, y) => this.items.applyDropped(itemId, itemType, x, y),
      onPlacedItems: (items) => this.items.applyPlacedSnapshot(items),
      onItemPlaced: (item) => this.items.applyPlaced(item),
      onItemRemoved: (itemId) => this.items.applyRemoved(itemId),
      onItemHeld: (id, itemId, itemType) => {
        // Предмет уехал в лапы другого игрока — из мира его убираем, рисует его он сам.
        this.items.applyHeldByOther(itemId);
        this.remotePlayers.get(id)?.setHeldItem(itemType);
      },
      onItemReleased: (id) => this.remotePlayers.get(id)?.setHeldItem(null),
      onPokerRooms: (rooms) => this.poker.onRooms(rooms),
      onPokerState: (state) => this.poker.onState(state),
      onPokerClosed: () => this.poker.onClosed(),
      onPokerError: (message) => this.poker.onError(message),
      onProjectorState: (state) => this.applyProjectorState(state.on, state.ownerId, state.index),
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
    const remote = new RemotePlayer(
      this, spriteForRole(player.role), player.login,
      player.x, player.y, player.facing, TARGET_H, DEPTH.bubble,
    );
    this.remotePlayers.set(player.id, remote);
    // Пришёл с предметом в лапах — рисуем его и убираем этот предмет из мира.
    if (player.heldItemType) {
      remote.setHeldItem(player.heldItemType);
      if (player.heldItemId) this.items.applyHeldByOther(player.heldItemId);
    }
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

    const { npcs, doors, spawns, interactions, rects, items, physicsWalls, tableRects } = this.loader.load(cfg, index, this.chosen.id, this.multiplayer);
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
    // Внутри компьютера мини-игры, Planning Poker и логи отключены — телевизор, стол
    // покера и принтер остаются частью декорации.
    this.tv = embedded ? null : interactions.get("tv") ?? null;
    this.ancestorsRect = rects.get("ancestors") ?? null;
    this.printerRect = embedded ? null : rects.get("printer") ?? null;
    this.monitorRect = embedded ? null : rects.get("monitor") ?? null;
    this.pokerRect = embedded ? null : rects.get("poker") ?? null;
    this.coffeeRect = rects.get("coffee") ?? null;
    // На последнем уровне вложенности компьютер — просто предмет обстановки: так рекурсия
    // обрывается (см. embed.ts).
    this.computerRect = computerEnabled ? rects.get("computer") ?? null : null;
    this.laptopRects = ["laptop1", "laptop2", "laptop3", "laptop4"]
      .map((name) => rects.get(name))
      .filter((r): r is Rect => !!r);
    this.projectorRect = rects.get("projector") ?? null;
    this.easelRect = rects.get("easel") ?? null;
    this.surkiRect = rects.get("bulbasurki") ?? null;
    this.wallClock?.destroy();
    this.wallClock = null;
    const clockAt = interactions.get("clock");
    if (clockAt) this.wallClock = new WallClock(this, clockAt.x, clockAt.y);
    this.items.load(items, physicsWalls, tableRects, cfg.id);
    // Вне главного офиса общий проектор не рисуем; при возврате стейт придёт по WS
    // (или останется локальным в одиночке, если ещё не выключали).
    if (!this.projectorRect && this.projectorOn) {
      this.projector.hide();
    } else if (this.projectorRect && this.projectorOn && this.projectorOwnerId) {
      const paths = slidePathsByOwnerId(this.projectorOwnerId);
      if (paths) this.projector.showDeck(paths, this.projectorIndex);
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
      this.bulbaJump.isOpen ||
      this.bulbaPacker.isOpen ||
      this.bulbaParking.isOpen ||
      this.bulbaTanks.isOpen ||
      this.bulbaGuess.isOpen ||
      this.bulbaWordle.isOpen ||
      this.bulbaSurki.isOpen ||
      this.bulbaColors.isOpen ||
      this.leaderboard.isOpen ||
      this.achievements.isOpen ||
      this.community.isOpen ||
      this.passwordChange.isOpen ||
      this.ancestors.isOpen ||
      this.logs.isOpen ||
      this.monitoring.isOpen ||
      this.computer.isOpen ||
      this.laptop.isOpen ||
      this.poker.isOpen ||
      this.slidePicker.isOpen ||
      this.slides.isOpen
    );
  }

  private openGame(id: string): void {
    this.gameMenu.close();
    if (id === "bulbajump") this.bulbaJump.open(this.chosen.sprite);
    else if (id === "bulbapacker") this.bulbaPacker.open();
    else if (id === "bulbaparking") this.bulbaParking.open();
    else if (id === "bulbatanks") this.bulbaTanks.open();
    else if (id === "bulbaguess") void this.bulbaGuess.open();
    else if (id === "bulbawordle") void this.bulbaWordle.open();
    this.setPhaserAsleep(true);
  }

  // Пока fullscreen-аркада рисует свой canvas через rAF, Phaser (WebGL + мир) не
  // должен крутиться в фоне — на ProMotion это два полноценных цикла на main thread.
  private setPhaserAsleep(asleep: boolean): void {
    if (asleep === this.phaserAsleep) return;
    this.phaserAsleep = asleep;
    if (asleep) this.game.loop.sleep();
    else this.game.loop.wake(true);
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

    // Часы живут по клиентскому времени — тикают и под модалкой.
    this.wallClock?.sync();

    // Модалка / парковка: не крутить анимации и физику предметов под оверлеем.
    if (this.atParking || this.modalOpen()) {
      this.player.setVelocity(0);
      this.prompt.setVisible(false);
      this.showExit(null);
      this.joystick?.setVisible(false);
      return;
    }

    this.animateCharacters(delta);
    this.updatePlayerLabel();
    this.bubble.update(); // своё чат-облачко едет за игроком (если follow задан)
    for (const rp of this.remotePlayers.values()) rp.update();
    this.updateItems(delta);

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
    const carrying = this.items.carrying();
    if (carrying && !this.items.carriedIsCoffee()) {
      this.showPrompt("Пробел / Enter — бросить предмет", this.player.x, this.player.y);
    } else if (carrying && this.items.canPlaceCarried(this.player.x, this.player.y)) {
      // Чашку подсказываем только у свободного места на столе: в остальных точках её
      // поставить некуда, и Space/Enter уходит дальше по цепочке взаимодействий.
      this.showPrompt("Пробел / Enter — поставить чашку", this.player.x, this.player.y);
    } else if (!carrying && this.items.grabbableNear(this.player.x, this.player.y)) {
      this.showPrompt("Пробел / Enter — взять предмет", this.player.x, this.player.y);
    } else if (this.projectorRect && this.nearRect(this.projectorRect)) {
      const label = this.projectorOn
        ? "Пробел / Enter — выключить проектор"
        : "Пробел / Enter — включить проектор";
      this.showPrompt(
        label,
        this.projectorRect.x + this.projectorRect.w / 2,
        this.projectorRect.y + this.projectorRect.h,
      );
    } else if (this.easelRect && this.nearRect(this.easelRect)) {
      this.showPrompt(
        "Пробел / Enter — сыграть в Bulba Colors",
        this.easelRect.x + this.easelRect.w / 2,
        this.easelRect.y + this.easelRect.h,
      );
    } else if (this.surkiRect && this.nearRect(this.surkiRect)) {
      this.showPrompt(
        "Пробел / Enter — сыграть в Bulba Surki",
        this.surkiRect.x + this.surkiRect.w / 2,
        this.surkiRect.y + this.surkiRect.h,
      );
    } else {
      // У столов с ноутбуками зона NPC и ноутбука пересекаются — берём то, что ближе.
      const nearLaptop = this.nearestLaptop();
      const laptopDist = nearLaptop ? this.distToRect(nearLaptop) : Infinity;
      const npcDist = this.nearest
        ? Phaser.Math.Distance.Between(this.player.x, this.player.y, this.nearest.x, this.nearest.y)
        : Infinity;
      if (nearLaptop && laptopDist <= npcDist) {
        this.showPrompt(
          "Пробел / Enter — включить компьютер",
          nearLaptop.x + nearLaptop.w / 2,
          nearLaptop.y + nearLaptop.h,
        );
      } else if (this.nearest) {
        this.showPrompt("Пробел / Enter — поговорить", this.nearest.x, this.nearest.y);
      } else if (this.tv && this.near(this.tv)) {
        this.showPrompt("Пробел / Enter — выбрать игру", this.tv.x, this.tv.y);
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
      } else if (this.monitorRect && this.nearRect(this.monitorRect)) {
        this.showPrompt(
          "Пробел / Enter — посмотреть графики",
          this.monitorRect.x + this.monitorRect.w / 2,
          this.monitorRect.y + this.monitorRect.h,
        );
      } else if (this.pokerRect && this.nearRect(this.pokerRect)) {
        this.showPrompt(
          "Пробел / Enter — сыграть в Planning Poker",
          this.pokerRect.x + this.pokerRect.w / 2,
          this.pokerRect.y + this.pokerRect.h,
        );
      } else if (this.computerRect && this.nearRect(this.computerRect)) {
        this.showPrompt(
          "Пробел / Enter — включить компьютер",
          this.computerRect.x + this.computerRect.w / 2,
          this.computerRect.y + this.computerRect.h,
        );
      } else if (this.coffeeRect && !carrying && this.nearRect(this.coffeeRect)) {
        this.showPrompt(
          "Пробел / Enter — получить чашку кофе",
          this.coffeeRect.x + this.coffeeRect.w / 2,
          this.coffeeRect.y + this.coffeeRect.h,
        );
      } else {
        this.prompt.setVisible(false);
      }
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
    this.items.carry(this.player.x, this.player.y);
  }

  // Действие по Space/Enter рядом с объектом. Приоритет: предмет в лапах (поставить) →
  // взять предмет → проектор → мольберт → автомат Surki → ноутбук/NPC (кто ближе) → телевизор →
  // стена предков → принтер → мониторы → покер → компьютер → выдача кофе → дверь.
  // Взятие идёт раньше стационарных объектов: иначе чашку, стоящую на столе покера, было
  // бы не поднять — тем же пробелом открывался бы покер.
  private tryInteract(): boolean {
    // В лапах уже что-то есть.
    if (this.items.carrying()) {
      // У двери — уходим в соседнюю локацию вместе с предметом.
      if (this.currentExit) {
        this.triggerExit();
        return true;
      }
      if (this.items.carriedIsCoffee()) {
        // Чашку можно поставить только на свободное место на столе рядом; иначе не
        // мешаем другим действиям (можно, например, донести кофе до двери).
        if (this.items.releaseCarried(this.player.x, this.player.y, this.player.flipX)) return true;
      } else {
        // Мяч бросаем где угодно.
        this.items.releaseCarried(this.player.x, this.player.y, this.player.flipX);
        return true;
      }
    }
    if (this.items.grabNear(this.player.x, this.player.y)) {
      return true;
    }
    if (this.projectorRect && this.nearRect(this.projectorRect)) {
      if (this.projectorOn) this.turnProjectorOff();
      else this.slidePicker.open();
      return true;
    }
    if (this.easelRect && this.nearRect(this.easelRect)) {
      this.bulbaColors.open();
      return true;
    }
    if (this.surkiRect && this.nearRect(this.surkiRect)) {
      this.bulbaSurki.open();
      this.setPhaserAsleep(true);
      return true;
    }
    {
      const nearLaptop = this.nearestLaptop();
      const laptopDist = nearLaptop ? this.distToRect(nearLaptop) : Infinity;
      const npcDist = this.nearest
        ? Phaser.Math.Distance.Between(this.player.x, this.player.y, this.nearest.x, this.nearest.y)
        : Infinity;
      if (nearLaptop && laptopDist <= npcDist) {
        this.laptop.open();
        return true;
      }
      if (this.nearest) {
        this.talking = this.nearest;
        this.thoughtBubbles[this.npcs.indexOf(this.nearest)]?.hide();
        this.dialogue.open(this.nearest.char);
        return true;
      }
    }
    if (this.tv && this.near(this.tv)) {
      this.gameMenu.open();
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
    if (this.monitorRect && this.nearRect(this.monitorRect)) {
      void this.monitoring.open();
      return true;
    }
    if (this.pokerRect && this.nearRect(this.pokerRect)) {
      this.poker.open();
      return true;
    }
    if (this.computerRect && this.nearRect(this.computerRect)) {
      this.computer.open();
      return true;
    }
    // Занятые лапы — кофемашина молчит, и клавиша уходит дальше (например, в дверь).
    if (this.coffeeRect && this.nearRect(this.coffeeRect)
        && this.items.giveCoffee(this.player.x, this.player.y)) {
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

  private turnProjectorOn(ownerId: string): void {
    if (this.multiplayer) {
      this.realtime.projectorOn(ownerId);
      return;
    }
    this.applyProjectorState(true, ownerId, 0);
  }

  private turnProjectorOff(): void {
    if (this.multiplayer) {
      this.realtime.projectorOff();
      return;
    }
    this.applyProjectorState(false, null, 0);
  }

  private applyProjectorState(on: boolean, ownerId: string | null, index: number): void {
    if (!on || !ownerId) {
      this.projectorOn = false;
      this.projectorOwnerId = null;
      this.projectorIndex = 0;
      this.projectorFromDialogue = false;
      this.projector.hide();
      if (this.slides.isOpen) this.slides.close();
      return;
    }
    const paths = slidePathsByOwnerId(ownerId);
    if (!paths) return;

    const sameDeck = this.projectorOn && this.projectorOwnerId === ownerId;
    this.projectorOn = true;
    this.projectorOwnerId = ownerId;
    this.projectorIndex = index;
    this.projectorFromDialogue = false;

    if (this.locIndex === LOC.mainOffice) {
      if (sameDeck) this.projector.setIndex(index);
      else this.projector.showDeck(paths, index);
    }

    if (this.slides.isOpen) {
      if (sameDeck) this.slides.syncIndex(index);
      else this.slides.syncDeck(paths, index);
    }
  }

  private near(p: Spawn): boolean {
    return Phaser.Math.Distance.Between(this.player.x, this.player.y, p.x, p.y) < INTERACT_DIST;
  }

  // Расстояние от игрока до ближайшей точки прямоугольника (0, если игрок внутри).
  private distToRect(r: Rect): number {
    const dx = Math.max(r.x - this.player.x, 0, this.player.x - (r.x + r.w));
    const dy = Math.max(r.y - this.player.y, 0, this.player.y - (r.y + r.h));
    return Math.hypot(dx, dy);
  }

  private nearRect(r: Rect): boolean {
    return this.distToRect(r) < INTERACT_DIST;
  }

  // Ближайший ноутбук в радиусе взаимодействия, либо null.
  private nearestLaptop(): Rect | null {
    let best: Rect | null = null;
    let bestDist = INTERACT_DIST;
    for (const r of this.laptopRects) {
      const d = this.distToRect(r);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    return best;
  }

  private showPrompt(text: string, x: number, y: number): void {
    this.prompt.setText(text).setPosition(x, y - TARGET_H * 0.85).setVisible(true);
  }
}

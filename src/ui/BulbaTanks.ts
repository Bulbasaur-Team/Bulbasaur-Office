import { attachArcadePad } from "./TouchControls";
import { publicPath } from "../publicPath";

const TILE = 24;
const COLS = 19;
const ROWS = 21;
const W = COLS * TILE;
const H = ROWS * TILE;
const STEP_MS = 1000 / 60;
const MAX_LEVEL = 35;
const ENEMIES_PER_LEVEL = 20;
const MAX_TANK_POWER = 3;
const SECOND = 60;

type Dir = "up" | "down" | "left" | "right";
type TileKind = 0 | 1 | 2 | 3 | 4;
type EnemyKind = "normal" | "fast" | "armored";
type PowerUpKind = "star" | "shovel" | "helmet" | "grenade" | "clock";
type MapTheme = "lanes" | "fortress" | "islands" | "marsh" | "canals";

interface Tank {
  x: number;
  y: number;
  dir: Dir;
  speed: number;
  hp: number;
  cooldown: number;
  ai: number;
  kind?: EnemyKind;
}

interface Bullet {
  x: number;
  y: number;
  dir: Dir;
  owner: "player" | "enemy";
  speed: number;
  power: number;
}

interface PowerUp {
  x: number;
  y: number;
  kind: PowerUpKind;
  ttl: number;
  pulse: number;
}

type AudioContextCtor = typeof AudioContext;

const DIRS: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const SPAWNS = [
  { x: TILE + 2, y: TILE + 2 },
  { x: W / 2 - 10, y: TILE + 2 },
  { x: W - TILE * 2 + 2, y: TILE + 2 },
];

const MAP_THEMES: MapTheme[] = ["lanes", "fortress", "islands", "marsh", "canals"];

// Bulba Tanks — ретро-танчики в духе Battle City: защищаем базу внизу поля,
// на каждом уровне выезжает 20 противников, кирпич можно пробивать снарядами.
export class BulbaTanks {
  isOpen = false;
  onClose: (() => void) | null = null;
  onGameOver: ((value: number) => void) | null = null;
  onLeaderboard: (() => void) | null = null;

  private root = document.getElementById("bulbatanks")!;
  private canvas = document.getElementById("btCanvas") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;
  private statusEl = document.getElementById("btStatus")!;
  private shootSound = this.makeSound("shoot.mp3", 0.55);
  private explosionSound = this.makeSound("enemy-explosion.mp3", 0.62);
  private introSound = this.makeSound("intro.mp3", 0.4);

  private map: TileKind[][] = [];
  private playerPower = 0;
  private player: Tank = this.makePlayer();
  private enemies: Tank[] = [];
  private bullets: Bullet[] = [];
  private powerUps: PowerUp[] = [];
  private keys = new Set<string>();
  private level = 1;
  private killed = 0;
  private spawned = 0;
  private score = 0;
  private lives = 3;
  private baseAlive = true;
  private invulnerableTimer = 0;
  private freezeTimer = 0;
  private baseArmorTimer = 0;
  private over = false;
  private won = false;
  private reported = false;
  private spawnTimer = 0;
  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicTimer = 0;
  private musicStep = 0;

  constructor() {
    document.getElementById("btClose")!.onclick = () => this.close();
    document.getElementById("btLb")!.onclick = () => this.onLeaderboard?.();
    document.getElementById("btRestart")!.onclick = () => this.resetCampaign();
    attachArcadePad(this.root.querySelector<HTMLElement>(".arcade-frame")!, (c, d) => this.pressKey(c, d), {
      left: [
        { label: "◀", code: "ArrowLeft" },
        { label: "▶", code: "ArrowRight" },
      ],
      right: [
        { label: "▲", code: "ArrowUp" },
        { label: "▼", code: "ArrowDown" },
        { label: "●", code: "Space" },
      ],
    });
  }

  pressKey(code: string, down: boolean): void {
    const e = { code, preventDefault() {} } as unknown as KeyboardEvent;
    if (down) this.onKeyDown(e);
    else this.onKeyUp(e);
  }

  open(): void {
    this.isOpen = true;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.startAudio();
    this.playSound(this.introSound);
    this.resetCampaign();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.root.classList.add("hidden");
    this.keys.clear();
    this.stopMusic();
    this.onClose?.();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code)) {
      e.preventDefault();
      this.keys.add(e.code);
    } else if ((this.over || this.won) && e.code === "Enter") {
      e.preventDefault();
      this.resetCampaign();
    } else if (e.code === "Escape") {
      this.close();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private resetCampaign(): void {
    this.level = 1;
    this.score = 0;
    this.lives = 3;
    this.playerPower = 0;
    this.invulnerableTimer = 0;
    this.freezeTimer = 0;
    this.baseArmorTimer = 0;
    this.reported = false;
    this.startLevel();
  }

  private startLevel(): void {
    this.map = this.makeMap(this.level);
    this.player = this.makePlayer();
    this.enemies = [];
    this.bullets = [];
    this.powerUps = [];
    this.killed = 0;
    this.spawned = 0;
    this.baseAlive = true;
    this.invulnerableTimer = Math.max(this.invulnerableTimer, SECOND * 2);
    this.freezeTimer = 0;
    this.baseArmorTimer = 0;
    this.over = false;
    this.won = false;
    this.spawnTimer = 0;
    this.keys.clear();
    this.updateStatus();
    this.lastT = performance.now();
    this.acc = 0;
    cancelAnimationFrame(this.raf);
    this.startMusic();
    this.loop();
  }

  private makePlayer(): Tank {
    return {
      x: W / 2 - 10,
      y: H - TILE * 4 + 2,
      dir: "up",
      speed: 2.2 + this.playerPower * 0.18,
      hp: this.playerMaxHp(),
      cooldown: 0,
      ai: 0,
    };
  }

  private makeMap(level: number): TileKind[][] {
    const map: TileKind[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 0 as TileKind));
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1) map[y][x] = 2;
      }
    }

    const holes = this.safeTiles();
    this.paintTheme(map, holes, level, MAP_THEMES[(level - 1) % MAP_THEMES.length]);
    this.clearSafeTiles(map, holes);
    this.ensureRoutes(map);

    const bx = Math.floor(COLS / 2);
    const by = ROWS - 2;
    map[by][bx] = 0;
    for (const [x, y] of this.baseArmorTiles()) map[y][x] = 1;
    return map;
  }

  private safeTiles(): Set<string> {
    const holes = new Set<string>();
    const add = (x: number, y: number): void => {
      holes.add(`${x},${y}`);
    };
    for (const s of SPAWNS) {
      const sx = Math.floor((s.x + 10) / TILE);
      const sy = Math.floor((s.y + 10) / TILE);
      for (let y = sy - 1; y <= sy + 1; y++) {
        for (let x = sx - 1; x <= sx + 1; x++) add(x, y);
      }
    }
    const playerTileX = Math.floor(W / 2 / TILE);
    for (let y = ROWS - 5; y <= ROWS - 2; y++) {
      for (let x = playerTileX - 2; x <= playerTileX + 2; x++) add(x, y);
    }
    return holes;
  }

  private clearSafeTiles(map: TileKind[][], holes: Set<string>): void {
    for (const key of holes) {
      const [x, y] = key.split(",").map(Number);
      if (map[y]?.[x] !== undefined) map[y][x] = 0;
    }
  }

  private paintTheme(map: TileKind[][], holes: Set<string>, level: number, theme: MapTheme): void {
    for (let y = 2; y < ROWS - 3; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (holes.has(`${x},${y}`)) continue;
        const wave = (x * 5 + y * 7 + level * 3) % 13;
        if (theme === "lanes") this.paintLanes(map, x, y, level, wave);
        else if (theme === "fortress") this.paintFortress(map, x, y, level, wave);
        else if (theme === "islands") this.paintIslands(map, x, y, level, wave);
        else if (theme === "marsh") this.paintMarsh(map, x, y, level, wave);
        else this.paintCanals(map, x, y, level, wave);
      }
    }
  }

  private paintLanes(map: TileKind[][], x: number, y: number, level: number, wave: number): void {
    if (x % 3 === 0 && y > 3 && y < ROWS - 5 && y % 2 === level % 2) map[y][x] = 1;
    else if ((y === 7 || y === 13) && x > 2 && x < COLS - 3 && x % 4 !== level % 4) map[y][x] = 1;
    else if (wave === 10 && y > 5 && y < ROWS - 6) map[y][x] = 3;
    else if (wave === 12 && x % 5 === 2) map[y][x] = 2;
  }

  private paintFortress(map: TileKind[][], x: number, y: number, level: number, wave: number): void {
    const cx = Math.floor(COLS / 2);
    const ring = (Math.abs(x - cx) === 4 && y > 4 && y < ROWS - 6) || (Math.abs(y - 10) === 3 && x > 3 && x < COLS - 4);
    if (ring && (x + y + level) % 5 !== 0) map[y][x] = (x + y) % 4 === 0 ? 2 : 1;
    else if ((x === 4 || x === COLS - 5) && y > 2 && y < ROWS - 4 && y % 3 !== 0) map[y][x] = 1;
    else if (wave === 8 && y > 6) map[y][x] = 4;
  }

  private paintIslands(map: TileKind[][], x: number, y: number, level: number, wave: number): void {
    const island = (Math.floor((x + level) / 3) + Math.floor(y / 3)) % 3 === 0;
    if (island && wave < 5) map[y][x] = wave === 0 ? 2 : 1;
    else if (!island && wave === 11 && y > 4 && y < ROWS - 5) map[y][x] = 3;
    else if (wave === 12 && x > 2 && x < COLS - 3) map[y][x] = 4;
  }

  private paintMarsh(map: TileKind[][], x: number, y: number, level: number, wave: number): void {
    if (wave < 3 && y > 4) map[y][x] = 3;
    else if ((x + y + level) % 9 === 0 && y > 3 && y < ROWS - 5) map[y][x] = 4;
    else if ((x % 4 === 1 || x % 4 === 2) && y % 5 === 0 && y > 4) map[y][x] = 1;
    else if (wave === 12 && y < ROWS - 7) map[y][x] = 2;
  }

  private paintCanals(map: TileKind[][], x: number, y: number, level: number, wave: number): void {
    const canal = (x + level) % 5 === 0 || (y + level) % 6 === 0;
    if (canal && y > 3 && y < ROWS - 5 && x > 1 && x < COLS - 2) map[y][x] = 4;
    else if (!canal && wave < 3 && y > 4) map[y][x] = 1;
    else if (wave === 10 && x % 2 === 0) map[y][x] = 2;
    else if (wave === 11 && y > 5) map[y][x] = 3;
  }

  private ensureRoutes(map: TileKind[][]): void {
    const mid = Math.floor(COLS / 2);
    for (let y = 1; y < ROWS - 1; y++) map[y][mid] = 0;
    for (let x = 1; x < COLS - 1; x++) {
      if (x % 2 === 1) map[3][x] = 0;
      if (x % 2 === 0) map[ROWS - 5][x] = 0;
    }
    for (const x of [3, COLS - 4]) {
      for (let y = 2; y < ROWS - 4; y += 2) map[y][x] = 0;
    }
  }

  private loop = (): void => {
    if (!this.isOpen) return;
    const now = performance.now();
    let dt = now - this.lastT;
    this.lastT = now;
    if (dt > 120) dt = 120;
    this.acc += dt;
    while (this.acc >= STEP_MS) {
      this.step();
      this.acc -= STEP_MS;
    }
    this.render();
    if (!this.over && !this.won) this.raf = requestAnimationFrame(this.loop);
  };

  private step(): void {
    const hadInvulnerability = this.invulnerableTimer > 0;
    const hadFreeze = this.freezeTimer > 0;
    const hadBaseArmor = this.baseArmorTimer > 0;
    this.player.cooldown = Math.max(0, this.player.cooldown - 1);
    this.invulnerableTimer = Math.max(0, this.invulnerableTimer - 1);
    this.freezeTimer = Math.max(0, this.freezeTimer - 1);
    this.tickBaseArmor();
    for (const e of this.enemies) {
      if (this.freezeTimer <= 0) {
        e.cooldown = Math.max(0, e.cooldown - 1);
        e.ai -= 1;
      }
    }

    this.spawnTimer -= 1;
    if (this.spawned < ENEMIES_PER_LEVEL && this.enemies.length < 4 && this.spawnTimer <= 0) {
      this.spawnEnemy();
      this.spawnTimer = Math.max(38, 90 - this.level);
    }

    this.controlPlayer();
    this.collectPowerUps();
    if (this.freezeTimer <= 0) for (const e of this.enemies) this.controlEnemy(e);
    this.tickPowerUps();
    this.moveBullets();
    if (
      (this.invulnerableTimer > 0 && this.invulnerableTimer % SECOND === 0) ||
      (this.freezeTimer > 0 && this.freezeTimer % SECOND === 0) ||
      (this.baseArmorTimer > 0 && this.baseArmorTimer % SECOND === 0) ||
      (hadInvulnerability && this.invulnerableTimer === 0) ||
      (hadFreeze && this.freezeTimer === 0) ||
      (hadBaseArmor && this.baseArmorTimer === 0)
    ) this.updateStatus();

    if (this.killed >= ENEMIES_PER_LEVEL && this.enemies.length === 0) {
      if (this.level >= MAX_LEVEL) {
        this.won = true;
        this.finish(this.score + this.lives * 5000);
      } else {
        this.score += 1000 + this.level * 100;
        this.level += 1;
        this.startLevel();
      }
    }
  }

  private controlPlayer(): void {
    const dir = this.readDir();
    if (dir) {
      this.player.dir = dir;
      this.tryMove(this.player, DIRS[dir].x * this.player.speed, DIRS[dir].y * this.player.speed, this.enemies);
    }
    if (this.keys.has("Space")) this.shoot(this.player, "player");
  }

  private readDir(): Dir | null {
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) return "up";
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) return "down";
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) return "left";
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) return "right";
    return null;
  }

  private controlEnemy(t: Tank): void {
    if (t.ai <= 0) {
      t.dir = Math.random() < 0.45 ? this.dirTowardBase(t) : (["up", "down", "left", "right"] as Dir[])[Math.floor(Math.random() * 4)];
      t.ai = 35 + Math.random() * 55;
    }
    const d = DIRS[t.dir];
    if (!this.tryMove(t, d.x * t.speed, d.y * t.speed, [this.player, ...this.enemies.filter((e) => e !== t)])) t.ai = 0;
    if (Math.random() < 0.025 + this.level * 0.001) this.shoot(t, "enemy");
  }

  private dirTowardBase(t: Tank): Dir {
    const base = this.baseRect();
    const dx = base.x + base.w / 2 - (t.x + 10);
    const dy = base.y + base.h / 2 - (t.y + 10);
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
  }

  private spawnEnemy(): void {
    const s = SPAWNS[this.spawned % SPAWNS.length];
    const kind = this.pickEnemyKind();
    const enemy: Tank = {
      x: s.x,
      y: s.y,
      dir: "down",
      speed: this.enemySpeed(kind),
      hp: this.enemyHp(kind),
      cooldown: 35,
      ai: 0,
      kind,
    };
    if (!this.tankBlocked(enemy.x, enemy.y, enemy, [this.player, ...this.enemies])) {
      this.enemies.push(enemy);
      this.spawned += 1;
    }
  }

  private pickEnemyKind(): EnemyKind {
    if (this.spawned % 7 === 5 || (this.level > 8 && this.spawned % 5 === 0)) return "armored";
    if (this.spawned % 4 === 2 || (this.level > 5 && Math.random() < 0.18)) return "fast";
    return "normal";
  }

  private enemySpeed(kind: EnemyKind): number {
    const levelBoost = Math.min(0.7, this.level * 0.03);
    if (kind === "fast") return 1.75 + levelBoost;
    if (kind === "armored") return 1.0 + levelBoost * 0.55;
    return 1.2 + levelBoost;
  }

  private enemyHp(kind: EnemyKind): number {
    if (kind === "armored") return this.level > 15 ? 4 : 3;
    if (kind === "fast") return 1;
    return this.level > 10 && this.spawned % 5 === 0 ? 2 : 1;
  }

  private tryMove(t: Tank, dx: number, dy: number, others: Tank[]): boolean {
    const slow = this.tileUnderTank(t) === 3 ? 0.58 : 1;
    const nx = t.x + dx * slow;
    const ny = t.y + dy * slow;
    if (this.tankBlocked(nx, ny, t, others)) return false;
    t.x = nx;
    t.y = ny;
    return true;
  }

  private tankBlocked(x: number, y: number, self: Tank, others: Tank[]): boolean {
    const r = { x, y, w: 20, h: 20 };
    if (this.solidAtRect(r)) return true;
    for (const o of others) {
      if (o !== self && hit(r, { x: o.x, y: o.y, w: 20, h: 20 })) return true;
    }
    return false;
  }

  private solidAtRect(r: { x: number; y: number; w: number; h: number }): boolean {
    const x0 = Math.floor(r.x / TILE);
    const y0 = Math.floor(r.y / TILE);
    const x1 = Math.floor((r.x + r.w - 1) / TILE);
    const y1 = Math.floor((r.y + r.h - 1) / TILE);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = this.map[y]?.[x];
        if (tile === undefined || tile === 1 || tile === 2 || tile === 4) return true;
      }
    }
    return hit(r, this.baseRect());
  }

  private shoot(t: Tank, owner: "player" | "enemy"): void {
    if (t.cooldown > 0) return;
    const playerShot = owner === "player";
    if (playerShot && this.bullets.filter((b) => b.owner === "player").length >= (this.playerPower >= 2 ? 2 : 1)) return;
    const d = DIRS[t.dir];
    this.bullets.push({
      x: t.x + 10 + d.x * 13,
      y: t.y + 10 + d.y * 13,
      dir: t.dir,
      owner,
      speed: playerShot ? this.playerBulletSpeed() : 5.8,
      power: playerShot ? this.playerPower : 0,
    });
    t.cooldown = playerShot ? this.playerShotCooldown() : 52;
    this.playShoot(playerShot);
  }

  private playerBulletSpeed(): number {
    return [5.8, 7.1, 8.5, 10][this.playerPower] ?? 10;
  }

  private playerShotCooldown(): number {
    return [26, 21, 16, 12][this.playerPower] ?? 12;
  }

  private moveBullets(): void {
    const next: Bullet[] = [];
    bulletLoop:
    for (const b of this.bullets) {
      const d = DIRS[b.dir];
      b.x += d.x * b.speed;
      b.y += d.y * b.speed;
      const br = { x: b.x - 3, y: b.y - 3, w: 6, h: 6 };

      if (b.x < 0 || b.y < 0 || b.x >= W || b.y >= H) continue;
      if (hit(br, this.baseRect())) {
        this.baseAlive = false;
        this.gameOver(false);
        continue;
      }

      const tx = Math.floor(b.x / TILE);
      const ty = Math.floor(b.y / TILE);
      const tile = this.map[ty]?.[tx] ?? 2;
      if (tile === 1) {
        this.map[ty][tx] = 0;
        this.playHit();
        continue;
      }
      if (tile === 2) {
        if (b.owner === "player" && b.power >= 3) this.map[ty][tx] = 0;
        this.playHit();
        continue;
      }
      if (tile === 4) continue;

      if (b.owner === "player") {
        for (const e of this.enemies) {
          if (hit(br, { x: e.x, y: e.y, w: 20, h: 20 })) {
            e.hp -= 1;
            if (e.hp <= 0) {
              this.maybeDropPowerUp(e.x + 10, e.y + 10);
              this.enemies = this.enemies.filter((x) => x !== e);
              this.killed += 1;
              this.score += 100;
              this.playExplosion();
              this.updateStatus();
            } else {
              this.playHit();
            }
            continue bulletLoop;
          }
        }
      } else if (hit(br, { x: this.player.x, y: this.player.y, w: 20, h: 20 })) {
        this.damagePlayer();
        this.updateStatus();
        continue;
      }
      next.push(b);
    }
    this.bullets = next;
  }

  private maybeDropPowerUp(x: number, y: number): void {
    if (this.killed % 5 !== 4) return;
    const px = Math.max(TILE + 2, Math.min(W - TILE * 2, x - 10));
    const py = Math.max(TILE + 2, Math.min(H - TILE * 3, y - 10));
    this.powerUps = [{ x: px, y: py, kind: this.pickPowerUp(), ttl: 780, pulse: 0 }];
  }

  private pickPowerUp(): PowerUpKind {
    const bag: PowerUpKind[] = this.playerPower < MAX_TANK_POWER ? ["star", "star"] : [];
    bag.push("shovel", "helmet", "grenade", "clock");
    return bag[Math.floor(Math.random() * bag.length)];
  }

  private tickPowerUps(): void {
    this.powerUps = this.powerUps
      .map((p) => ({ ...p, ttl: p.ttl - 1, pulse: p.pulse + 0.18 }))
      .filter((p) => p.ttl > 0);
  }

  private collectPowerUps(): void {
    const playerRect = { x: this.player.x, y: this.player.y, w: 20, h: 20 };
    const rest: PowerUp[] = [];
    for (const p of this.powerUps) {
      if (hit(playerRect, { x: p.x, y: p.y, w: 20, h: 20 })) {
        this.applyPowerUp(p.kind);
        this.playPowerUp();
        this.updateStatus();
      } else {
        rest.push(p);
      }
    }
    this.powerUps = rest;
  }

  private applyPowerUp(kind: PowerUpKind): void {
    if (kind === "star") {
      if (this.playerPower < MAX_TANK_POWER) this.playerPower += 1;
      this.player.speed = 2.2 + this.playerPower * 0.18;
      this.player.hp = Math.max(this.player.hp, this.playerMaxHp());
      this.score += this.playerPower >= MAX_TANK_POWER ? 1000 : 300;
    } else if (kind === "shovel") {
      this.protectBase();
      this.score += 500;
    } else if (kind === "helmet") {
      this.invulnerableTimer = SECOND * 10;
      this.score += 500;
    } else if (kind === "grenade") {
      this.blastEnemies();
      this.score += 500;
    } else {
      this.freezeTimer = SECOND * 5;
      this.score += 500;
    }
  }

  private playerMaxHp(): number {
    if (this.playerPower >= 3) return 3;
    if (this.playerPower >= 2) return 2;
    return 1;
  }

  private damagePlayer(): void {
    if (this.invulnerableTimer > 0) {
      this.playHit();
      return;
    }

    this.player.hp -= 1;
    if (this.player.hp > 0) {
      this.invulnerableTimer = SECOND * 2;
      this.playHit();
      return;
    }

    this.lives -= 1;
    if (this.lives <= 0) this.gameOver(false);
    else {
      this.playerPower = 0;
      this.invulnerableTimer = SECOND * 2;
      this.player = this.makePlayer();
      this.playExplosion();
    }
  }

  private blastEnemies(): void {
    if (this.enemies.length === 0) return;
    this.killed += this.enemies.length;
    this.score += this.enemies.length * 100;
    this.enemies = [];
    this.playExplosion();
  }

  private protectBase(): void {
    for (const [x, y] of this.baseArmorTiles()) this.map[y][x] = 2;
    this.baseArmorTimer = SECOND * 12;
  }

  private tickBaseArmor(): void {
    if (this.baseArmorTimer <= 0) return;
    this.baseArmorTimer -= 1;
    if (this.baseArmorTimer > 0) return;
    for (const [x, y] of this.baseArmorTiles()) {
      if (this.map[y]?.[x] === 2) this.map[y][x] = 1;
    }
  }

  private baseArmorTiles(): Array<[number, number]> {
    const bx = Math.floor(COLS / 2);
    const by = ROWS - 2;
    return [
      [bx - 1, by],
      [bx + 1, by],
      [bx - 1, by - 1],
      [bx, by - 1],
      [bx + 1, by - 1],
    ];
  }

  private gameOver(won: boolean): void {
    this.over = true;
    this.won = won;
    this.stopMusic();
    this.playGameOver(won);
    this.finish(this.score);
    this.updateStatus();
  }

  private finish(value: number): void {
    if (this.reported) return;
    this.reported = true;
    this.onGameOver?.(value);
  }

  private updateStatus(): void {
    const left = Math.max(0, ENEMIES_PER_LEVEL - this.killed);
    if (this.over && !this.won) this.statusEl.textContent = this.baseAlive ? `Штаб потерян · очки: ${this.score}` : `База разрушена · очки: ${this.score}`;
    else if (this.won) this.statusEl.textContent = `35 уровней пройдены · очки: ${this.score}`;
    else {
      const effects = this.activeEffectsText();
      this.statusEl.textContent = `${this.themeName()} · уровень ${this.level}/${MAX_LEVEL} · танк ★${this.playerPower}/${MAX_TANK_POWER} · броня ${this.player.hp}/${this.playerMaxHp()} · осталось ${left} · жизни ${this.lives} · очки ${this.score}${effects}`;
    }
  }

  private activeEffectsText(): string {
    const effects: string[] = [];
    if (this.invulnerableTimer > 0) effects.push(`щит ${Math.ceil(this.invulnerableTimer / SECOND)}с`);
    if (this.freezeTimer > 0) effects.push(`стоп ${Math.ceil(this.freezeTimer / SECOND)}с`);
    if (this.baseArmorTimer > 0) effects.push(`база ${Math.ceil(this.baseArmorTimer / SECOND)}с`);
    return effects.length ? ` · ${effects.join(" · ")}` : "";
  }

  private currentTheme(): MapTheme {
    return MAP_THEMES[(this.level - 1) % MAP_THEMES.length];
  }

  private themeName(theme = this.currentTheme()): string {
    if (theme === "lanes") return "Коридоры";
    if (theme === "fortress") return "Крепость";
    if (theme === "islands") return "Острова";
    if (theme === "marsh") return "Болото";
    return "Каналы";
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.themeBackground();
    ctx.fillRect(0, 0, W, H);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) this.drawTile(x, y, this.map[y][x]);
    }
    this.drawBase();
    this.drawTank(this.player, this.playerBodyColor(), this.playerTrackColor(), true);
    if (this.invulnerableTimer > 0) this.drawShield();
    for (const e of this.enemies) {
      const colors = this.enemyColors(e);
      this.drawTank(e, colors.body, colors.track);
    }
    for (const p of this.powerUps) this.drawPowerUp(p);
    for (const b of this.bullets) {
      ctx.fillStyle = b.owner === "player" ? "#fff3b0" : "#ff8a7a";
      ctx.fillRect(b.x - 3, b.y - 3, 6, 6);
    }

    if (this.over || this.won) {
      ctx.fillStyle = "rgba(0,0,0,.68)";
      ctx.fillRect(42, H / 2 - 48, W - 84, 96);
      ctx.strokeStyle = "#7ac07a";
      ctx.strokeRect(42.5, H / 2 - 47.5, W - 85, 95);
      ctx.fillStyle = "#f4f1e8";
      ctx.font = "bold 22px Trebuchet MS";
      ctx.textAlign = "center";
      ctx.fillText(this.won ? "ПОБЕДА" : "GAME OVER", W / 2, H / 2 - 8);
      ctx.font = "14px Trebuchet MS";
      ctx.fillText("Enter или кнопка ниже — заново", W / 2, H / 2 + 22);
    }
  }

  private drawTile(x: number, y: number, kind: TileKind): void {
    if (kind === 0) return;
    const ctx = this.ctx;
    const px = x * TILE;
    const py = y * TILE;
    const theme = this.currentTheme();
    if (kind === 1) {
      ctx.fillStyle = theme === "fortress" ? "#7d4d42" : theme === "marsh" ? "#6f5d32" : "#9b4d33";
      ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
      ctx.strokeStyle = theme === "marsh" ? "#403720" : "#5d2f24";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 1, py + 8);
      ctx.lineTo(px + TILE - 1, py + 8);
      ctx.moveTo(px + 1, py + 16);
      ctx.lineTo(px + TILE - 1, py + 16);
      ctx.moveTo(px + 12, py + 1);
      ctx.lineTo(px + 12, py + 8);
      ctx.moveTo(px + 6, py + 8);
      ctx.lineTo(px + 6, py + 16);
      ctx.moveTo(px + 18, py + 16);
      ctx.lineTo(px + 18, py + TILE - 1);
      ctx.stroke();
    } else if (kind === 2) {
      ctx.fillStyle = theme === "fortress" ? "#81878c" : "#6c7780";
      ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
      ctx.fillStyle = "#93a0aa";
      ctx.fillRect(px + 4, py + 4, TILE - 8, 4);
    } else if (kind === 3) {
      ctx.fillStyle = theme === "marsh" ? "#253f2a" : "#283c35";
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = "#4e775e";
      ctx.fillRect(px + 4, py + 3, 6, 18);
      ctx.fillRect(px + 13, py + 2, 5, 19);
    } else {
      ctx.fillStyle = theme === "canals" ? "#153f66" : "#1c4151";
      ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
      ctx.strokeStyle = "#3c7388";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 4, py + 8);
      ctx.quadraticCurveTo(px + 9, py + 4, px + 14, py + 8);
      ctx.quadraticCurveTo(px + 19, py + 12, px + 23, py + 8);
      ctx.moveTo(px + 1, py + 16);
      ctx.quadraticCurveTo(px + 7, py + 12, px + 13, py + 16);
      ctx.quadraticCurveTo(px + 18, py + 20, px + 23, py + 16);
      ctx.stroke();
    }
  }

  private themeBackground(): string {
    const theme = this.currentTheme();
    if (theme === "fortress") return "#121116";
    if (theme === "islands") return "#111a18";
    if (theme === "marsh") return "#10180f";
    if (theme === "canals") return "#081622";
    return "#101418";
  }

  private tileUnderTank(t: Tank): TileKind {
    const x = Math.floor((t.x + 10) / TILE);
    const y = Math.floor((t.y + 10) / TILE);
    return this.map[y]?.[x] ?? 2;
  }

  private drawTank(t: Tank, body: string, track: string, player = false): void {
    const ctx = this.ctx;
    const power = player ? this.playerPower : 0;
    ctx.save();
    ctx.translate(t.x + 10, t.y + 10);
    ctx.rotate(dirAngle(t.dir));
    ctx.fillStyle = track;
    ctx.fillRect(-10, -10, power >= 2 ? 7 : 6, 20);
    ctx.fillRect(power >= 2 ? 3 : 4, -10, power >= 2 ? 7 : 6, 20);
    if (power >= 2) {
      ctx.fillStyle = "#2c3435";
      for (let y = -8; y <= 8; y += 4) {
        ctx.fillRect(-9, y, 5, 2);
        ctx.fillRect(4, y, 5, 2);
      }
    }
    ctx.fillStyle = body;
    ctx.fillRect(power >= 3 ? -8 : -7, power >= 1 ? -9 : -8, power >= 3 ? 16 : 14, power >= 1 ? 18 : 16);
    if (power >= 1) {
      ctx.fillStyle = "#fff0a3";
      ctx.fillRect(-6, -8, 12, 3);
      ctx.fillStyle = "#b98a23";
      ctx.fillRect(-4, 4, 8, 3);
    }
    if (power >= 2) {
      ctx.fillStyle = "#c7ccd1";
      ctx.fillRect(-11, -6, 4, 12);
      ctx.fillRect(7, -6, 4, 12);
      ctx.fillStyle = "#eff3f5";
      ctx.fillRect(-6, -11, 12, 4);
    }
    if (power >= 3) {
      ctx.fillStyle = "#f4f1e8";
      ctx.fillRect(-7, -16, 14, 5);
      ctx.fillStyle = "#9aa5ad";
      ctx.fillRect(-9, 7, 18, 4);
      ctx.fillStyle = "#d44f43";
      ctx.fillRect(-3, 3, 6, 4);
    }
    ctx.fillStyle = "#1a1f22";
    ctx.fillRect(-3, power >= 3 ? -20 : power >= 1 ? -15 : -12, 6, power >= 3 ? 22 : power >= 1 ? 17 : 14);
    ctx.fillStyle = "#f4f1e8";
    ctx.fillRect(power >= 2 ? -4 : -3, -3, power >= 2 ? 8 : 6, 6);
    if (power >= 3) {
      ctx.fillStyle = "#7bd8ff";
      ctx.fillRect(-2, -1, 4, 3);
    }
    ctx.restore();
  }

  private playerBodyColor(): string {
    if (this.playerPower >= 3) return "#f1c232";
    if (this.playerPower >= 2) return "#e0b33f";
    if (this.playerPower >= 1) return "#f0c84f";
    return "#f3d35a";
  }

  private playerTrackColor(): string {
    if (this.playerPower >= 3) return "#5a4c28";
    if (this.playerPower >= 2) return "#6d5b2b";
    return "#8f6f1e";
  }

  private enemyColors(t: Tank): { body: string; track: string } {
    if (t.kind === "fast") return { body: "#5fb0d6", track: "#173241" };
    if (t.kind === "armored") return { body: "#d96b47", track: "#5a2d25" };
    return { body: t.hp > 1 ? "#c89345" : "#7fb35f", track: "#273322" };
  }

  private drawShield(): void {
    const ctx = this.ctx;
    const blink = Math.floor(this.invulnerableTimer / 8) % 2 === 0;
    if (!blink && this.invulnerableTimer < SECOND * 2) return;
    ctx.save();
    ctx.strokeStyle = this.invulnerableTimer < SECOND * 2 ? "#ffffff" : "#7bd8ff";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55 + Math.sin(this.invulnerableTimer * 0.18) * 0.25;
    ctx.beginPath();
    ctx.arc(this.player.x + 10, this.player.y + 10, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawPowerUp(p: PowerUp): void {
    const ctx = this.ctx;
    const cx = p.x + 10;
    const cy = p.y + 10;
    const r = 8 + Math.sin(p.pulse) * 1.2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.pulse * 0.35);
    const blink = p.ttl < 150 && Math.floor(p.ttl / 10) % 2 === 0;
    ctx.fillStyle = blink ? "#fff4b8" : this.powerUpColor(p.kind);
    ctx.strokeStyle = "#1a1f22";
    ctx.lineWidth = 2;
    if (p.kind === "star") this.drawStarIcon(r);
    else if (p.kind === "shovel") this.drawShovelIcon();
    else if (p.kind === "helmet") this.drawHelmetIcon();
    else if (p.kind === "grenade") this.drawGrenadeIcon();
    else this.drawClockIcon();
    ctx.restore();
  }

  private powerUpColor(kind: PowerUpKind): string {
    if (kind === "shovel") return "#bfc7ca";
    if (kind === "helmet") return "#7bd8ff";
    if (kind === "grenade") return "#e35a43";
    if (kind === "clock") return "#f4f1e8";
    return "#f6d34f";
  }

  private drawStarIcon(r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 === 0 ? r : r * 0.43;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawShovelIcon(): void {
    const ctx = this.ctx;
    ctx.fillRect(-3, -8, 6, 16);
    ctx.fillRect(-7, 4, 14, 7);
    ctx.strokeRect(-7.5, 3.5, 15, 8);
  }

  private drawHelmetIcon(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(0, 1, 9, Math.PI, 0);
    ctx.lineTo(9, 7);
    ctx.lineTo(-9, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawGrenadeIcon(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(0, 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1a1f22";
    ctx.fillRect(-3, -10, 6, 4);
  }

  private drawClockIcon(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#1a1f22";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -6);
    ctx.moveTo(0, 0);
    ctx.lineTo(5, 3);
    ctx.stroke();
  }

  private drawBase(): void {
    const ctx = this.ctx;
    const b = this.baseRect();
    ctx.fillStyle = this.baseAlive ? "#d8d0b0" : "#5d2f24";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = this.baseAlive ? "#755b2c" : "#2a1511";
    ctx.beginPath();
    ctx.moveTo(b.x + b.w / 2, b.y + 6);
    ctx.lineTo(b.x + b.w - 6, b.y + b.h - 7);
    ctx.lineTo(b.x + b.w / 2, b.y + b.h - 13);
    ctx.lineTo(b.x + 6, b.y + b.h - 7);
    ctx.closePath();
    ctx.fill();
  }

  private baseRect(): { x: number; y: number; w: number; h: number } {
    return { x: Math.floor(COLS / 2) * TILE + 2, y: (ROWS - 2) * TILE + 2, w: TILE - 4, h: TILE - 4 };
  }

  private startAudio(): void {
    if (!this.audio) {
      const Ctx = (window.AudioContext || (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined;
      if (!Ctx) return;
      this.audio = new Ctx();
      this.master = this.audio.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.audio.destination);
    }
    void this.audio.resume();
  }

  private startMusic(): void {
    this.startAudio();
    if (this.musicTimer || !this.audio) return;
    this.musicTimer = window.setInterval(() => this.playMusicTick(), 145);
  }

  private stopMusic(): void {
    if (!this.musicTimer) return;
    window.clearInterval(this.musicTimer);
    this.musicTimer = 0;
  }

  private playMusicTick(): void {
    if (!this.audio || !this.master || this.over || this.won || this.audio.state !== "running") return;
    const bass = [55, 55, 82, 55, 73, 55, 98, 55];
    const lead = [220, 0, 247, 0, 196, 0, 165, 0, 147, 0, 165, 0, 196, 0, 247, 0];
    const step = this.musicStep++;
    this.tone(bass[step % bass.length], 0.09, "square", 0.045, 0.008);
    if (step % 2 === 0) this.noise(0.025, 0.018, 900, 0.006);
    const note = lead[step % lead.length];
    if (note) this.tone(note, 0.045, "square", 0.022, 0.004);
  }

  private playShoot(playerShot: boolean): void {
    if (playerShot) this.playSound(this.shootSound);
    else this.tone(170, 0.055, "square", 0.045, 0.006, -50);
  }

  private playHit(): void {
    this.noise(0.055, 0.07, 650, 0.004);
    this.tone(110, 0.035, "sawtooth", 0.045, 0.004, -40);
  }

  private playExplosion(): void {
    this.playSound(this.explosionSound);
  }

  private playPowerUp(): void {
    for (const [i, freq] of [330, 440, 660, 880].entries()) {
      window.setTimeout(() => this.tone(freq, 0.06, "square", 0.08, 0.004), i * 45);
    }
  }

  private playGameOver(won: boolean): void {
    const notes = won ? [392, 494, 587, 784] : [220, 196, 165, 110];
    for (const [i, freq] of notes.entries()) {
      window.setTimeout(() => this.tone(freq, 0.14, "square", 0.08, 0.01), i * 90);
    }
  }

  private makeSound(fileName: string, volume: number, loop = false): HTMLAudioElement {
    const sound = new Audio(publicPath(`assets/bulbatanks/${fileName}`));
    sound.preload = "auto";
    sound.volume = volume;
    sound.loop = loop;
    return sound;
  }

  private playSound(sound: HTMLAudioElement): void {
    const clone = sound.cloneNode(true) as HTMLAudioElement;
    clone.volume = sound.volume;
    clone.currentTime = 0;
    void clone.play().catch(() => {});
  }

  private tone(freq: number, duration: number, type: OscillatorType, volume: number, attack = 0.006, slide = 0): void {
    if (!this.audio || !this.master) return;
    const now = this.audio.currentTime;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noise(duration: number, volume: number, filterFreq: number, attack = 0.004): void {
    if (!this.audio || !this.master) return;
    const bufferSize = Math.max(1, Math.floor(this.audio.sampleRate * duration));
    const buffer = this.audio.createBuffer(1, bufferSize, this.audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const now = this.audio.currentTime;
    const src = this.audio.createBufferSource();
    const filter = this.audio.createBiquadFilter();
    const gain = this.audio.createGain();
    src.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.02);
  }
}

function hit(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function dirAngle(dir: Dir): number {
  if (dir === "right") return Math.PI / 2;
  if (dir === "down") return Math.PI;
  if (dir === "left") return -Math.PI / 2;
  return 0;
}

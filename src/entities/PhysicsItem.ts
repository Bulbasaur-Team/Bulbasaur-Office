import Phaser from "phaser";
import { ITEM_TYPES, type ItemTypeDef, type PlacedItemDef } from "../data/items";

const STOP_SPEED = 12;        // ниже этой скорости мяч считаем остановившимся
const HOP_GRAVITY = 900;      // «вертикальная» гравитация прыжка, px/с²
const HOP_BOUNCE = 0.5;       // сколько вертикальной скорости остаётся при ударе о землю
const HOP_MIN_VZ = 120;       // слабее этого — прыжок гасится совсем
const NET_LERP = 0.25;        // доля пути к сетевой цели за кадр (сглаживание у не-владельца)
const NET_SNAP_DIST = 400;    // дальше этого не тянем, а телепортируем (смена владельца и т.п.)

// Физичный предмет мира (мяч и т.п.): круглое аркадное тело плюс отдельный
// визуальный спрайт с тенью — так «прыжок» (виртуальная ось z) смещает картинку,
// не трогая физику на плоскости. Владелец (последний ударивший) — источник правды
// в мультиплеере, остальные мягко тянут предмет к его репортам.
export class PhysicsItem {
  readonly id: string;
  readonly type: ItemTypeDef;
  readonly base: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  private sprite: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Ellipse;

  private z = 0;  // высота над землёй
  private vz = 0; // вертикальная скорость

  // Высота полёта: пока мяч выше досягаемости персонажа, бить по нему нельзя.
  get height(): number {
    return this.z;
  }

  // Цель сетевой коррекции (не-владелец); null — коррекция не нужна.
  private netX: number | null = null;
  private netY: number | null = null;

  ownedByMe = false;      // мой удар был последним — я стримлю позицию остальным
  lastKickId = "";        // id моего последнего удара: чтобы отличить своё эхо от чужого удара
  kickCooldownUntil = 0;  // защита от повторного удара каждый кадр
  wasMoving = false;      // для финальной синхронизации позиции после остановки

  constructor(scene: Phaser.Scene, def: PlacedItemDef) {
    this.id = def.id;
    this.type = ITEM_TYPES[def.type];

    const texW = scene.textures.get(this.type.texture).getSourceImage().width;
    const scale = (this.type.radius * 2) / texW;

    // Невидимое тело: физика живёт на плоскости, картинка рисуется со смещением по z.
    this.base = scene.physics.add.image(def.x, def.y, this.type.texture)
      .setVisible(false)
      .setScale(scale);
    this.base.body.setCircle(texW / 2);
    this.base.setBounce(this.type.bounce);
    this.base.setDamping(true);
    this.base.setDrag(this.type.drag);
    this.base.setCollideWorldBounds(true);

    this.shadow = scene.add.ellipse(
      def.x, def.y + this.type.radius * 0.7,
      this.type.radius * 1.8, this.type.radius * 0.8,
      0x000000, 0.3,
    );
    this.sprite = scene.add.image(def.x, def.y, this.type.texture).setScale(scale);
  }

  // Удар: скорость по направлению (dirX, dirY), часть силы уходит в прыжок.
  kick(dirX: number, dirY: number, force: number): void {
    this.base.setVelocity(dirX * force, dirY * force);
    this.vz = force * this.type.hopFactor;
    if (this.z <= 0) this.z = 0.01;
  }

  // Чужой принятый удар: позицию берём точно (владелец сменился), дальше симулируем сами.
  applyRemoteKick(x: number, y: number, vx: number, vy: number): void {
    this.ownedByMe = false;
    this.netX = null;
    this.netY = null;
    this.base.setPosition(x, y);
    const speed = Math.hypot(vx, vy);
    this.base.setVelocity(vx, vy);
    this.vz = speed * this.type.hopFactor;
    if (this.z <= 0) this.z = 0.01;
  }

  // Репорт позиции от владельца: скорость применяем сразу, позицию тянем плавно.
  applyRemoteMove(x: number, y: number, vx: number, vy: number): void {
    this.ownedByMe = false;
    this.base.setVelocity(vx, vy);
    if (Math.hypot(x - this.base.x, y - this.base.y) > NET_SNAP_DIST) {
      this.base.setPosition(x, y);
      this.netX = null;
      this.netY = null;
    } else {
      this.netX = x;
      this.netY = y;
    }
  }

  // Полное состояние из снапшота (вход в комнату).
  applyState(x: number, y: number, vx: number, vy: number): void {
    this.ownedByMe = false;
    this.netX = null;
    this.netY = null;
    this.base.setPosition(x, y);
    this.base.setVelocity(vx, vy);
  }

  // Упругий отскок от прямоугольника (стены из collision-слоя карты). Вручную,
  // а не через аркадный коллайдер: коллайдер не выталкивает неподвижный мяч,
  // вдавленный в стену (например, зажатый игроками), — мяч застревал бы в ней.
  bounceOffRect(left: number, top: number, right: number, bottom: number): void {
    const r = this.type.radius;
    const cx = Phaser.Math.Clamp(this.base.x, left, right);
    const cy = Phaser.Math.Clamp(this.base.y, top, bottom);
    const dx = this.base.x - cx;
    const dy = this.base.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist >= r) return;

    let nx: number;
    let ny: number;
    if (dist > 0) {
      nx = dx / dist;
      ny = dy / dist;
      this.base.setPosition(cx + nx * r, cy + ny * r);
    } else {
      // Центр внутри прямоугольника: выталкиваем через ближайшую грань.
      const toLeft = this.base.x - left;
      const toRight = right - this.base.x;
      const toTop = this.base.y - top;
      const toBottom = bottom - this.base.y;
      const min = Math.min(toLeft, toRight, toTop, toBottom);
      if (min === toLeft) { nx = -1; ny = 0; this.base.x = left - r; }
      else if (min === toRight) { nx = 1; ny = 0; this.base.x = right + r; }
      else if (min === toTop) { nx = 0; ny = -1; this.base.y = top - r; }
      else { nx = 0; ny = 1; this.base.y = bottom + r; }
    }

    const v = this.base.body.velocity;
    const dot = v.x * nx + v.y * ny;
    if (dot < 0) {
      v.x -= 2 * dot * nx;
      v.y -= 2 * dot * ny;
      v.scale(this.type.bounce);
    }
  }

  // Упругий отскок от круга (игрок, NPC). true — было касание.
  bounceOffCircle(cx: number, cy: number, cr: number): boolean {
    const dx = this.base.x - cx;
    const dy = this.base.y - cy;
    const dist = Math.hypot(dx, dy);
    const minDist = cr + this.type.radius;
    if (dist >= minDist || dist === 0) return false;

    const nx = dx / dist;
    const ny = dy / dist;
    this.base.setPosition(cx + nx * minDist, cy + ny * minDist);
    const v = this.base.body.velocity;
    const dot = v.x * nx + v.y * ny;
    if (dot < 0) {
      v.x -= 2 * dot * nx;
      v.y -= 2 * dot * ny;
      v.scale(this.type.bounce);
    }
    return true;
  }

  isMoving(): boolean {
    return this.base.body.velocity.length() > STOP_SPEED || this.netX !== null;
  }

  update(delta: number): void {
    const dt = delta / 1000;

    if (this.base.body.velocity.length() < STOP_SPEED && this.netX === null) {
      this.base.setVelocity(0, 0);
    }

    // Сетевое подтягивание к позиции владельца.
    if (this.netX !== null && this.netY !== null) {
      this.base.x += (this.netX - this.base.x) * NET_LERP;
      this.base.y += (this.netY - this.base.y) * NET_LERP;
      if (Math.hypot(this.netX - this.base.x, this.netY - this.base.y) < 2) {
        this.netX = null;
        this.netY = null;
      }
    }

    // Прыжок по виртуальной оси z.
    if (this.z > 0 || this.vz !== 0) {
      this.vz -= HOP_GRAVITY * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        this.vz = -this.vz > HOP_MIN_VZ / HOP_BOUNCE ? -this.vz * HOP_BOUNCE : 0;
      }
    }

    // Вращение при качении — чисто визуальное.
    const v = this.base.body.velocity;
    if (v.length() > STOP_SPEED) {
      this.sprite.rotation += (v.x >= 0 ? 1 : -1) * v.length() * dt * 0.02;
    }

    this.sprite.setPosition(this.base.x, this.base.y - this.z);
    this.sprite.setDepth(this.base.y);
    const squash = Math.max(0.55, 1 - this.z / 180);
    this.shadow.setPosition(this.base.x, this.base.y + this.type.radius * 0.7);
    this.shadow.setScale(squash);
    this.shadow.setAlpha(0.3 * squash);
    this.shadow.setDepth(this.base.y - 1);
  }

  destroy(): void {
    this.base.destroy();
    this.sprite.destroy();
    this.shadow.destroy();
  }
}

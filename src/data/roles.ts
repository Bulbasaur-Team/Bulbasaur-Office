import type { SpriteKey } from "../entities/sprites";

// Роли мультиплеера. id совпадает с именем enum Role на бэке (шлётся в join).
export type Role =
  | "DEV"
  | "DEV_FE"
  | "QA"
  | "LEAD"
  | "ANALYSIS"
  | "DESIGN"
  | "PRODUCT_OWNER";

export interface RoleDef {
  id: Role;
  label: string;
  sprite: SpriteKey;
}

export const ROLES: RoleDef[] = [
  { id: "DEV", label: "Бэкендер", sprite: "dev" },
  { id: "DEV_FE", label: "Фронтендер", sprite: "dev-fe" },
  { id: "QA", label: "Тестировщик", sprite: "qa" },
  { id: "LEAD", label: "Тимлид", sprite: "lead" },
  { id: "ANALYSIS", label: "Аналитик", sprite: "analyst" },
  { id: "DESIGN", label: "Дизайнер", sprite: "designer" },
  { id: "PRODUCT_OWNER", label: "Продакт-оунер", sprite: "owner" },
];

const BY_ID = new Map(ROLES.map((r) => [r.id as string, r]));

// Скин по имени роли (строка приходит с сервера); неизвестная роль — дефолтный dev.
export function spriteForRole(role: string): SpriteKey {
  return BY_ID.get(role)?.sprite ?? "dev";
}

import { defaultAppearance, type PlayerAppearance, wardrobeItem } from "./wardrobe";

export type WardrobeCommentKind =
  | "hoodie"
  | "non_la"
  | "wdm_cap"
  | "beach_shorts"
  | "bold"
  | "modest";

/** Приоритет: первое совпадение побеждает. */
export function dayXWardrobeComment(appearance: PlayerAppearance): WardrobeCommentKind {
  const def = defaultAppearance();
  if (!appearance.top && !appearance.bottom) return "bold";
  if (appearance.bottom === "bottom_beach_shorts") return "beach_shorts";
  if (appearance.hat === "hat_non_la") return "non_la";
  if (appearance.hat?.startsWith("hat_wdm_")) return "wdm_cap";
  const topItem = appearance.top ? wardrobeItem(appearance.top) : null;
  if (topItem?.colorGroup === "hoodie" && appearance.top !== def.top) return "hoodie";
  return "modest";
}

import type { PhoneContactId } from "./phoneContacts";

/**
 * Профили «бормотания» в духе Graveyard Keeper: без языка, только высота и темп.
 * pitch 1 ≈ средний мужской. Бульбов и водитель — самые низкие. Женские голоса выше 1.25.
 * Начальники говорят размеренно; HR и бухгалтер — быстрее.
 */
export type VoiceId =
  | PhoneContactId
  | "beach"
  | "npc-male"
  | "npc-female"
  | "nikita"
  | "artur"
  | "fedya"
  | "sodnom"
  | "dima"
  | "timur"
  | "anya"
  | "egor"
  | "kirill"
  | "yuri";

export type VoiceKind = "speech" | "meow";

export interface VoiceProfile {
  kind: VoiceKind;
  /** Базовая высота. */
  pitch: number;
  /** Пауза между слогами, мс. Меньше — быстрее. */
  intervalMs: number;
  /** Длительность слога, мс. */
  durMs: number;
}

const BOSS_MS = 128;
const FAST_MS = 72;

export const VOICES: Record<VoiceId, VoiceProfile> = {
  bulbov: { kind: "speech", pitch: 0.72, intervalMs: 135, durMs: 200 },
  bulbikov: { kind: "speech", pitch: 0.82, intervalMs: BOSS_MS, durMs: 185 },
  bulbatech: { kind: "speech", pitch: 0.88, intervalMs: 130, durMs: 188 },
  driver: { kind: "speech", pitch: 0.74, intervalMs: 110, durMs: 168 },
  claude: { kind: "speech", pitch: 0.86, intervalMs: 118, durMs: 172 },
  cursor: { kind: "speech", pitch: 0.9, intervalMs: 112, durMs: 165 },
  beach: { kind: "speech", pitch: 0.98, intervalMs: 92, durMs: 145 },
  "npc-male": { kind: "speech", pitch: 0.93, intervalMs: 102, durMs: 155 },
  nikita: { kind: "speech", pitch: 0.91, intervalMs: 100, durMs: 152 },
  artur: { kind: "speech", pitch: 0.95, intervalMs: 94, durMs: 148 },
  fedya: { kind: "speech", pitch: 0.88, intervalMs: 108, durMs: 162 },
  sodnom: { kind: "speech", pitch: 0.92, intervalMs: 92, durMs: 145 },
  dima: { kind: "speech", pitch: 0.97, intervalMs: 88, durMs: 140 },
  timur: { kind: "speech", pitch: 0.9, intervalMs: 102, durMs: 154 },
  egor: { kind: "speech", pitch: 0.85, intervalMs: 120, durMs: 178 },
  kirill: { kind: "speech", pitch: 0.87, intervalMs: 114, durMs: 170 },
  yuri: { kind: "speech", pitch: 0.93, intervalMs: 104, durMs: 158 },
  bulbul: { kind: "speech", pitch: 1.28, intervalMs: 122, durMs: 180 },
  hr: { kind: "speech", pitch: 1.78, intervalMs: FAST_MS, durMs: 118 },
  accountant: { kind: "speech", pitch: 1.33, intervalMs: 76, durMs: 122 },
  anya: { kind: "speech", pitch: 1.36, intervalMs: 84, durMs: 130 },
  "npc-female": { kind: "speech", pitch: 1.35, intervalMs: 84, durMs: 130 },
  cat: { kind: "meow", pitch: 1.15, intervalMs: 240, durMs: 280 },
};

export function speechBank(pitch: number): "male" | "female" {
  return pitch >= 1.2 ? "female" : "male";
}

/** Скорость проигрывания сэмпла: женский банк уже высокий, поэтому делим pitch. */
export function speechRate(pitch: number): number {
  if (pitch >= 1.2) return pitch / 1.45;
  return pitch;
}

export function voiceForNpc(characterId: string): VoiceId {
  if (characterId in VOICES) return characterId as VoiceId;
  return "npc-male";
}

/** Голос игрока в зале Дня X: низкий, но не как у Бульбова. */
export function dayXPlayerVoice(characterId: string): VoiceId {
  if (characterId === "__me__") return "fedya";
  const v = voiceForNpc(characterId);
  return VOICES[v].pitch <= 0.9 ? v : "fedya";
}

// Реакции мультиплеера. code совпадает с именем enum Emote на бэке (шлётся в emote).
export interface EmoteDef {
  code: string;
  emoji: string;
  title: string;
}

export const EMOTES: EmoteDef[] = [
  { code: "WAVE", emoji: "👋", title: "Привет" },
  { code: "PARTY", emoji: "🎉", title: "Ура" },
  { code: "LIKE", emoji: "👍", title: "Класс" },
  { code: "LAUGH", emoji: "😂", title: "Смех" },
  { code: "HEART", emoji: "❤️", title: "Любовь" },
  { code: "QUESTION", emoji: "❓", title: "Вопрос" },
];

const BY_CODE = new Map(EMOTES.map((e) => [e.code, e.emoji]));

// Эмодзи по коду реакции (строка приходит с сервера); неизвестный код игнорируется.
export function emojiForEmote(code: string): string | null {
  return BY_CODE.get(code) ?? null;
}

/** Бульба Кот — общий NPC только в мультиплеере, локация main-office. */

export const BULBA_CAT = {
  id: "bulba-cat",
  name: "Бульба Кот",
  locationId: "main-office",
  /** Экранная высота ≈ чуть больше половины игрока (TARGET_H = 74). */
  targetH: 53,
  /** Стоя / шаг — чередуем только при движении. */
  textures: ["bulba-cat", "bulba-cat-walk"] as const,
  walkFrameMs: 130,
  question: "Мяу?",
  /** Русский ответ на «Мяу?» — в облачке сначала мяуканье, перевод по кнопке. */
  answerRu: "Я понимаю по-русски, можешь не мяукать.",
  adviceLabel: "Дай совет",
} as const;

/**
 * Подменяет любой «смысловой» кусок (слова, ники, числа) на «мяу»/«Мяу».
 * В результате — только мяу, пробелы и исходные знаки препинания (без цифр и ников).
 */
export function meowify(text: string): string {
  // Всё, что не пробел и не пунктуация — токен (слово/число/ник).
  return text.replace(/[^\s.,!?;:—\-–—…«»()[\]"'`]+/gu, (token, offset) => {
    const chunks = Math.max(1, Math.round(token.length / 3));
    const prefix = text.slice(0, offset).replace(/\s+$/u, "");
    const sentenceStart =
      offset === 0 || prefix.length === 0 || /[.!?…]$/u.test(prefix);
    const word = sentenceStart ? "Мяу" : "мяу";
    return Array.from({ length: chunks }, (_, i) => (i === 0 ? word : "мяу")).join(" ");
  });
}

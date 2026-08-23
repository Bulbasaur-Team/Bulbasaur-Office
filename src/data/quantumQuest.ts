/** Квест «Квантовая физика» — звонок техлида и сюжетный тест в Bulba Quiz. */

export const QUANTUM_QUEST = {
  code: "quantum",
  topicCode: "quantum",
  passMin: 9,
  timings: {
    introDelayMs: 8_000,
    declineRetryMs: 5 * 60_000,
    finaleDelayMs: 4_000,
  },
  caller: {
    name: "Бульба С.В.",
    photo: "assets/ui/bulbatalk/boss-4.png",
  },
} as const;

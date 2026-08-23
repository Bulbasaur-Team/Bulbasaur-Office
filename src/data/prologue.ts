/** Пролог и второй звонок HR (адаптация). */

export const PROLOGUE_QUEST = {
  code: "prologue",
  timings: {
    introDelayMs: 5_000,
    declineRetryMs: 5 * 60_000,
    lineHoldMs: 3_000,
  },
  caller: {
    name: "Бульбокадрова И.В.",
    photo: "assets/ui/bulbatalk/avatar-hr.png",
  },
} as const;

export const ADAPTATION_QUEST = {
  code: "adaptation",
  timings: {
    introDelayMs: 4_000,
    declineRetryMs: 5 * 60_000,
    lineHoldMs: 3_000,
  },
  caller: {
    name: "Бульбокадрова И.В.",
    photo: "assets/ui/bulbatalk/avatar-hr.png",
  },
} as const;

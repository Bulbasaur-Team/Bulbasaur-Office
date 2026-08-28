/** Квест «Сверка» — входящий бухгалтера после стратегического планирования. */

export const RECONCILIATION_QUEST = {
  code: "reconciliation",
  timings: {
    introDelayMs: 5_000,
    declineRetryMs: 5 * 60_000,
    lineHoldMs: 3_000,
  },
  caller: {
    name: "Бульбакоинова И.А.",
    photo: "assets/ui/bulbatalk/avatar-accountant.png",
  },
} as const;

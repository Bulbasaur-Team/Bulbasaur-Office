/** Квест «День X» — финальная презентация инвесторам. */

export const DAY_X_QUEST = {
  code: "day_x",
  timings: {
    introDelayMs: 6_000,
    declineRetryMs: 5 * 60_000,
    autoAdvanceMs: 1_000,
  },
  investorSatisfaction: {
    initial: 50,
    success: 90,
    goodDelta: 5,
    badDelta: -10,
  },
  caller: {
    name: "Бульбов Н.Н.",
    photo: "assets/ui/bulbatalk/boss-1.png",
  },
  desktop: {
    wrongFile: "DayX.ppsx",
    rightFile: "DayX2.ppsx",
    folderName: "Новая Папка (1)",
  },
} as const;

export type DayXBossId = "boss1" | "boss2" | "boss3" | "boss4";
export type DayXInvestorId = "inv1" | "inv2" | "inv3";
export type DayXBubbleId = DayXBossId | DayXInvestorId | "speaker";

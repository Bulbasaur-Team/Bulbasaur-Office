import type { QuestStatusRow } from "../net/api";
import type { QuestApiStatus } from "./quests";

/** Пороги ачивок как на сервере (`QuestCode.minAchievements`). */
export const STORY_GATES = [
  { code: "prologue", minAchievements: 0 },
  { code: "adaptation", minAchievements: 3 },
  { code: "fridge_pin", minAchievements: 5 },
  { code: "green_alert", minAchievements: 5 },
  { code: "lost_package", minAchievements: 10 },
  { code: "strategy", minAchievements: 10 },
  { code: "reconciliation", minAchievements: 10 },
  { code: "presentation", minAchievements: 10 },
  { code: "quantum", minAchievements: 10 },
  { code: "day_x", minAchievements: 10 },
] as const;

export type StoryGateCode = (typeof STORY_GATES)[number]["code"];

/** Клиентский прогресс внутри квеста — сервер его не хранит. */
export interface StoryHintProgress {
  packageDriverBriefed: boolean;
  packageWaybillRead: boolean;
  packageHasItem: boolean;
  presentationDiy: boolean;
  presentationDiyShown: boolean;
  presentationClaudePaid: boolean;
}

export const EMPTY_STORY_HINT_PROGRESS: StoryHintProgress = {
  packageDriverBriefed: false,
  packageWaybillRead: false,
  packageHasItem: false,
  presentationDiy: false,
  presentationDiyShown: false,
  presentationClaudePaid: false,
};

/** Сколько ачивок нужно до следующего сюжетного шага; null — порог уже пройден. */
export function nextAchievementGate(quests: QuestStatusRow[], owned: number): number | null {
  for (let i = 0; i < STORY_GATES.length; i++) {
    const gate = STORY_GATES[i]!;
    const status = questStatus(quests, gate.code);
    if (status !== "LOCKED") continue;
    const prev = i > 0 ? STORY_GATES[i - 1] : null;
    if (prev) {
      if (questStatus(quests, prev.code) !== "COMPLETED") return null;
    }
    if (owned < gate.minAchievements) return gate.minAchievements;
    return null;
  }
  return null;
}

/**
 * Текст нижней подсказки. null — сюжет пройден или пока нечего говорить.
 * Если ачивок не хватает — порог. Если хватает — что делать на текущем этапе.
 */
export function storyHintText(
  quests: QuestStatusRow[],
  owned: number,
  progress: StoryHintProgress = EMPTY_STORY_HINT_PROGRESS,
): string | null {
  if (questStatus(quests, "day_x") === "COMPLETED") return null;

  for (let i = 0; i < STORY_GATES.length; i++) {
    const gate = STORY_GATES[i]!;
    const status = questStatus(quests, gate.code);
    if (status === "COMPLETED") continue;

    if (status === "LOCKED") {
      const prev = i > 0 ? STORY_GATES[i - 1] : null;
      if (prev && questStatus(quests, prev.code) !== "COMPLETED") return null;
      if (owned < gate.minAchievements) {
        return achievementNeedText(gate.minAchievements, owned);
      }
      return hintForCall(gate.code);
    }

    if (status === "AVAILABLE") return hintForCall(gate.code);
    return hintForProgress(gate.code, progress);
  }

  return null;
}

function questStatus(quests: QuestStatusRow[], code: string): QuestApiStatus {
  return quests.find((quest) => quest.code === code)?.status ?? "LOCKED";
}

function achievementNeedText(need: number, owned: number): string {
  return (
    `Сюжет продолжится, когда у тебя будет ${need} ${achievementWord(need)}. ` +
    `У тебя ${owned} ${achievementWord(owned)}. ` +
    `Посмотреть свои ачивки можно в меню игры.`
  );
}

function hintForCall(code: StoryGateCode): string {
  switch (code) {
    case "prologue":
      return "Возьми телефон — HR хочет провести тебя по офису.";
    case "adaptation":
      return "Возьми телефон — HR перезвонит по адаптации.";
    case "fridge_pin":
      return "Возьми телефон — гендир позвонит со срочным поручением.";
    case "green_alert":
      return "Возьми телефон — техлиду нужна помощь.";
    case "lost_package":
      return "Возьми телефон — директору по логистике нужна помощь.";
    case "strategy":
      return "Возьми телефон — HR зовёт на совещание.";
    case "reconciliation":
      return "Возьми телефон — бухгалтерия хочет свериться.";
    case "presentation":
      return "Возьми телефон — директор по развитию позвонит про презентацию.";
    case "quantum":
      return "Возьми телефон — техлид хочет проверить тебя по квантовой физике.";
    case "day_x":
      return "Возьми телефон — гендир позовёт на выступление.";
  }
}

function hintForProgress(code: StoryGateCode, progress: StoryHintProgress): string {
  switch (code) {
    case "prologue":
    case "adaptation":
    case "reconciliation":
      return hintForCall(code);
    case "fridge_pin":
      return "Сходи к Бульба Коту в главном офисе — он возможно что-то знает про пин от холодильника.";
    case "green_alert":
      return "Возьми телефон: техлид ждёт, пока график станет зелёным.";
    case "lost_package":
      return packageHint(progress);
    case "strategy":
      return "В главном офисе открой ноутбук и зайди в BulbaTalk — там совещание.";
    case "presentation":
      return presentationHint(progress);
    case "quantum":
      return "Сходи в чилл-зону и пройди тест по квантовой физике в Bulba Quiz.";
    case "day_x":
      return "На парковке зайди в зал Дня X — там презентация для инвесторов.";
  }
}

function packageHint(progress: StoryHintProgress): string {
  if (!progress.packageDriverBriefed) {
    return "Поговори с водителем на парковке — может он знает, куда делась посылка?";
  }
  if (!progress.packageWaybillRead) {
    return "Сходи в дата-центр и открой накладную на старом компьютере. Пароль можешь уточнить у водителя.";
  }
  if (!progress.packageHasItem) {
    return "Найди Бульбазавра в странной шляпе.";
  }
  return "Отнеси посылку водителю.";
}

function presentationHint(progress: StoryHintProgress): string {
  if (!progress.presentationDiy) {
    return "В главном офисе открой ноутбук и собери черновик слайдов на рабочем столе.";
  }
  if (!progress.presentationDiyShown) {
    return "Открой ноутбук, зайди в BulbaTalk и покажи черновик начальнику.";
  }
  if (!progress.presentationClaudePaid) {
    return "Уговори Claude на ноутбуке сделать нормальные слайды.";
  }
  return "Открой ноутбук, зайди в BulbaTalk и собери финальную презентацию.";
}

export function achievementWord(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "ачивка";
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "ачивки";
  return "ачивок";
}

/** Квест «Посылка не туда» — только мультиплеер. */

export const PACKAGE_QUEST = {
  code: "lost_package",
  /** Пароль к файлу накладной на ретро-ПК (говорит водитель). */
  filePassword: "ASEL001",
  /** Секретный код выдачи с накладной; им же завершаем квест у водителя. */
  secretCode: "LOVESHOT",
  rewardBc: 15_000,
  timings: {
    introDelayMs: 8_000,
    declineRetryMs: 5 * 60_000,
    /** Пауза после реплики, если дальше не ждём ответа игрока. */
    lineHoldMs: 3_000,
    /** Задержка перед финальным звонком после сдачи посылки. */
    finaleDelayMs: 4_000,
  },
  caller: {
    name: "Бульбиков Г.В.",
    photo: "assets/ui/bulbatalk/boss-2.png",
  },
  beachNpc: {
    name: "Вьетнамец",
    sprite: "dev-fe" as const,
    /** Центр карты Вьетнамского пляжа (1408×768). */
    spawnX: 704,
    spawnY: 560,
    targetH: 110,
  },
  /** Тип предмета-коробки в лапах (см. items.ts). */
  itemType: "package",
} as const;

export function matchesPackageFilePassword(input: string): boolean {
  return input.trim().toUpperCase() === PACKAGE_QUEST.filePassword;
}

export function matchesPackageSecretCode(input: string): boolean {
  return input.trim().toUpperCase() === PACKAGE_QUEST.secretCode;
}

export function packageGreeting(playerName: string): string {
  return (
    `${playerName}, добрый день! Бульбиков на связи. ` +
    `Есть поручение по логистике — ситуация, скажем так, нештатная. Готов уточнить детали?`
  );
}

export const PACKAGE_BRIEFING_HELP = "Что случилось?";

export const PACKAGE_BRIEFING_INTRO =
  "Коротко: посылка по треку числится доставленной в Бульба Офис, а по факту её никто не видел. " +
  "Мне нужно, чтобы ты её нашёл и вернул в логистику. Можешь задать уточняющие вопросы.";

export interface PackageBriefingQuestion {
  id: "what" | "who";
  label: string;
  answer: string;
}

export const PACKAGE_BRIEFING_QUESTIONS: PackageBriefingQuestion[] = [
  {
    id: "who",
    label: "Кто может знать про посылку?",
    answer:
      "Водитель на парковке. Он принимает и развозит грузы. " +
      "Каскадируй вопрос до него, пожалуйста. " +
      "И когда найдёшь посылку — передай её водителю: он уже доставит до меня.",
  },
  {
    id: "what",
    label: "А что в посылке?",
    answer:
      "Э-э… содержимое… скажем так… конфиденциально. " +
      "Не принципиально для задачи. Главное — найти и вернуть. Без детализации, ок?",
  },
];

export const PACKAGE_BRIEFING_ACCEPT = "Хорошо, я найду посылку!";

export const PACKAGE_BRIEFING_CLOSING =
  "Отлично, зафиксировали. Жду результат. Я на связи — но без лишних статусов, только по делу. До связи!";

export const PACKAGE_FINALE =
  "Вот это я понимаю — посылка вернулась в контур логистики. Сердечно благодарю за вклад. " +
  "Фиксирую done, подсвечу на синке. Ещё раз спасибо — и хорошего дня. До связи!";

/** Текст накладной после ввода пароля. */
export const PACKAGE_WAYBILL_TEXT =
  "НАКЛАДНАЯ VN-44821\n" +
  "────────────────────\n" +
  "Груз: посылка (содержимое — н/д)\n" +
  "Статус: выдано получателю на месте\n" +
  "Получатель: вьетнамец\n" +
  "Примечание: опознание — странная шляпа\n" +
  "\n" +
  "Секретный код выдачи: LOVESHOT\n" +
  "\n" +
  "Копия для архива Бульба Офис / logistics";

export const DRIVER_QUEST = {
  talkLabel: "Поговорить с водителем",
  firstTalk:
    "А, та посылка? Забрал какой-то тип в странной шляпе — и был таков. Куда пошёл — не видел. " +
    "Копию накладной я скинул на старый комп в дата-центре. Файл запаролен: ASEL001. Смотри там.",
  alreadyTalked:
    "Накладная на старом компе в дата-центре, пароль ASEL001. Если найдёшь посылку — неси сюда.",
  giveLabel: "Отдать посылку",
  askAgainLabel: "Ещё раз про посылку…",
  deliver:
    "О, нашли! Бульбиков Г.В. просил передать тебе деньги за посылку — 15000 BC, держи. " +
    "А коробку я лично вручу ему в руки. Спасибо.",
  noPackageYet: "Посылки пока нет. Когда найдёшь — неси, я передам Бульбикову лично.",
  destinationsHint: "Куда едем?",
} as const;

export const BEACH_QUEST = {
  greet:
    "Эх… зря я забрал эту посылку, сам понимаю. Только никому не говори, ладно? " +
    "Но кому попало всё равно не отдам — назови секретный код, тогда верну.",
  askCodeLabel: "Назвать секретный код",
  codePlaceholder: "Код…",
  wrong: "Неверный код. Без кода не отдам.",
  correct: "Верно. Держи посылку. Мне тут больше делать нечего — пойду.",
  byeLabel: "Пока",
} as const;

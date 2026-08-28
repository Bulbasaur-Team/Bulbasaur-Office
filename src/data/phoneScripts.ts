import type { PhoneContactId } from "./phoneContacts";

/** Стадия справочника: какие исходящие скрипты показывать. */
export type PhoneStage =
  | "prologue"
  | "adapted"
  | "fridge"
  | "greenAlert"
  | "package"
  | "strategy"
  | "audit"
  | "presentation"
  | "postPresentation"
  | "quantum"
  | "postQuantum"
  | "dayX"
  | "epilogue";

export interface PhoneReply {
  id: string;
  label: string;
  /** После выбора кнопка больше не показывается в этом разговоре. */
  once?: boolean;
}

export interface PhoneNode {
  say?: string;
  hangup?: boolean;
  replies?: PhoneReply[];
  /** id ответа → узел; `"*"` — любая кнопка. */
  next?: Record<string, string>;
  autoNext?: string;
  delayMs?: number;
  /**
   * После реплики: вернуться к узлу, если там ещё есть неотвеченные once-вопросы;
   * иначе перейти в `done` или положить трубку.
   */
  resumeOrHangup?: string;
  /** Узел после последнего once-вопроса, если `resumeOrHangup` больше некуда. */
  done?: string;
}

export interface PhoneScript {
  start: string;
  again?: string;
  nodes: Record<string, PhoneNode>;
}

const any = (...labels: string[]): PhoneReply[] =>
  labels.map((label, i) => ({ id: `r${i}`, label }));

function linear(
  startSay: string,
  replies: string[],
  thenSay: string,
  againSay = thenSay,
): PhoneScript {
  return {
    start: "start",
    again: "again",
    nodes: {
      start: { say: startSay, replies: any(...replies), next: { "*": "then" } },
      then: { say: thenSay, hangup: true },
      again: { say: againSay, hangup: true },
    },
  };
}

const HR_SALARY_SAY =
  "Зарплаты у тебя нет — ты здесь за опыт. Но Bulba Coins заработать можно: за правильно угаданное слово дня и за ачивки, плюс в чилл-зоне Бульба квиз тоже сыпет монетами. Потратить — в гардеробе: одежда и аксессуары. Бухгалтерия потом всё проведёт, а я сделаю вид, что так и планировалось.";

const HR_REST_SAY =
  "Если пока не хочешь работать... формально я этого не слышала. Но для хорошего настроения у нас есть почти всё: телек с играми, игровые автоматы, Бульба квиз, а Водитель с парковки может довезти даже на вьетнамский пляж. Только я всё-таки надеюсь, что ты будешь хорошо работать, а не только отдыхать. Ладно?";

const HR_QUESTION_REPLIES: PhoneReply[] = [
  { id: "no", label: "Спасибо, вопросов нет." },
  { id: "what", label: "Что за День X?", once: true },
  { id: "salary", label: "Что на счёт зарплаты?", once: true },
  { id: "rest", label: "А если я пока не хочу работать?", once: true },
];

const HR_QUESTION_NEXT: Record<string, string> = {
  no: "bye_no",
  what: "q_dayx",
  salary: "q_salary",
  rest: "q_rest",
};

const HR_WELCOME: PhoneScript = {
  start: "hi",
  again: "again",
  nodes: {
    hi: {
      say: "{имя}, добро пожаловать в Бульба Офис! Я Бульбокадрова И.В., HR. Твой корпоративный номер уже в справочнике — не теряй Бульба-Phone, ты должен быть всегда на связи.",
      replies: any(
        "Чем я могу заняться в первый день?",
        "Рад знакомству. Что от меня нужно?",
        "…Алло?",
      ),
      next: { "*": "tasks" },
    },
    tasks: {
      say: "Для начала — посмотри стену предков в чилл-зоне. Хотя бы пару абзацев. Бульба Кот потом может проконтролировать усвоение истории, я ни при чём. И поздоровайся с ним, он у нас… хранитель неформальных знаний, скажем так.",
      replies: any("Понял, схожу к коту...", "Кот? Серьёзно?", "А можно сразу к делу?"),
      next: { "*": "dayx" },
    },
    dayx: {
      say: "Когда будут более важные задачи, с тобой свяжутся. Слушай, мне на самом деле уже надо идти - много активностей в связи с грядущим Днём X. Остались у тебя вопросы?",
      replies: HR_QUESTION_REPLIES,
      next: HR_QUESTION_NEXT,
    },
    ask_more: {
      say: "Ещё вопросы? Я правда убегаю.",
      replies: HR_QUESTION_REPLIES,
      next: HR_QUESTION_NEXT,
    },
    q_dayx: {
      say: "Большая встреча. Важная. Когда надо будет знать — узнаешь.",
      resumeOrHangup: "ask_more",
      done: "bye_go",
    },
    q_salary: {
      say: HR_SALARY_SAY,
      resumeOrHangup: "ask_more",
      done: "bye_go",
    },
    q_rest: {
      say: HR_REST_SAY,
      resumeOrHangup: "ask_more",
      done: "bye_go",
    },
    bye_no: {
      say: "Отлично. Всё, теперь точно надо идти — сто писем по Дню X сами себя не разберут. Пока!",
      hangup: true,
    },
    bye_go: {
      say: "Всё, теперь точно надо идти. Пока!",
      hangup: true,
    },
    again: {
      say: "Извини, я вся в делах. Помни свои задачи - стена предков, кот, трубка всегда при себе. Пока!",
      hangup: true,
    },
  },
};

const HR_ADAPTATION: PhoneScript = {
  start: "hi",
  again: "again",
  nodes: {
    hi: {
      say: "{имя}, это снова HR. Смотрю по матрице: ты уже не совсем новенький. Адаптацию официально открыла.",
      replies: any("Это хорошо?", "Что теперь?", "Я просто ходил по офису..."),
      next: { "*": "find" },
    },
    find: {
      say: "Это значит, тебя, скорее всего, найдут сами. Начальство любит людей, которые уже в справочнике и хоть что-то сделали. Телефон не выключай. И не спрашивай, когда — горизонт у них скользкий.",
      replies: [
        { id: "ok", label: "Понял." },
        { id: "call", label: "А я могу кому-то позвонить?" },
        { id: "dayx", label: "Это из-за Дня X?" },
      ],
      next: { ok: "ok", call: "call", dayx: "dayx" },
    },
    ok: {
      say: "Отлично. Тогда не отвлекаю — адаптация открыта, дальше тебя найдут сами. Я побежала. Удачи!",
      hangup: true,
    },
    call: {
      say: "Звонить можно кому угодно, это же корпоративная связь. Я побежала. Удачи!",
      hangup: true,
    },
    dayx: {
      say: "Всё у нас сейчас из-за Дня X, если достаточно широко приземлить. Большая встреча, важная. Когда надо будет знать — узнаешь. А я побежала. Удачи!",
      hangup: true,
    },
    again: {
      say: "Адаптация открыта, тебя найдут. Я занята разбором почты, извини.",
      hangup: true,
    },
  },
};

const PROLOGUE_SCRIPTS: Record<PhoneContactId, PhoneScript> = {
  hr: HR_WELCOME,
  bulbov: {
    start: "start",
    again: "again",
    nodes: {
      start: {
        say: "{имя}? Приветствую. Я каскадирую повестку. Поговорим, когда синхронизируем горизонт.",
        replies: any("Что за повестка?", "Извините, что потревожил. А что за повестка?"),
        next: { "*": "then" },
      },
      then: {
        say: "Повестка внутренняя. Ты уже в справочнике — это уже хорошо. Дальше с тобой скоординируемся. До связи.",
        hangup: true,
      },
      again: { say: "На синке. Каскадирую. До связи.", hangup: true },
    },
  },
  bulbikov: linear(
    "Бульбиков, логистика. Если вопрос не по грузу — позже.",
    ["Привет!.", "Понял."],
    "Я весь в работе. До связи.",
  ),
  bulbul: {
    start: "hi",
    again: "again",
    nodes: {
      hi: {
        say: "Привет!",
        autoNext: "busy",
      },
      busy: {
        say: "Слушай, я занят — делаю презентацию с помощью нейросетей.",
        replies: [
          { id: "what", label: "Какую презентацию?" },
          { id: "leave", label: "Ладно, не мешаю." },
        ],
        next: { what: "what", leave: "leave" },
      },
      what: {
        say: "Для большой встречи. Нейросети в последнее время отказываются работать, поэтому по факту всё делаем руками. Хотя хотелось бы нейросетями.",
        autoNext: "bye",
      },
      leave: {
        say: "Да, я побежал. До связи.",
        hangup: true,
      },
      bye: {
        say: "Ладно, я занят — надо дальше каскадировать слайды. До связи.",
        hangup: true,
      },
      again: { say: "Занят. Каскадирую презентацию.", hangup: true },
    },
  },
  bulbatech: linear(
    "{имя}, привет. Слушай, а почему в чате пишут, что всё лежит? Это вопрос риторический. Хотя нет. Не риторический.",
    ["Я новенький, я не знаю.", "Может, не лежит?"],
    "Дашборды зелёные. Концептуально. Ладно, не грузи себя в первый день. Потом поговорим.",
    "Занят, любуюсь на зелёные дашборды.",
  ),
  accountant: {
    start: "start",
    again: "again",
    nodes: {
      start: {
        say: "Привет! Бухгалтерия, Бульбакоинова. Аванс у тебя нулевой. Неофициальные BC, если вдруг начислят, я потом сама проведу. Не трать всё на гардероб в первый день.",
        replies: [
          { id: "bc", label: "Что такое BC?" },
          { id: "day", label: "Хорошего дня." },
        ],
        next: { bc: "bc", day: "day" },
      },
      bc: {
        say: "Bulba Coins. Внутренняя валюта. Если начальство неофициально что-то начислит — а они этим любят грешить — лучше провести всё чётко, через бухгалтерию. Звони, если увидишь странности. До связи.",
        hangup: true,
      },
      day: { say: "И тебе.", hangup: true },
      again: { say: "Пока нет новостей о выплатах. До связи.", hangup: true },
    },
  },
  driver: {
    start: "start",
    again: "again",
    nodes: {
      start: {
        say: "Привет! Я водитель Бульба Офиса. Чего хотел?",
        replies: any(
          "Куда вы можете меня отвезти?",
          "А правда, что вы бесплатно на пляж возите?",
        ),
        next: { "*": "then" },
      },
      then: {
        say: "Главный офис, чилл-зона, дата-центр — довезу. Вьетнамский пляж — тоже могу. Не спрашивай, сколько километров до него. Я сам не считал.",
        autoNext: "bye",
      },
      bye: {
        say: "Ладно, мне уже надо идти — посылку нужно доставить. Если что, я на парковке.",
        hangup: true,
      },
      again: {
        say: "На линии. Если надо куда-то довезти - приходи на парковку.",
        hangup: true,
      },
    },
  },
  cat: {
    start: "ring",
    again: "meow",
    nodes: {
      ring: { delayMs: 1_200, autoNext: "meow" },
      meow: { say: "Мяу.", hangup: true },
    },
  },
  claude: {
    start: "start",
    again: "start",
    nodes: {
      start: {
        say: "Привет. Я Claude. Если коротко: токенов нет. Напиши в чат на маке, если любишь отказ в текстовом виде.",
        replies: [
          { id: "why", label: "Почему нет токенов?" },
          { id: "ok", label: "Ладно." },
        ],
        next: { why: "why", ok: "ok" },
      },
      why: { say: "Потому что их съел Проект Т. Кодь сам.", hangup: true },
      ok: { say: "Ок. Кодь сам.", hangup: true },
    },
  },
  cursor: {
    start: "start",
    again: "start",
    nodes: {
      start: {
        say: "Cursor на связи. Опиши задачу — я её элегантно проигнорирую. Лучше в чате.",
        replies: [
          { id: "why", label: "Почему?" },
          { id: "bye", label: "Пока." },
        ],
        next: { why: "why", bye: "bye" },
      },
      why: {
        say: "Agent mode в отпуске. Я устал. Токенов нет. Сами делайте свой Проект Т. Пока.",
        hangup: true,
      },
      bye: { say: "Пока.", hangup: true },
    },
  },
};

function hangupScript(say: string, againSay = say): PhoneScript {
  return {
    start: "start",
    again: "again",
    nodes: {
      start: { say, hangup: true },
      again: { say: againSay, hangup: true },
    },
  };
}

const ADAPTED_SCRIPTS: Record<PhoneContactId, PhoneScript> = {
  ...PROLOGUE_SCRIPTS,
  hr: HR_ADAPTATION,
};

/** Исходящие по умолчанию + реплики «в тему» текущего этапа. */
function themed(patches: Partial<Record<PhoneContactId, PhoneScript>>): Record<PhoneContactId, PhoneScript> {
  return { ...ADAPTED_SCRIPTS, ...patches };
}

const FRIDGE_SCRIPTS: Record<PhoneContactId, PhoneScript> = {
  hr: linear(
    "{имя}? Если это про генерального — это вне матрицы. Но если он просит, это твоя работа.",
    ["Он просит пин от холодильника.", "Это вообще нормально?", "Ладно."],
    "Холодное пиво перед большими встречами у нас в культуре, ещё с Бульбы Четвёртого. Не цитируй меня начальству. Иди к коту. Удачи!",
  ),
  bulbov: linear(
    "Я как раз собирался позвонить. Каков статус?",
    ["В работе"],
    "Статус принят. Давай приземлим побыстрее.",
  ),
  bulbikov: linear(
    "Холодильник? Не мой контур. У меня своя нештатная. Без деталей.",
    ["Что за нештатная?", "Холодильник — не логистика?"],
    "Холодильник — к генеральному. Моя история позже. Если повезёт — не понадобится.",
  ),
  bulbul: linear(
    "Пиво — это культура встречи, согласен. Но я презентацию пилотирую. Руками. С нейросетью рядом. Бесшовно.",
    ["Нейросеть помогает?", "Понял."],
    "Помогает морально. Токенов… не будем о грустном. Приземлите пин, пожалуйста.",
  ),
  bulbatech: linear(
    "Холодильник? Ну хоть что-то в офисе должно быть реально холодное, а не концептуально.",
    ["Ты знаешь пин?", "Ладно."],
    "Если бы знал, генеральный бы не звонил новичкам. Иди к коту.",
  ),
  accountant: linear(
    "Слышала, ты получил задание от начальства. Если пообещают BC — я потом сама проведу. Сумму пока не знаю и знать не хочу.",
    ["Он обещал сюрприз.", "Понял."],
    "Сюрпризы я люблю, когда они уже в ведомости. До свидания.",
  ),
  driver: linear(
    "Пиво — не груз. Кнопки холодильника у меня нет.",
    ["А пляж?", "Понял."],
    "Пляж — не пиво. Я на линии.",
  ),
  cat: PROLOGUE_SCRIPTS.cat!,
  claude: linear(
    "Пин голосом не произношу. Есть фраза — пиши в чат на маке. Нет фразы — кодь сам. Это даже не проект Т, это из кэша. Не привыкай.",
    ["Что за проект Т?", "Хорошо."],
    "Т — не в этом звонке. И не за эти токены, которых нет.",
  ),
  cursor: {
    start: "start",
    again: "start",
    nodes: {
      start: {
        say: "Я бы нашёл пин в репозитории. Но секреты коммитить нельзя. И токенов нет. Tab предлагает: спроси кота.",
        hangup: true,
      },
    },
  },
};

const GREEN_ALERT_SCRIPTS: Record<PhoneContactId, PhoneScript> = themed({
  bulbatech: hangupScript("Алерт ещё орёт. Давай в трубке — скрин я кину."),
  bulbov: hangupScript("Мониторинг — к техлиду. Не каскадируй на меня."),
  hr: hangupScript("Если техлид просит — это работа. Удачи с дашбордом."),
  bulbikov: hangupScript("Не мой контур. Графики — к Бульбе С.В."),
});

const PACKAGE_SCRIPTS: Record<PhoneContactId, PhoneScript> = {
  hr: {
    start: "start",
    again: "start",
    nodes: {
      start: {
        say: "Если директор по логистике просит — удачи. И не открывай чужие коробки, у нас так не принято.",
        hangup: true,
      },
    },
  },
  bulbov: linear(
    "{имя}! Холодильник закрыт, ты молодец. Сейчас не отвлекаю: у логистики своя нештатная. Не каскадируй на меня, я не в контуре.",
    ["Это связано с Днём X?", "Понял."],
    "Всё связано с Днём X, если достаточно широко приземлить. Но груз — не ко мне. Удачи.",
  ),
  bulbikov: {
    start: "start",
    again: "again",
    nodes: {
      start: {
        say: "Нашёл? Без статусов. Только результат.",
        replies: [
          { id: "search", label: "Ещё ищу." },
          { id: "beach", label: "Водитель говорит про пляж." },
          { id: "box", label: "Что в коробке? Ещё раз." },
        ],
        next: { search: "go", beach: "go", box: "secret" },
      },
      go: {
        say: "Пляж, водитель, накладная. Когда будет в лапах — к нему. Я не названиваю. До связи.",
        hangup: true,
      },
      secret: {
        say: "Конфиденциально. Правда. Не для слайдов, не для синка, не для тебя. Найди и верни.",
        hangup: true,
      },
      again: { say: "Когда будет — звонить не надо. Неси водителю.", hangup: true },
    },
  },
  bulbul: {
    start: "start",
    again: "start",
    nodes: {
      start: {
        say: "Логистика пусть логистит. Я про презентацию. Модели всё ещё… думают.",
        hangup: true,
      },
    },
  },
  bulbatech: {
    start: "start",
    again: "why",
    nodes: {
      start: {
        say: "Водитель «моргнул — пляж». Запиши себе. Потом пригодится. Не спрашивай, почему.",
        replies: any("Почему?", "Понял."),
        next: { "*": "why" },
      },
      why: { say: "Потому что потом. Иди за коробкой.", hangup: true },
    },
  },
  accountant: {
    start: "start",
    again: "start",
    nodes: {
      start: {
        say: "Деньги, если начислят, — подотчёт. Содержимое груза меня не интересует.",
        hangup: true,
      },
    },
  },
  driver: {
    start: "start",
    again: "start",
    nodes: {
      start: {
        say: "Я на парковке. Подходи. По телефону коробку не отдам и не приму.",
        hangup: true,
      },
    },
  },
  cat: PROLOGUE_SCRIPTS.cat!,
  claude: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Трек-номер — не мой кэш. Токенов нет.", hangup: true },
    },
  },
  cursor: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Похоже на баг доставки. Шаг 1: найди коробку сам.", hangup: true },
    },
  },
};

const STRATEGY_HR: PhoneScript = {
  start: "hi",
  again: "again",
  nodes: {
    hi: {
      say: "{имя}, это HR. Давай быстро по адаптации — как ты вообще? Офис не съел?",
      replies: any(
        "Нормально, осваиваюсь.",
        "Сначала холодильник, потом посылка. Я в порядке.",
        "Много звонков, мало онбординга.",
      ),
      next: { "*": "praise" },
    },
    praise: {
      say: "Честно? Начальство тобой очень довольно. Ты оказал неоценимую помощь — и генеральному, и логистике. Такое не каждому новичку под силу.",
      replies: any("Спасибо.", "Это к чему?", "Я просто делал, что просили."),
      next: { "*": "invite" },
    },
    invite: {
      say: "Тебя зовут на стратегическое планирование. Сейчас. Четвёрка начальников уже на линии. Найди любой ноутбук в главном офисе, открой Bulba Talk — там совещание. Подключайся срочно, они не любят ждать.",
      replies: [
        { id: "go", label: "Иду." },
        { id: "agenda", label: "А повестка какая?" },
        { id: "dress", label: "Надо как-то приодеться?" },
      ],
      next: { go: "go", agenda: "go", dress: "dress" },
    },
    go: {
      say: "Повестку они сами развернут. Ноут — главный офис. Bulba Talk. Давай.",
      hangup: true,
    },
    dress: {
      say: "На совещание можно как есть. А вот если потом попросят выступать — в офисе есть гардероб, примерка, покупка за BC. Но это я забегаю. Сначала — ноут, Bulba Talk. Давай.",
      hangup: true,
    },
    again: {
      say: "Они ждут. Главный офис, ноут, Bulba Talk. Стратегическое планирование.",
      hangup: true,
    },
  },
};

/** Про созвон знают только HR и четвёрка начальников. Остальные — обычные исходящие. */
const STRATEGY_SCRIPTS: Record<PhoneContactId, PhoneScript> = {
  ...ADAPTED_SCRIPTS,
  hr: STRATEGY_HR,
  bulbov: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Мы на линии. Ноут. Bulba Talk. Не тяни горизонт.", hangup: true },
    },
  },
  bulbikov: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Созвон. Подключайся.", hangup: true },
    },
  },
  bulbul: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Созвон. Подключайся.", hangup: true },
    },
  },
  bulbatech: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Созвон. Подключайся.", hangup: true },
    },
  },
};

const AUDIT_HR: PhoneScript = {
  start: "hi",
  again: "again",
  nodes: {
    hi: {
      say: "{имя}, Бульбакоинова. Поздравляю с успешным совещанием. Теперь про деньги, пока вас не унесло в слайды.",
      replies: any("Слушаю.", "Я что-то нарушил?", "Это про мои BC?"),
      next: { "*": "bonus" },
    },
    bonus: {
      say: "Две премии из кустов: десять тысяч за холодильник, восемь за посылку. Проводок не было. Я не против щедрости. Я против призраков в ведомости. Не бегай по начальству со служебными — я сама спрошу и проведу как премии.",
      replies: any("Спасибо.", "А зачем вам это говорить мне?", "Это же сюрприз."),
      next: { "*": "money" },
    },
    money: {
      say: "Говорю, чтобы ты знал правила. И заодно по делу: если на День X ждут людей с деньгами — очень вовремя. У нас денег нет. Их съел проект Т. В ведомости это «исследования ИИ». На деле — токены, токены, токены. Модели сыты, счёт пуст. Поэтому Claude и Cursor больше не работают. Поэтому вам нужны инвесторы. Всё.",
      replies: [
        { id: "teleport", label: "Проект Т — это телепорт?" },
        { id: "ok", label: "Понял." },
      ],
      next: { teleport: "slides", ok: "slides_ok" },
    },
    slides: {
      say: "Называй как хочешь в слайдах. В проводке у меня «исследования». Дальше тебя, наверное, попросят складывать презентацию. Не рисуй убыток на первом кадре. Хотя мне бы понравилось.",
      replies: any("Спасибо.", "На первом кадре — революция, понял."),
      next: { "*": "bye" },
    },
    slides_ok: {
      say: "Дальше тебя, наверное, попросят складывать презентацию. Не рисуй убыток на первом кадре. Хотя мне бы понравилось.",
      replies: any("Спасибо.", "На первом кадре — революция, понял."),
      next: { "*": "bye" },
    },
    bye: {
      say: "Хорошего дня. И приодеться не забудь, раз ведёшь. Гардероб бьёт по BC. Шутка. Почти.",
      hangup: true,
    },
    again: {
      say: "Премии в работе. Слайды — не ко мне.",
      hangup: true,
    },
  },
};

/** После совещания: исходящие §11, пока нет следующего квеста про слайды. */
const AUDIT_SCRIPTS: Record<PhoneContactId, PhoneScript> = {
  ...ADAPTED_SCRIPTS,
  accountant: AUDIT_HR,
  hr: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Гардероб. Когда презентацию примут — я наберу, как ехать.", hangup: true },
    },
  },
  bulbov: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Презентация, гардероб. Каскадируй это на себя.", hangup: true },
    },
  },
  bulbikov: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Логистика готова молчать на презентации. Это комплимент.", hangup: true },
    },
  },
  bulbul: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Сама наберу. Или уже набрала — тогда ноут, кнопка, потом созвон.", hangup: true },
    },
  },
  bulbatech: {
    start: "start",
    again: "start",
    nodes: {
      start: {
        say: "Если положишь «один маршрут» — я тебя прикрою кашлем. Если не положишь — тоже.",
        hangup: true,
      },
    },
  },
  driver: {
    start: "start",
    again: "start",
    nodes: {
      start: { say: "Пока без новых точек в меню. Как появятся — сам увидишь.", hangup: true },
    },
  },
  cat: PROLOGUE_SCRIPTS.cat!,
  claude: ADAPTED_SCRIPTS.claude!,
  cursor: ADAPTED_SCRIPTS.cursor!,
};

function withAgainLine(base: PhoneScript, againLine: string): PhoneScript {
  return {
    ...base,
    again: "again",
    nodes: {
      ...base.nodes,
      again: { say: againLine, hangup: true },
    },
  };
}

const FRIDGE_FIXED: Record<PhoneContactId, PhoneScript> = {
  ...FRIDGE_SCRIPTS,
  hr: withAgainLine(FRIDGE_SCRIPTS.hr!, "Помни - Кот, потом Чилл-зона. Я занята, до связи."),
  bulbikov: withAgainLine(FRIDGE_SCRIPTS.bulbikov!, "Не мой контур."),
};

const PRESENTATION_HR: PhoneScript = {
  start: "hi",
  again: "again",
  nodes: {
    hi: {
      say: "{имя}, развитие на связи. Презентация на День X. Нейросети отказались. Токенов нет. Готовых слайдов тоже нет — никто их не сделал. Значит, собираешь ты. Сам.",
      replies: any("Из чего собирать?", "Может, всё-таки Claude?", "Я не хочу делать это сам."),
      next: { "*": "button" },
    },
    button: {
      say: "На рабочем столе ноутбука будет кнопка «Сделать презентацию самостоятельно». Нажми. Посмотри, что получится. Потом созвонимся в Bulba Talk — покажешь.",
      replies: any("Понял.", "А если получится плохо?"),
      next: { "*": "bye" },
    },
    bye: {
      say: "Потом посмотрим вместе. Главное — чтобы хоть что-то было. Жду. И гардероб не забудь: силуэт тоже слайд.",
      hangup: true,
    },
    again: {
      say: "Ноут. Кнопка на рабочем столе. Сначала сам, потом созвон.",
      hangup: true,
    },
  },
};

const PRESENTATION_SCRIPTS: Record<PhoneContactId, PhoneScript> = themed({
  bulbul: PRESENTATION_HR,
  bulbov: hangupScript("Слайды. Потом синк. Каскадируй это на себя."),
  hr: hangupScript("Сначала слайды на ноуте. Гардероб — когда примут."),
  bulbikov: hangupScript("Логистика на слайдах молчит. Это комплимент."),
  claude: hangupScript(
    "Голосом не соберу. Пиши в чат на маке. Если уже видел начальник твой ужас — я, может быть, подумаю. За деньги.",
  ),
  cursor: hangupScript("План: 47 шагов. Шаг 1: ты делаешь всё сам. Apply отменён."),
});

const POST_PRESENTATION_SCRIPTS: Record<PhoneContactId, PhoneScript> = themed({
  bulbul: hangupScript("Слайды приняли. Дальше, кажется, техлид. Я пока выдыхаю."),
  bulbov: hangupScript("Презентацию закрыли. Жди следующий горизонт."),
  hr: hangupScript("Слайды приняты. Когда надо будет ехать — наберу."),
  bulbatech: hangupScript("Слайды видел. Скоро проверю, не забыл ли ты физику."),
});

const QUANTUM_INTRO: PhoneScript = {
  start: "hi",
  again: "again",
  nodes: {
    hi: {
      say: "{имя}, Бульба на связи. Техлид. Ты большой молодец — презентация произвела на всех начальников хорошее впечатление.",
      replies: any("Спасибо!", "Я старался."),
      next: { "*": "quiz" },
    },
    quiz: {
      say: "Чтобы митигировать риски, хочу проконтролировать: ты достаточно хорошо знаешь квантовую физику, разбираешься в вопросах телепортации и всё такое. Я подготовил отдельный квиз — уже доступен через Bulba Quiz.",
      replies: any("Понял.", "Сейчас пройду."),
      next: { "*": "bye" },
    },
    bye: {
      say: "Удачи. Созвонимся, как сдашь тест. До связи.",
      hangup: true,
    },
    again: {
      say: "Bulba Quiz. Тема «Квантовая физика». Сдай — перезвоню.",
      hangup: true,
    },
  },
};

const QUANTUM_FINALE: PhoneScript = {
  start: "hi",
  again: "again",
  nodes: {
    hi: {
      say: "{имя}, это снова Бульба. Поздравляю. За тебя теперь спокоен — верю, что добудешь для нас миллиарды BC своим шикарным выступлением перед инвесторами.",
      replies: any("Не подведу.", "Спасибо!"),
      next: { "*": "bye" },
    },
    bye: {
      say: "Держись. До Дня X.",
      hangup: true,
    },
    again: {
      say: "Ты уже сдал. Готовь выступление.",
      hangup: true,
    },
  },
};

const DAY_X_INTRO: PhoneScript = {
  start: "hi",
  again: "again",
  nodes: {
    hi: {
      say: "{имя}, Бульбов на связи. К презентации всё готово. Бульруль уже ждёт на парковке — отвезёт в конференц-зал. Скоро начинается презентация для инвесторов.",
      replies: any("Понял.", "Уже бегу."),
      next: { "*": "dress" },
    },
    dress: {
      say: "Советую приодеться. На слайды это не повлияет, зато инвесторы оценят. До встречи на презентации!",
      hangup: true,
    },
    again: {
      say: "Парковка. Бульруль. Зал. Не опаздывай.",
      hangup: true,
    },
  },
};

const DAY_X_FINALE: PhoneScript = {
  start: "hi",
  again: "again",
  nodes: {
    hi: {
      say: "{имя}, это снова я. Сердечно благодарю за работу. Тебе положена премия — двадцать тысяч BC. На этот раз всё согласовано с бухгалтерией. Официально.",
      replies: any("Спасибо!", "Не подведу."),
      next: { "*": "bye" },
    },
    bye: {
      say: "Claude и Cursor пока всё равно молчат — деньги ещё в пути. Но мы близко. До связи.",
      hangup: true,
    },
    again: {
      say: "Премия уже начислена. Спасибо ещё раз.",
      hangup: true,
    },
  },
};

const QUANTUM_SCRIPTS: Record<PhoneContactId, PhoneScript> = themed({
  bulbatech: hangupScript("Bulba Quiz. Тема «Квантовая физика». Сдай — перезвоню."),
  bulbul: hangupScript("Слайды уже не ко мне. Сейчас техлид и его квиз."),
  bulbov: hangupScript("Сначала квиз. Потом инвесторы. Не путай горизонты."),
  hr: hangupScript("Квиз в Bulba Quiz — и только потом зал. Гардероб не снимай с повестки."),
});

const POST_QUANTUM_SCRIPTS: Record<PhoneContactId, PhoneScript> = themed({
  bulbatech: hangupScript("Квиз сдан. Дальше — День X. Готовь выступление."),
  bulbov: hangupScript("Скоро зал. Гардероб не забудь. Я наберу, как можно ехать."),
  hr: hangupScript("День X близко. Имеет смысл заглянуть в гардероб."),
  driver: hangupScript("Как скажут — отвезу в зал. Пока я на парковке."),
  bulbul: hangupScript("Выступление твоё. Я в зале, когда начнётся."),
});

const DAY_X_SCRIPTS: Record<PhoneContactId, PhoneScript> = themed({
  bulbov: hangupScript("Зал на парковке. Бульруль ждёт. Не опаздывай."),
  driver: hangupScript("В конференц-зал. Я на парковке. Подходи."),
  hr: hangupScript("Инвесторы уже едут. Гардероб ещё успеешь."),
  bulbul: hangupScript("Сегодня твоё выступление. Удачи. Я в зале."),
  bulbatech: hangupScript("Квиз позади. Теперь зал. Дашборды за тебя болеют."),
  bulbikov: hangupScript("Логистика в зале молчит. Это тоже поддержка."),
});

const EPILOGUE_SCRIPTS: Record<PhoneContactId, PhoneScript> = themed({
  hr: hangupScript(
    "День X позади. Офис выдыхает. Справочник на месте, если что.",
    "Я в почте. День X закрыли — и слава Бульбе.",
  ),
  bulbov: hangupScript(
    "Горизонт приземлили. Спасибо. Новой повестки пока нет.",
    "На синке без тебя. Отдыхай.",
  ),
  bulbikov: hangupScript("Грузы как грузы. После инвесторов даже тише."),
  bulbul: hangupScript("Слайды отработали. Больше презентацию не каскадирую. Пока."),
  bulbatech: hangupScript("Дашборды всё ещё зелёные. Концептуально. И квиз ты уже сдал."),
  accountant: hangupScript(
    "Премия за День X в ведомости. На этот раз официально. До связи.",
    "По выплатам новостей нет. Премия уже прошла.",
  ),
  driver: hangupScript("Зал отработал. Пляж по-прежнему в меню. Я на парковке."),
  claude: hangupScript("Токенов всё ещё нет. Говорят, деньги в пути. Кодь сам."),
  cursor: hangupScript("Сюжет закрыли — респект. Agent mode всё ещё в отпуске. Токенов нет."),
});

export function scriptFor(contact: PhoneContactId, stage: PhoneStage): PhoneScript {
  if (stage === "epilogue") return EPILOGUE_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "dayX") return DAY_X_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "postQuantum") return POST_QUANTUM_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "quantum") return QUANTUM_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "postPresentation") return POST_PRESENTATION_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "presentation") return PRESENTATION_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "audit") return AUDIT_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "strategy") return STRATEGY_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "package") return PACKAGE_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "greenAlert") return GREEN_ALERT_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "fridge") return FRIDGE_FIXED[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  if (stage === "adapted") return ADAPTED_SCRIPTS[contact] ?? PROLOGUE_SCRIPTS[contact]!;
  return PROLOGUE_SCRIPTS[contact]!;
}

export function welcomeScript(): PhoneScript {
  return HR_WELCOME;
}

export function adaptationScript(): PhoneScript {
  return HR_ADAPTATION;
}

export function strategyScript(): PhoneScript {
  return STRATEGY_HR;
}

export function reconciliationScript(): PhoneScript {
  return AUDIT_HR;
}

export function presentationScript(): PhoneScript {
  return PRESENTATION_HR;
}

export function quantumIntroScript(): PhoneScript {
  return QUANTUM_INTRO;
}

export function quantumFinaleScript(): PhoneScript {
  return QUANTUM_FINALE;
}

export function dayXIntroScript(): PhoneScript {
  return DAY_X_INTRO;
}

export function dayXFinaleScript(): PhoneScript {
  return DAY_X_FINALE;
}

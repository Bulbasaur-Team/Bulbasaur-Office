/** Квест «Зелёный дашборд» — алерт техлида, заливка графика по телефону. */

export const ALERT_QUEST = {
  code: "green_alert",
  /** Клиент шлёт этот код, только если график реально зелёный. */
  secretCode: "GREEN",
  rewardBc: 5_000,
  timings: {
    introDelayMs: 6_000,
    declineRetryMs: 5 * 60_000,
    statusIntervalMs: 60_000,
    lineHoldMs: 3_000,
  },
  caller: {
    name: "Бульба С.В.",
    photo: "assets/ui/bulbatalk/boss-4.png",
  },
} as const;

export const ALERT_GREEN_HEX = "#3dcc6e";
export const ALERT_RED_HEX = "#e5484d";

export interface AlertColor {
  id: string;
  hex: string;
  label: string;
}

export const ALERT_COLORS: AlertColor[] = [
  { id: "red", hex: ALERT_RED_HEX, label: "Красный" },
  { id: "yellow", hex: "#f9c74f", label: "Жёлтый" },
  { id: "orange", hex: "#f8961e", label: "Оранжевый" },
  { id: "green", hex: ALERT_GREEN_HEX, label: "Зелёный" },
];

export function isAlertGreen(hex: string): boolean {
  return hex.toLowerCase() === ALERT_GREEN_HEX;
}

export function alertGreeting(playerName: string): string {
  return (
    `${playerName}, Бульба на связи. Техлид. ` +
    `У нас инцидент: мониторинг орёт красным, график прёт вверх. ` +
    `Дашборды у нас зелёные — концептуально. А этот — нет. Поможешь приземлить?`
  );
}

export const ALERT_HELP_PROMPT = "Что случилось?";

export const ALERT_HELP_ANSWER =
  "Алерт по error rate. Или latency. Или счастью стейкхолдеров — неважно. " +
  "Важно, что красное и растёт. Мне нужен зелёный, как на остальных дашбордах.";

export const ALERT_SCREEN_PROMPT = "Пришлите скрин с алертом";

export const ALERT_SCREEN_ANSWER =
  "Вот, скинул скрин. Красота, да? То есть наоборот. Глянь сам.";

export const ALERT_ACCEPT_PROMPT = "Сейчас разберусь с алертом";

export const ALERT_ACCEPT_ANSWER =
  "Открывай картинку, копай. Как график станет зелёным — покажи мне. Я на линии.";

export const ALERT_SHOW_PROMPT = "Показать начальнику";

export const ALERT_NOT_GREEN =
  "Не, график до сих пор не зелёный. Поразбирайся ещё.";

export const ALERT_SUCCESS =
  "А что, так можно было?! Креативно. Мониторинг зелёный — и я спокоен. Спасибо, сбрасываю.";

export const ALERT_WORK_PROMPT =
  "Ну что, с алертом разобрался? Открывай скрин и показывай, что получилось.";

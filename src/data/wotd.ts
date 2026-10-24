// Слово дня выводится на клиенте из непрозрачного сида (само слово по сети не ходит).
// Детерминированный хеш строки (FNV-1a, 32-бит) -> индекс в словаре. У всех клиентов
// один сид + одинаковый словарь => одно и то же слово дня.
export function seedToIndex(seed: string, length: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % length;
}

// Bulba Guess берёт слово дня из перестановки пула, а не из хеша по модулю:
// каждое слово встречается один раз за круг, и соседние дни не сталкиваются.
const DAILY_EPOCH = "2020-01-01";
const PERM_SEED = 0xb01ba6e5;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const permCache = new Map<number, number[]>();

function permutation(length: number): number[] {
  const perm = Array.from({ length }, (_, i) => i);
  const rand = mulberry32(PERM_SEED);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  return perm;
}

/** Сколько дней от 2020-01-01 до даты YYYY-MM-DD. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(2020, 0, 1)) / 86_400_000);
}

export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${t.getUTCFullYear()}-${mm}-${dd}`;
}

/** Сегодня по московскому календарю — тому же, что у сервера слова дня. */
export function moscowToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function dailyRoundIndex(isoDate: string, length: number): number {
  if (length <= 1) return 0;
  let perm = permCache.get(length);
  if (!perm || perm.length !== length) {
    perm = permutation(length);
    permCache.set(length, perm);
  }
  const day = dayNumber(isoDate || DAILY_EPOCH);
  const slot = ((day % length) + length) % length;
  return perm[slot];
}

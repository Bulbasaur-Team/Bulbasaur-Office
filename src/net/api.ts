// Клиент бэкенда: авторизация (логин/пароль -> JWT в localStorage) и лидерборды.
// Базовый URL берётся из VITE_API_URL (задаётся при сборке), для dev — localhost.
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
const TOKEN_KEY = "bulba_token";
const LOGIN_KEY = "bulba_login";
/** Фоновый refresh, пока вкладка открыта (sliding поверх TTL 7 дней). */
const SESSION_KEEPALIVE_MS = 6 * 60 * 60 * 1000;

let sessionKeepalive: ReturnType<typeof setInterval> | null = null;

export interface LeaderboardEntry {
  rank: number;
  login: string;
  value: number;
  you: boolean;
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
  you: LeaderboardEntry | null;
}

// Сиды слова дня: today — для сегодняшнего слова, prev — для вчерашнего (null, если вчера не было).
export interface WotdGameSeeds {
  today: string;
  prev: string | null;
}

export interface Wotd {
  guess: WotdGameSeeds;
  wordle: WotdGameSeeds;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getLogin(): string | null {
  return localStorage.getItem(LOGIN_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

export function logout(): void {
  stopSessionKeepalive();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LOGIN_KEY);
}

export function register(login: string, password: string): Promise<void> {
  return authRequest("register", login, password);
}

export function login(login: string, password: string): Promise<void> {
  return authRequest("login", login, password);
}

/** Продлить JWT на сервере; новый токен кладётся в localStorage. */
export async function refreshSession(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/account/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error("Сессия истекла — войдите заново");
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  const data = (await res.json()) as { token: string; login: string };
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(LOGIN_KEY, data.login);
  startSessionKeepalive();
}

/**
 * Проверить и продлить сессию. Локально протухший JWT — сразу logout без запроса.
 * Иначе POST /api/account/refresh (и проверка, что сервер ещё принимает токен).
 */
export async function ensureSession(): Promise<void> {
  const token = getToken();
  if (!token) {
    throw new Error("Сессия истекла — войдите заново");
  }
  const expMs = tokenExpiresAtMs(token);
  if (expMs !== null && expMs <= Date.now()) {
    logout();
    throw new Error("Сессия истекла — войдите заново");
  }
  await refreshSession();
}

/** Периодический refresh, чтобы длинная вкладка не доживала до жёсткого expiry. */
export function startSessionKeepalive(): void {
  stopSessionKeepalive();
  sessionKeepalive = setInterval(() => {
    if (!getToken()) {
      stopSessionKeepalive();
      return;
    }
    void ensureSession().catch(() => stopSessionKeepalive());
  }, SESSION_KEEPALIVE_MS);
}

export function stopSessionKeepalive(): void {
  if (sessionKeepalive !== null) {
    clearInterval(sessionKeepalive);
    sessionKeepalive = null;
  }
}

function tokenExpiresAtMs(token: string): number | null {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const json = base64UrlDecode(payloadPart);
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return atob(padded);
}

export function submitScore(gameId: string, value: number): Promise<Leaderboard> {
  return leaderboardRequest(`/api/leaderboard/${gameId}`, {
    method: "POST",
    body: JSON.stringify({ value: Math.round(value) }),
  });
}

export function fetchLeaderboard(gameId: string): Promise<Leaderboard> {
  return leaderboardRequest(`/api/leaderboard/${gameId}`, { method: "GET" });
}

// Слово дня: сиды (сегодня/вчера) для обеих игр.
export async function fetchWotd(): Promise<Wotd> {
  const res = await fetch(`${API_BASE}/api/wotd`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error("Сессия истекла — войдите заново");
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as Wotd;
}

export function fetchDailyLeaderboard(gameId: string): Promise<Leaderboard> {
  return leaderboardRequest(`/api/leaderboard/wotd/${gameId}`, { method: "GET" });
}

// Прогресс слова дня: пройдено ли, число попыток и подошедшие слова (для восстановления доски).
export interface DailyProgress {
  solved: boolean;
  attempts: number;
  guesses: string[];
}

export function fetchDailyProgress(gameId: string): Promise<DailyProgress> {
  return authedJson<DailyProgress>(`/api/wotd/${gameId}/progress`);
}

// Ачивки: весь каталог с признаком «получена», редкостью и счётчиком полученных.
// Сервер отдаёт список отсортированным по редкости (сначала самые распространённые).
export interface Achievement {
  code: string;
  title: string;
  description: string;
  image: string;
  owned: boolean;
  percent: number; // процент игроков, у которых есть ачивка
}

export interface Achievements {
  achievements: Achievement[];
  owned: number;
  total: number;
}

export function fetchAchievements(): Promise<Achievements> {
  return authedJson<Achievements>(`/api/achievements`);
}

// Ачивки другого игрока (для сообщества).
export function fetchPlayerAchievements(login: string): Promise<Achievements> {
  return authedJson<Achievements>(`/api/achievements/${encodeURIComponent(login)}`);
}

// Сообщество: игроки в порядке регистрации;
// online — игрок сейчас в игре (есть открытое соединение).
export interface CommunityPlayer {
  login: string;
  appearance: import("../data/wardrobe").PlayerAppearance;
  owned: number;
  online: boolean;
}

export interface Community {
  players: CommunityPlayer[];
  totalAchievements: number;
}

export function fetchCommunity(): Promise<Community> {
  return authedJson<Community>(`/api/community`);
}

// Логи Бульба Офиса (принтер в дата-центре): последние 500 строк событий.
export interface Logs {
  lines: string[];
}

export function fetchLogs(): Promise<Logs> {
  return authedJson<Logs>(`/api/logs`);
}

// Метрики офиса (мониторы в дата-центре): 5‑минутные бакеты за ~48 часов.
export interface OfficeMetricsPoint {
  t: string;
  online: number;
  tennisKicks: number;
  volleyballKicks: number;
  coffeeCups: number;
}

export interface OfficeMetrics {
  bucketMinutes: number;
  points: OfficeMetricsPoint[];
}

export function fetchOfficeMetrics(): Promise<OfficeMetrics> {
  return authedJson<OfficeMetrics>(`/api/metrics`);
}

// Профиль: баланс BC и надетая одежда.
export interface Profile {
  login: string;
  bulbaCoinBalance: number;
  appearance: import("../data/wardrobe").PlayerAppearance;
}

export function fetchProfile(): Promise<Profile> {
  return authedJson<Profile>(`/api/account/profile`);
}

export interface BulbaCoinTransaction {
  id: string;
  amount: number;
  kind: string;
  title: string;
  createdAt: string;
}

export interface BulbaCoinHistory {
  balance: number;
  transactions: BulbaCoinTransaction[];
}

export function fetchBulbaCoinHistory(before?: string): Promise<BulbaCoinHistory> {
  const q = before ? `?before=${encodeURIComponent(before)}` : "";
  return authedJson<BulbaCoinHistory>(`/api/account/bulba-coins/transactions${q}`);
}

export interface WardrobeCatalogItem {
  code: string;
  category: import("../data/wardrobe").WardrobeCategory;
  name: string;
  price: number;
  sellable: boolean;
  owned: boolean;
  equipped: boolean;
  purchasedAt: string | null;
}

export interface WardrobeCatalog {
  balance: number;
  appearance: import("../data/wardrobe").PlayerAppearance;
  items: WardrobeCatalogItem[];
}

export function fetchWardrobeCatalog(): Promise<WardrobeCatalog> {
  return authedJson<WardrobeCatalog>(`/api/wardrobe/catalog`);
}

export function buyWardrobeItem(itemCode: string): Promise<{ balance: number; item: WardrobeCatalogItem }> {
  return authedJson(`/api/wardrobe/buy`, {
    method: "POST",
    body: JSON.stringify({ itemCode }),
  });
}

export function equipWardrobeItem(
  category: string,
  itemCode: string | null,
): Promise<{ appearance: import("../data/wardrobe").PlayerAppearance }> {
  return authedJson(`/api/wardrobe/equip`, {
    method: "POST",
    body: JSON.stringify({ category, itemCode }),
  });
}

export function sellWardrobeItem(itemCode: string): Promise<{
  balance: number;
  refund: number;
  appearance: import("../data/wardrobe").PlayerAppearance;
}> {
  return authedJson(`/api/wardrobe/sell`, {
    method: "POST",
    body: JSON.stringify({ itemCode }),
  });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await authedVoid(`/api/account/password`, {
    method: "POST",
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

export interface RetroMemeUploadResult {
  id: string;
  imageUrl: string;
}

export async function uploadRetroMeme(roomId: string, file: File): Promise<RetroMemeUploadResult> {
  const dataBase64 = await fileToBase64(file);
  return authedJson<RetroMemeUploadResult>(`/api/retro/rooms/${encodeURIComponent(roomId)}/memes`, {
    method: "POST",
    body: JSON.stringify({ mimeType: file.type || "image/png", dataBase64 }),
  });
}

export async function fetchRetroRoom(roomId: string): Promise<unknown> {
  return authedJson<unknown>(`/api/retro/rooms/${encodeURIComponent(roomId)}`);
}

export async function fetchRetroMemeBlob(imageUrl: string): Promise<string> {
  const path = imageUrl.startsWith("http") ? imageUrl : `${API_BASE}${imageUrl}`;
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error("Сессия истекла — войдите заново");
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

// Как authedJson, но для эндпоинтов без тела ответа (204).
async function authedVoid(path: string, init: RequestInit): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error("Сессия истекла — войдите заново");
  }
  if (!res.ok) throw new Error(await errorMessage(res));
}

export function saveDailyProgress(gameId: string, state: DailyProgress): Promise<DailyProgress> {
  return authedJson<DailyProgress>(`/api/wotd/${gameId}/progress`, {
    method: "PUT",
    body: JSON.stringify(state),
  });
}

// Аутентифицированный JSON-запрос с обработкой протухшей сессии.
async function authedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error("Сессия истекла — войдите заново");
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

// Удалить свой аккаунт вместе с результатами. При успехе локальный токен стоит очистить.
export async function deleteAccount(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error("Сессия истекла — войдите заново");
  }
  if (!res.ok) throw new Error(await errorMessage(res));
}

async function authRequest(path: string, login: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const data = (await res.json()) as { token: string; login: string };
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(LOGIN_KEY, data.login);
  startSessionKeepalive();
}

async function leaderboardRequest(path: string, init: RequestInit): Promise<Leaderboard> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error("Сессия истекла — войдите заново");
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as Leaderboard;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `Ошибка ${res.status}`;
  } catch {
    return `Ошибка ${res.status}`;
  }
}

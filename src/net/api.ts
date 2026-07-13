// Клиент бэкенда: авторизация (логин/пароль -> JWT в localStorage) и лидерборды.
// Базовый URL берётся из VITE_API_URL (задаётся при сборке), для dev — localhost.
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
const TOKEN_KEY = "bulba_token";
const LOGIN_KEY = "bulba_login";

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
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LOGIN_KEY);
}

export function register(login: string, password: string): Promise<void> {
  return authRequest("register", login, password);
}

export function login(login: string, password: string): Promise<void> {
  return authRequest("login", login, password);
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

// Сообщество: игроки в порядке регистрации; role == null — роль ещё не выбрана;
// online — игрок сейчас в игре (есть открытое соединение).
export interface CommunityPlayer {
  login: string;
  role: string | null;
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

// Профиль: сохранённая роль (null — игрок ещё не выбирал Бульбазавра).
export interface Profile {
  login: string;
  role: string | null;
}

export function fetchProfile(): Promise<Profile> {
  return authedJson<Profile>(`/api/account/profile`);
}

export async function saveRole(role: string): Promise<void> {
  await authedVoid(`/api/account/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await authedVoid(`/api/account/password`, {
    method: "POST",
    body: JSON.stringify({ oldPassword, newPassword }),
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

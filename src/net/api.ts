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

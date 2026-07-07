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

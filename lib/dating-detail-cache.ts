const PREFIX = "dating-detail-cache:";

function buildKey(scope: string, id: string) {
  return `${PREFIX}${scope}:${id}`;
}

function writeCache(key: string, payload: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore cache write failures.
  }
}

function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function cacheOpenCardDetail(id: string, payload: unknown) {
  writeCache(buildKey("open-card", id), payload);
}

export function readOpenCardDetail<T>(id: string): T | null {
  return readCache<T>(buildKey("open-card", id));
}

export function cachePaidCardDetail(id: string, payload: unknown) {
  writeCache(buildKey("paid-card", id), payload);
}

export function readPaidCardDetail<T>(id: string): T | null {
  return readCache<T>(buildKey("paid-card", id));
}

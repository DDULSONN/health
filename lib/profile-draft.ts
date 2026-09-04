export const PROFILE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredProfileDraft<T> = {
  version: 1;
  userId: string;
  savedAt: number;
  value: T;
};

function storageKey(kind: string, userId: string) {
  const safeKind = kind.replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
  const safeUserId = userId.replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
  return `gymtool:profile-draft:${safeKind}:${safeUserId}`;
}

export function readProfileDraft<T>(kind: string, userId: string, now = Date.now()): StoredProfileDraft<T> | null {
  if (typeof window === "undefined" || !kind || !userId) return null;
  const key = storageKey(kind, userId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProfileDraft<T>>;
    if (
      parsed.version !== 1 ||
      parsed.userId !== userId ||
      typeof parsed.savedAt !== "number" ||
      !Number.isFinite(parsed.savedAt) ||
      parsed.savedAt > now + 5 * 60 * 1000 ||
      now - parsed.savedAt > PROFILE_DRAFT_TTL_MS ||
      !parsed.value ||
      typeof parsed.value !== "object"
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed as StoredProfileDraft<T>;
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage may be fully unavailable (for example, strict private browsing).
    }
    return null;
  }
}

export function writeProfileDraft<T extends object>(kind: string, userId: string, value: T, now = Date.now()) {
  if (typeof window === "undefined" || !kind || !userId) return false;
  try {
    const draft: StoredProfileDraft<T> = { version: 1, userId, savedAt: now, value };
    window.localStorage.setItem(storageKey(kind, userId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearProfileDraft(kind: string, userId: string) {
  if (typeof window === "undefined" || !kind || !userId) return;
  try {
    window.localStorage.removeItem(storageKey(kind, userId));
  } catch {
    // Storage can be unavailable in private browsing. The form must still work.
  }
}

export function formatDraftSavedAt(savedAt: number) {
  if (!Number.isFinite(savedAt)) return "최근";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(savedAt));
}

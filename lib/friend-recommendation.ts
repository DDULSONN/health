// Public contract: never add contact details, storage paths, or member IDs here.
export const FRIEND_PROMPTS = {
  fit: "너랑 잘 어울릴 것 같아서!",
  hello: "네 생각나서 보내봐.",
  introduce: "이런 분 어때?",
} as const;
export type FriendPrompt = keyof typeof FRIEND_PROMPTS;
export type FriendKind = "open_card" | "paid_card" | "one_on_one";
export type FriendSelection = { kind: FriendKind; cardId: string; ticket?: string };
export const FRIEND_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FRIEND_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export function friendReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [path, anchor, ...extra] = value.split("#");
  return /^\/s\/[A-Za-z0-9_-]{43}$/.test(path) && extra.length === 0 &&
    (anchor === undefined || (anchor.startsWith("candidate-") && FRIEND_UUID.test(anchor.slice(10)))) ? value : null;
}
export function friendCandidateReturnPath(token: string, itemId: string): string {
  return friendReturnPath(`/s/${token}#candidate-${itemId}`) ?? "/community/dating/cards";
}
export function friendProfileWriteHref(token: string, itemId: string): string {
  return `/onboarding/dating?target=one_on_one&share_return=${encodeURIComponent(friendCandidateReturnPath(token, itemId))}`;
}
export function friendSelections(value: unknown): FriendSelection[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
  const seen = new Set<string>();
  const items: FriendSelection[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || !["open_card", "paid_card", "one_on_one"].includes(entry.kind) ||
      typeof entry.cardId !== "string" || !FRIEND_UUID.test(entry.cardId) ||
      (entry.ticket !== undefined && (typeof entry.ticket !== "string" || entry.ticket.length > 5000))) return null;
    const key = `${entry.kind}:${entry.cardId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    items.push({ kind: entry.kind, cardId: entry.cardId, ...(entry.ticket ? { ticket: entry.ticket } : {}) });
  }
  return items;
}
export function friendAgeBand(age: number): string {
  if (!Number.isInteger(age) || age < 19 || age > 100) return "성인";
  if (age < 20) return "19세 이상";
  return `${Math.floor(age / 10) * 10}대`;
}
export type FriendPublicItem = {
  id: string; kind: FriendKind; ageBand: string; area: string; photos: string[];
  // Present only after login, verified phone, and server-side safety checks.
  detail?: { name: string; age: number; height: number | null; job: string; intro: string; strengths: string; preference: string };
};
export type FriendPublicPage = { prompt: string; expiresAt: string; access: "guest" | "verify" | "member"; items: FriendPublicItem[]; oneOnOneProfile?: "ready" | "needed" };

export type OwnFriendLink = {
  id: string; token: string; created_at: string; expires_at: string;
  candidates: { kind: FriendKind; label: string }[];
};
export function friendLinkRemaining(expiresAt: string, now: number): string {
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return "만료됨";
  const minutes = Math.ceil(remaining / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ""} 남음` : `${minutes}분 남음`;
}

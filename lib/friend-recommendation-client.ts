import { FRIEND_TOKEN, FRIEND_UUID, friendReturnPath, type FriendPrompt, type FriendSelection, type OwnFriendLink } from "@/lib/friend-recommendation";

export const FRIEND_SHARE_REQUEST_TIMEOUT_MS = 15_000;
export type CreatedFriendLink = { path: string; expiresAt: string };

export function isFriendLinkCurrent(link: CreatedFriendLink | null, now = Date.now()): boolean {
  return !!link && !!friendReturnPath(link.path) && Date.parse(link.expiresAt) > now;
}

export class FriendLinkRequestError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

// Bound both fetch and body parsing. A dropped response may already have created
// a link, so the caller must keep the same request key when retrying.
export async function requestFriendLink(
  body: { requestKey: string; prompt: FriendPrompt; items: FriendSelection[] }, signal: AbortSignal,
): Promise<CreatedFriendLink> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  let abortListener: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () => reject(new FriendLinkRequestError(timedOut
      ? "응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요."
      : "링크 만들기를 취소했어요."));
    controller.signal.addEventListener("abort", abortListener, { once: true });
  });
  signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => { timedOut = true; cancel(); }, FRIEND_SHARE_REQUEST_TIMEOUT_MS);
  if (signal.aborted) cancel();
  try {
    return await Promise.race([aborted, (async () => {
      if (controller.signal.aborted) throw new FriendLinkRequestError("링크 만들기를 취소했어요.");
      const response = await fetch("/api/dating/friend-shares", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new FriendLinkRequestError(typeof result?.error === "string" ? result.error : "링크를 만들지 못했어요.", response.status);
      if (!friendReturnPath(result?.path) || typeof result?.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt))) {
        throw new FriendLinkRequestError("추천 링크를 확인하지 못했어요. 다시 시도해 주세요.");
      }
      const link = { path: result.path, expiresAt: result.expiresAt };
      if (!isFriendLinkCurrent(link)) throw new FriendLinkRequestError("이전 링크가 만료됐어요. 새 링크를 만들어 주세요.", 410);
      return link;
    })()]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", abortListener!);
    controller.abort();
  }
}

type SettingsAction = { action: "preference"; enabled: boolean } | { action: "revoke"; id: string };
export function parseFriendShareSettings(value: unknown): { enabled: boolean; links: OwnFriendLink[] } {
  const invalid = () => new FriendLinkRequestError("추천 링크 목록을 확인하지 못했어요. 다시 확인해 주세요.");
  if (!value || typeof value !== "object") throw invalid();
  const data = value as Record<string, unknown>;
  if (typeof data.enabled !== "boolean" || !Array.isArray(data.links) || data.links.length > 10) throw invalid();
  const links = data.links.map((entry: unknown): OwnFriendLink => {
    if (!entry || typeof entry !== "object") throw invalid();
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || !FRIEND_UUID.test(row.id) || typeof row.token !== "string" || !FRIEND_TOKEN.test(row.token)
      || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))
      || typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at))) throw invalid();
    // Old deployment responses have no candidates yet; retain a safe fallback.
    const candidates: OwnFriendLink["candidates"] = Array.isArray(row.candidates) ? row.candidates.slice(0, 3).flatMap<OwnFriendLink["candidates"][number]>((candidate: unknown) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      return (item.kind === "open_card" || item.kind === "paid_card" || item.kind === "one_on_one") && typeof item.label === "string"
        ? [{ kind: item.kind, label: item.label.slice(0, 30) }] : [];
    }) : [];
    return { id: row.id, token: row.token, created_at: row.created_at, expires_at: row.expires_at, candidates };
  });
  return { enabled: data.enabled, links };
}

// Bound reads and explicit settings writes, including a stalled response body.
// Never replay a mutation after a lost response: the UI offers a fresh read.
export async function requestFriendShareSettings(action: SettingsAction | null, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController(); let timedOut = false;
  const cancel = () => controller.abort(); let abortListener: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () => reject(new FriendLinkRequestError(timedOut
      ? (action ? "처리 결과를 확인하지 못했어요. 내역 다시 확인을 눌러 주세요." : "응답이 늦어지고 있어요. 다시 확인해 주세요.")
      : "확인을 취소했어요."));
    controller.signal.addEventListener("abort", abortListener, { once: true });
  });
  signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => { timedOut = true; cancel(); }, FRIEND_SHARE_REQUEST_TIMEOUT_MS);
  if (signal.aborted) cancel();
  try {
    return await Promise.race([aborted, (async () => {
      if (controller.signal.aborted) throw new FriendLinkRequestError("확인을 취소했어요.");
      const response = await fetch("/api/dating/friend-shares", { cache: "no-store", signal: controller.signal,
        ...(action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) } : {}) });
      const result = await response.json();
      if (!response.ok) throw new FriendLinkRequestError(typeof result?.error === "string" ? result.error : "내역을 확인하지 못했어요.", response.status);
      if (action && result?.ok !== true) throw new FriendLinkRequestError("처리 결과를 확인하지 못했어요. 내역 다시 확인을 눌러 주세요.");
      return result;
    })()]);
  } catch (error) {
    if (error instanceof FriendLinkRequestError) throw error;
    throw new FriendLinkRequestError(action ? "처리 결과를 확인하지 못했어요. 내역 다시 확인을 눌러 주세요." : "연결을 확인한 뒤 다시 시도해 주세요.");
  } finally {
    clearTimeout(timeout); signal.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", abortListener!); controller.abort();
  }
}

import { friendReturnPath, type FriendPrompt, type FriendSelection } from "@/lib/friend-recommendation";

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

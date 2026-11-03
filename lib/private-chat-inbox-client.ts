import { fetchClientJson } from "@/lib/client-json-request";
import type { PrivateChatInboxItem } from "@/lib/private-chat-inbox";
import { NOTIFICATION_COUNT_INVALIDATED_EVENT } from "@/lib/notification-count";

export const PRIVATE_CHAT_UPDATED = "dating-private-chat-updated";
export function parsePrivateChatInbox(body: unknown): PrivateChatInboxItem[] | null {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length > 1000) return null;
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.match_id !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.match_id) ||
      ids.has(item.match_id) || typeof item.peer_name !== "string" || typeof item.last_message !== "string" ||
      !Number.isSafeInteger(item.unread_count) || item.unread_count < 0 || typeof item.last_message_at !== "string" ||
      !Number.isFinite(Date.parse(item.last_message_at))) return null;
    ids.add(item.match_id);
  }
  return items;
}
export function privateChatUpdated() {
  window.dispatchEvent(new Event(PRIVATE_CHAT_UPDATED));
  window.dispatchEvent(new Event(NOTIFICATION_COUNT_INVALIDATED_EVENT));
}
export async function readPrivateChat(matchId: string, through: string, signal: AbortSignal) {
  const { response, body } = await fetchClientJson<{ ok?: boolean }>("/api/dating/1on1/private-chat", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, through }), cache: "no-store", signal,
  }, 8000);
  if (!response.ok || body?.ok !== true) throw new Error("PRIVATE_READ_FAILED");
}

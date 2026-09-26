export const CHAT_MESSAGE_PAGE_SIZE = 50;

export type ChatMessage = {
  id: string; thread_id: string; sender_id: string; receiver_id: string;
  content: string; is_read: boolean; created_at: string; optimistic?: boolean;
};
export type ChatPagination = { older_cursor: string | null; has_more: boolean };

export function isChatPagination(value: unknown): value is ChatPagination {
  if (!value || typeof value !== "object") return false;
  const row = value as ChatPagination;
  return typeof row.has_more === "boolean" && (row.older_cursor === null || typeof row.older_cursor === "string") &&
    (!row.has_more || !!row.older_cursor);
}

export function sortChatMessages(messages: ChatMessage[]) {
  // ISO timestamps retain PostgreSQL microseconds; Date.parse alone loses tie precision.
  const micros = (value: string) => Number((value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  return messages.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || micros(a.created_at) - micros(b.created_at) || a.id.localeCompare(b.id));
}

export function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return sortChatMessages([...byId.values()]);
}

export function mergeLatestChatPage(
  current: { messages: ChatMessage[]; pagination?: ChatPagination },
  incoming: { messages: ChatMessage[]; pagination?: ChatPagination },
) {
  const overlap = incoming.messages.some((message) => current.messages.some((old) => old.id === message.id));
  // After a long absence, start a contiguous latest window. Older pages remain reachable.
  // Never stitch two disjoint windows together and silently skip the intervening messages.
  const preserveHistory = overlap && !!current.pagination;
  return {
    messages: mergeChatMessages(preserveHistory ? current.messages : current.messages.filter((row) => row.optimistic), incoming.messages),
    pagination: preserveHistory ? current.pagination : incoming.pagination,
  };
}

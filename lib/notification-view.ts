export type NotificationItem = {
  id: string;
  actor_id: string | null;
  type: string;
  post_id: string | null;
  is_read: boolean;
  created_at: string;
  actor_profile: { nickname: string | null } | null;
  title?: string | null;
  body?: string | null;
  link?: string | null;
};

/** An invalid response is a load failure, never an empty inbox. */
export function parseNotificationPage(value: unknown): { items: NotificationItem[]; unread_count: number } | null {
  if (!value || typeof value !== "object") return null;
  const data = value as { items?: NotificationItem[]; unread_count?: number };
  if (!Array.isArray(data.items) || !Number.isSafeInteger(data.unread_count) || (data.unread_count ?? -1) < 0) return null;
  const nullableText = (value: unknown) => value == null || typeof value === "string";
  const ids = new Set<string>();
  for (const item of data.items) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.is_read !== "boolean" ||
      typeof item.created_at !== "string" || !Number.isFinite(Date.parse(item.created_at)) ||
      ![item.title, item.body, item.link].every(nullableText) ||
      (item.actor_profile != null && (typeof item.actor_profile !== "object" || !nullableText(item.actor_profile.nickname)))) return null;
    ids.add(item.id);
  }
  return { items: data.items, unread_count: data.unread_count! };
}

/** Only internal routes; never feed script/protocol-relative URLs into router.push. */
export function notificationHref(link: string | null | undefined): string | null {
  if (!link || !link.startsWith("/") || link.startsWith("//") || /[\\\u0000-\u0020]/.test(link)) return null;
  try {
    const parsed = new URL(link, "https://notification.invalid");
    return parsed.origin === "https://notification.invalid" ? parsed.pathname + parsed.search + parsed.hash : null;
  } catch { return null; }
}

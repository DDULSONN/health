export const NOTIFICATION_COUNT_EVENT = "dating-notification-count";
export const NOTIFICATION_COUNT_INVALIDATED_EVENT = "dating-notification-count-invalidated";

export function isNotificationCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function publishNotificationCount(count: number) {
  if (typeof window !== "undefined" && isNotificationCount(count)) {
    window.dispatchEvent(new CustomEvent<number>(NOTIFICATION_COUNT_EVENT, { detail: count }));
  }
}

// Call after acknowledged writes, even if navigation has already unmounted the inbox.
export function invalidateNotificationCount() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIFICATION_COUNT_INVALIDATED_EVENT));
}

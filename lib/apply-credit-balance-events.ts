// Invalidate display-only balances. Never grant credits or trust a client-supplied count.
export const APPLY_CREDIT_BALANCE_CHANGED = "gymtools:apply-credit-balance-changed";

export function notifyApplyCreditBalanceChanged(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.dispatchEvent(new CustomEvent(APPLY_CREDIT_BALANCE_CHANGED, { detail: { userId } }));
  } catch { /* A display refresh must not turn a confirmed grant into an error. */ }
}

export function isApplyCreditBalanceChangeForUser(event: Event, userId: string): boolean {
  if (!(event instanceof CustomEvent)) return false;
  const detail: unknown = event.detail;
  return !!detail && typeof detail === "object" &&
    (detail as { userId?: unknown }).userId === userId;
}

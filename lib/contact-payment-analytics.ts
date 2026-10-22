// Internal diagnostics only. No profile/contact data or match IDs go to Google Analytics.
export type ContactPaymentEvent = "view_item" | "select_item";
export type ContactPaymentPlacement = "one_on_one_home" | "mypage_matching";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let fallbackSession = "";

export function contactPaymentPlacement(): ContactPaymentPlacement | null {
  if (typeof window === "undefined") return null;
  if (window.location.pathname === "/mypage") return "mypage_matching";
  if (window.location.pathname === "/community/dating/cards") return "one_on_one_home";
  return null;
}

function sessionId() {
  const key = "gymtools-contact-analytics-session-v1";
  // One browser session per KST day. DB deduplication also includes authenticated
  // user identity, so switching accounts must not suppress the other user's event.
  const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored && UUID.test(stored)) return `${stored}:${day}`;
  } catch { /* Private browsing can disable storage. */ }
  fallbackSession ||= crypto.randomUUID();
  try { window.sessionStorage.setItem(key, fallbackSession); } catch { /* Optional. */ }
  return `${fallbackSession}:${day}`;
}

export async function recordContactPaymentEvent(eventName: ContactPaymentEvent, matchId: string, amount: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const placement = contactPaymentPlacement();
    if (!placement || !UUID.test(matchId) || ![15000, 18000, 20000].includes(amount)) return false;
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch("/api/analytics/contact-exchange", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ eventName, matchId, amount, placement, sessionId: sessionId() }),
    });
    if (!response.ok || response.status === 204) return false;
    const body = await response.json();
    return body?.recorded === true;
  } catch {
    // Never reject into the checkout click handler, even if fetch/storage is broken.
    return false;
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

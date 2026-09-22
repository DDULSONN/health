import { isOnboardingEvent, type OnboardingEvent } from "@/lib/onboarding-funnel";

// Page-local/account-scoped deduplication. No new cookies, localStorage or SDK.
const attempted = new Set<string>();
export function trackOnboardingEvent(userId: string | null | undefined, event: OnboardingEvent): void {
  try {
    if (typeof window === "undefined" || !userId || !isOnboardingEvent(event)) return;
    const key = userId + ":" + event;
    if (attempted.has(key)) return;
    attempted.add(key);
    if (attempted.size > 128) attempted.delete(attempted.values().next().value!);
    // No retries and never awaited by registration/OTP. Identity comes from auth on the server.
    void fetch("/api/analytics/onboarding", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  } catch { /* Diagnostics must never interrupt registration, even with blocked browser APIs. */ }
}

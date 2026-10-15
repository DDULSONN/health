import { normalizeFailureOrderId, normalizePaymentFailureCode } from "@/lib/payment-guidance";

const inFlight = new Set<string>();

// Diagnostic only: never used as a source of payment/fulfillment status.
export async function reportPaymentFailure(rawOrderId: unknown, rawCode: unknown) {
  if (typeof window === "undefined") return;
  const orderId = normalizeFailureOrderId(rawOrderId);
  if (!orderId || inFlight.has(orderId)) return;
  // v1 marked even skipped/unsaved 204 responses as stored. Do not reuse those markers.
  const storageKey = `gymtools-payment-failure-v2:${orderId}`;
  try {
    if (window.sessionStorage.getItem(storageKey) === "1") return;
  } catch { /* Storage restrictions must not block recovery. */ }
  inFlight.add(orderId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch("/api/payments/toss/failure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      signal: controller.signal,
      body: JSON.stringify({ orderId, code: normalizePaymentFailureCode(rawCode) }),
    });
    const saved = response.ok && response.status !== 204 && (await response.json())?.recorded === true;
    if (saved) {
      try { window.sessionStorage.setItem(storageKey, "1"); } catch { /* Optional deduplication. */ }
    }
  } catch { /* The retry links must work even when analytics is unavailable. */ }
  finally { if (timer !== undefined) clearTimeout(timer); inFlight.delete(orderId); }
}

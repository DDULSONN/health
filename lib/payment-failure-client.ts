import { normalizeFailureOrderId, normalizePaymentFailureCode } from "@/lib/payment-guidance";

const inFlight = new Set<string>();

// Diagnostic only: never used as a source of payment/fulfillment status.
export async function reportPaymentFailure(rawOrderId: unknown, rawCode: unknown) {
  if (typeof window === "undefined") return;
  const orderId = normalizeFailureOrderId(rawOrderId);
  if (!orderId || inFlight.has(orderId)) return;
  const storageKey = `gymtools-payment-failure:${orderId}`;
  try {
    if (window.sessionStorage.getItem(storageKey) === "1") return;
  } catch { /* Storage restrictions must not block recovery. */ }
  inFlight.add(orderId);
  try {
    const response = await fetch("/api/payments/toss/failure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({ orderId, code: normalizePaymentFailureCode(rawCode) }),
    });
    if (response.ok) {
      try { window.sessionStorage.setItem(storageKey, "1"); } catch { /* Optional deduplication. */ }
    }
  } catch { /* The retry links must work even when analytics is unavailable. */ }
  finally { inFlight.delete(orderId); }
}

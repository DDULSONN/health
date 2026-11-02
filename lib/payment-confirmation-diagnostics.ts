import type { createAdminClient } from "@/lib/supabase/server";

export function getPaymentConfirmationFailureCode(error: unknown): string {
  try {
    const body = JSON.parse(error instanceof Error ? error.message : "") as { code?: unknown } | null;
    if (typeof body?.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(body.code)) return body.code;
  } catch { /* Provider text may contain sensitive data. Never persist it. */ }
  if (error instanceof Error && ["TypeError", "AbortError", "TimeoutError"].includes(error.name)) return "NETWORK_ERROR";
  return "UNKNOWN";
}

export function getPaymentConfirmationFailureMessage(code: string): string {
  const check = "승인 문자나 출금 내역이 있다면 다시 결제하지 말고, 결제센터에서 내역을 확인해 주세요. 해결되지 않으면 고객센터로 문의해 주세요.";
  return (code === "INVALID_UNREGISTERED_SUBMALL"
    ? "선택한 결제수단의 가맹점 설정 문제로 승인을 완료하지 못했어요. "
    : "결제 승인 결과를 확인하지 못했어요. ") + check;
}

// This is a diagnostic event, NOT proof that money did not move. Recovery first
// checks Toss DONE with matching order, key and amount before calling this.
export async function recordPaymentConfirmationFailure(
  admin: ReturnType<typeof createAdminClient>,
  order: { id: string; product_type: string },
  providerCode: string,
) {
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(providerCode) ? providerCode : "UNKNOWN";
  try {
    const result = await admin.from("payment_confirmation_failures").upsert({
      order_id: order.id, product_type: order.product_type, provider_code: code,
    }, { onConflict: "order_id", ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(1500));
    if (result.error) throw result.error;
  } catch {
    // Works during a phased SQL rollout. Do not fail/retry/cancel the order,
    // grant access, or expose the provider response when diagnostics fail.
    console.warn("[payment-confirmation-failure] storage unavailable", {
      orderId: order.id, productType: order.product_type, providerCode: code,
    });
  }
}

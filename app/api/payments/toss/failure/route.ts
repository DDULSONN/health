import { NextResponse } from "next/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeFailureOrderId, normalizePaymentFailureCode } from "@/lib/payment-guidance";

export async function POST(request: Request) {
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;
  try {
    const { user } = await getRequestAuthContext(request);
    if (!user) return new NextResponse(null, { status: 204 });
    const input = await request.text();
    if (input.length > 512) return new NextResponse(null, { status: 400 });
    const body = JSON.parse(input) as { orderId?: unknown; code?: unknown } | null;
    const orderId = normalizeFailureOrderId(body?.orderId);
    if (!orderId) return new NextResponse(null, { status: 400 });
    const code = normalizePaymentFailureCode(body?.code);
    const admin = createAdminClient();
    const order = await admin.from("toss_test_payment_orders")
      .select("id,product_type")
      .eq("toss_order_id", orderId)
      .eq("user_id", user.id)
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .maybeSingle();
    if (order.error || !order.data) return new NextResponse(null, { status: 204 });

    // A browser callback is untrusted. Store separately, once per order, and
    // NEVER update an order, cancel a payment, or grant/revoke a matching benefit.
    const result = await admin.from("payment_checkout_failures").upsert({
      order_id: order.data.id,
      user_id: user.id,
      product_type: order.data.product_type,
      provider_code: code,
      outcome: code === "PAY_PROCESS_CANCELED" ? "user_canceled" : "failed",
      source: "client_redirect",
    }, { onConflict: "order_id", ignoreDuplicates: true });
    if (result.error) {
      // Keep a minimal fallback log during migration; no phone, email, card
      // details, provider message or payment key is collected.
      console.warn("[payment-checkout-failure] storage unavailable", {
        orderId: order.data.id, productType: order.data.product_type, providerCode: code,
        storageCode: result.error.code,
      });
    }
  } catch {
    // Analytics failure must never interfere with payment recovery.
  }
  return new NextResponse(null, { status: 204 });
}

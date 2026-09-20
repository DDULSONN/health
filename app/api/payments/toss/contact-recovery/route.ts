import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeFailureOrderId } from "@/lib/payment-guidance";
import { getContactPaymentRecovery } from "@/lib/contact-payment-recovery";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
}

export async function GET(req: Request) {
  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) return json({ ok: false }, 401);
    const orderId = normalizeFailureOrderId(new URL(req.url).searchParams.get("orderId"));
    if (!orderId) return json({ ok: false }, 400);
    const result = await getContactPaymentRecovery(createAdminClient(), user.id, orderId);
    if (!result) return json({ ok: false }, 404);
    // Never send the provider payment key, checkout URL, raw order or phones on GET.
    return json({ ok: true, recovery: result.view });
  } catch {
    return json({ ok: false, message: "결제 상태를 확인하지 못했어요. 결제 내역을 먼저 확인해 주세요." }, 503);
  }
}

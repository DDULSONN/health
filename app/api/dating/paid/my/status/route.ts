import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

const columns = "id,status,display_mode,expires_at";
function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

// Read-only: no photo signing, applications, queue changes or payment fulfillment.
export async function GET(request: Request) {
  try {
    const { user } = await getRequestAuthContext(request);
    if (!user) return json(401, { error: "로그인 후 등록 상태를 확인해 주세요." });
    const admin = createAdminClient();
    const profile = await admin.from("profiles").select("is_banned").eq("user_id", user.id).maybeSingle();
    if (profile.error) return json(503, { error: "등록 상태를 확인하지 못했어요." });
    if (!profile.data || profile.data.is_banned) return json(403, { error: "계정 상태를 확인해 주세요." });
    const checkedAt = new Date().toISOString();
    const orderId = new URL(request.url).searchParams.get("orderId");
    if (orderId !== null) {
      if (!orderId.trim() || orderId.length > 200) return json(400, { error: "주문 정보를 확인해 주세요." });
      const order = await admin.from("toss_test_payment_orders")
        .select("product_ref_id,product_type,product_meta,status").eq("toss_order_id", orderId).eq("user_id", user.id).maybeSingle();
      if (order.error) return json(503, { error: "주문 상태를 확인하지 못했어요." });
      if (!order.data || order.data.product_type !== "paid_card" || order.data.status !== "paid" ||
        order.data.product_meta?.source === "open_card_reopen") return json(409, { error: "결제한 등록 정보를 확인해 주세요." });
      const card = await admin.from("dating_paid_cards").select(columns)
        .eq("id", order.data.product_ref_id).eq("user_id", user.id).maybeSingle();
      if (card.error) return json(503, { error: "등록 상태를 확인하지 못했어요." });
      return json(200, { card: card.data, checked_at: checkedAt });
    }
    const active = await admin.from("dating_paid_cards").select(columns).eq("user_id", user.id)
      .eq("status", "approved").gt("expires_at", checkedAt).order("expires_at", { ascending: false }).limit(1).maybeSingle();
    if (active.error) return json(503, { error: "등록 상태를 확인하지 못했어요." });
    if (active.data) return json(200, { card: active.data, checked_at: checkedAt });
    const latest = await admin.from("dating_paid_cards").select(columns).eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (latest.error) return json(503, { error: "등록 상태를 확인하지 못했어요." });
    return json(200, { card: latest.data, checked_at: checkedAt });
  } catch {
    return json(503, { error: "등록 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요." });
  }
}

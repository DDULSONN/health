import { getMoreViewStatusBySex } from "@/lib/dating-more-view";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type TossOrderRow = {
  id: string;
  product_type: "apply_credits" | "paid_card" | "more_view" | "city_view" | "one_on_one_contact_exchange" | "swipe_premium_30d" | string;
  product_meta: Record<string, unknown> | null;
  toss_order_id: string;
  order_name: string | null;
  amount: number;
  status: "ready" | "paid" | "failed" | "canceled" | string;
  approved_at: string | null;
  created_at: string;
  raw_response: {
    method?: string | null;
    receipt?: {
      url?: string | null;
    } | null;
  } | null;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function getKstDateString(now = new Date()): string {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const { client: supabase, user } = await getRequestAuthContext(req);
    if (!user) {
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }

    const admin = createAdminClient();
    const kstDate = getKstDateString();

    const [ordersRes, usageRes, creditsRes, moreViewStatus] = await Promise.all([
      supabase
        .from("toss_test_payment_orders")
        .select("id,product_type,product_meta,toss_order_id,order_name,amount,status,approved_at,created_at,raw_response")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("user_daily_apply_usage")
        .select("base_used")
        .eq("user_id", user.id)
        .eq("kst_date", kstDate)
        .maybeSingle(),
      supabase.from("user_apply_credits").select("credits").eq("user_id", user.id).maybeSingle(),
      getMoreViewStatusBySex(admin, user.id),
    ]);

    if (ordersRes.error || usageRes.error || creditsRes.error) {
      console.error(`[mypage-payments] ${requestId} query failed`, {
        orders: ordersRes.error,
        usage: usageRes.error,
        credits: creditsRes.error,
      });
      return json(500, { ok: false, code: "READ_FAILED", requestId, message: "결제 정보를 불러오지 못했습니다." });
    }

    const baseUsed = Math.max(0, Math.min(2, Number(usageRes.data?.base_used ?? 0)));
    const creditsRemaining = Math.max(0, Number(creditsRes.data?.credits ?? 0));
    const baseRemaining = Math.max(0, 2 - baseUsed);
    const orders = (ordersRes.data ?? []) as TossOrderRow[];

    return json(200, {
      ok: true,
      requestId,
      summary: {
        creditsRemaining,
        baseRemaining,
        moreViewMale: moreViewStatus.male,
        moreViewFemale: moreViewStatus.female,
      },
      orders: orders.map((row) => ({
        ...row,
        method: row.raw_response?.method ?? null,
        receiptUrl: row.raw_response?.receipt?.url ?? null,
      })),
    });
  } catch (error) {
    console.error(`[mypage-payments] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}

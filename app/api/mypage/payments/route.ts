import { getMoreViewStatusBySex } from "@/lib/dating-more-view";
import { getDailyBaseApplyLimit, getKstDateString, isKoreanWeekend } from "@/lib/dating-apply-limits";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type TossOrderRow = {
  id: string;
  product_ref_id: string | null;
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

const GENERIC_RESUMABLE_PRODUCTS = new Set([
  "apply_credits",
  "paid_card",
  "more_view",
  "city_view",
  "one_on_one_plus_7d",
  "one_on_one_plus_30d",
  "swipe_premium_30d",
  "dating_all_pass_30d",
]);

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
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
        .select("id,product_ref_id,product_type,product_meta,toss_order_id,order_name,amount,status,approved_at,created_at,raw_response")
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

    const baseLimit = getDailyBaseApplyLimit();
    const baseUsed = Math.max(0, Math.min(baseLimit, Number(usageRes.data?.base_used ?? 0)));
    const creditsRemaining = Math.max(0, Number(creditsRes.data?.credits ?? 0));
    const baseRemaining = Math.max(0, baseLimit - baseUsed);
    const orders = (ordersRes.data ?? []) as TossOrderRow[];
    const readyMatchIds = Array.from(
      new Set(
        orders
          .filter((order) => order.product_type === "one_on_one_contact_exchange" && order.status === "ready")
          .map((order) => order.product_ref_id)
          .filter((value): value is string => Boolean(value))
      )
    );
    const resumableMatchIds = new Set<string>();

    if (readyMatchIds.length > 0) {
      const matchesRes = await admin
        .from("dating_1on1_match_proposals")
        .select("id,source_user_id,candidate_user_id,state,contact_exchange_status")
        .in("id", readyMatchIds);

      if (matchesRes.error) {
        console.error(`[mypage-payments] ${requestId} resumable matches query failed`, matchesRes.error);
      } else {
        for (const match of matchesRes.data ?? []) {
          const isParticipant = match.source_user_id === user.id || match.candidate_user_id === user.id;
          const isAccepted = match.state === "mutual_accepted" || match.state === "candidate_accepted";
          const isPayable = match.contact_exchange_status === "none" || match.contact_exchange_status === "awaiting_applicant_payment";
          if (isParticipant && isAccepted && isPayable) resumableMatchIds.add(match.id);
        }
      }
    }

    const latestReadyOrderIdByMatch = new Map<string, string>();
    for (const order of orders) {
      if (
        order.product_type === "one_on_one_contact_exchange" &&
        order.status === "ready" &&
        order.product_ref_id &&
        !latestReadyOrderIdByMatch.has(order.product_ref_id)
      ) {
        latestReadyOrderIdByMatch.set(order.product_ref_id, order.id);
      }
    }

    return json(200, {
      ok: true,
      requestId,
      summary: {
        creditsRemaining,
        baseLimit,
        baseRemaining,
        weekendBenefitActive: isKoreanWeekend(),
        moreViewMale: moreViewStatus.male,
        moreViewFemale: moreViewStatus.female,
      },
      orders: orders.map((row) => ({
        ...row,
        method: row.raw_response?.method ?? null,
        receiptUrl: row.raw_response?.receipt?.url ?? null,
        canResume:
          row.product_type === "one_on_one_contact_exchange" &&
          row.status === "ready" &&
          Boolean(row.product_ref_id) &&
          latestReadyOrderIdByMatch.get(row.product_ref_id ?? "") === row.id &&
          resumableMatchIds.has(row.product_ref_id ?? ""),
        resumeMatchId:
          row.product_type === "one_on_one_contact_exchange" && resumableMatchIds.has(row.product_ref_id ?? "")
            ? row.product_ref_id
            : null,
        canResumeProduct:
          row.status === "ready" && GENERIC_RESUMABLE_PRODUCTS.has(row.product_type),
      })),
    });
  } catch (error) {
    console.error(`[mypage-payments] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}

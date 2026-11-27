import { getMoreViewStatusBySex } from "@/lib/dating-more-view";
import { getDailyBaseApplyLimit, getKstDateString, isKoreanWeekend } from "@/lib/dating-apply-limits";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { contactOrderDelivery, contactOrderMatchId, type ContactOrderMatch } from "@/lib/contact-payment-order-state";
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
  "dating_love_pass_30d",
]);

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" },
  });
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
        .eq("user_id", user.id)
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
    const contactMatchIds = Array.from(
      new Set(
        orders
          .filter((order) => order.status === "ready" || order.status === "paid")
          .map(contactOrderMatchId)
          .filter((id): id is string => id !== null)
      )
    );
    const resumableMatchIds = new Set<string>();
    const ownMatches = new Map<string, ContactOrderMatch>();

    if (contactMatchIds.length > 0) {
      const matchesRes = await admin
        .from("dating_1on1_match_proposals")
        .select("id,source_user_id,candidate_user_id,state,contact_exchange_status,contact_exchange_paid_by_user_id,contact_exchange_approved_at,contact_exchange_note")
        .in("id", contactMatchIds)
        .or(`source_user_id.eq.${user.id},candidate_user_id.eq.${user.id}`);

      if (matchesRes.error) {
        console.error(`[mypage-payments] ${requestId} resumable matches query failed`, matchesRes.error);
      } else {
        for (const match of matchesRes.data ?? []) {
          const isParticipant = match.source_user_id === user.id || match.candidate_user_id === user.id;
          if (!isParticipant) continue;
          ownMatches.set(match.id, match);
          const isAccepted = match.state === "mutual_accepted" || match.state === "candidate_accepted";
          const isPayable = match.contact_exchange_status === "none" || match.contact_exchange_status === "awaiting_applicant_payment";
          if (isAccepted && isPayable) resumableMatchIds.add(match.id);
        }
      }
    }

    const latestReadyOrderIdByMatch = new Map<string, string>();
    for (const order of orders) {
      const matchId = contactOrderMatchId(order);
      if (
        matchId &&
        order.status === "ready" &&
        !latestReadyOrderIdByMatch.has(matchId)
      ) {
        latestReadyOrderIdByMatch.set(matchId, order.id);
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
      orders: orders.map(({ raw_response, ...row }) => {
        const matchId = contactOrderMatchId(row);
        const canResume =
          row.status === "ready" &&
          matchId !== null &&
          latestReadyOrderIdByMatch.get(matchId) === row.id &&
          resumableMatchIds.has(matchId);
        const delivery = contactOrderDelivery(row, matchId ? ownMatches.get(matchId) : undefined, user.id);
        return {
          ...row,
          method: raw_response?.method ?? null,
          receiptUrl: raw_response?.receipt?.url ?? null,
          canResume,
          resumeMatchId: canResume ? matchId : null,
          canResumeProduct: row.status === "ready" && GENERIC_RESUMABLE_PRODUCTS.has(row.product_type),
          ...(delivery ? { contactDelivery: delivery.status, contactDeliveryMatchId: delivery.matchId } : {}),
        };
      }),
    });
  } catch (error) {
    console.error(`[mypage-payments] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}

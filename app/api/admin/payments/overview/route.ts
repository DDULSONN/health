import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAllowedAdmin(userId: string, email?: string | null) {
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) {
    return allowlist.includes(userId);
  }
  return isAdminEmail(email);
}

type ProfileRow = {
  user_id: string;
  nickname: string | null;
};

type TossOrderRow = {
  id: string;
  user_id: string;
  product_type: "apply_credits" | "paid_card" | "more_view" | string;
  product_meta: Record<string, unknown> | null;
  toss_order_id: string;
  order_name: string | null;
  amount: number;
  status: string;
  payment_key: string | null;
  approved_at: string | null;
  created_at: string;
  raw_response: { method?: string | null } | null;
};

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json(401, {
        ok: false,
        code: "UNAUTHORIZED",
        requestId,
        message: "로그인이 필요합니다.",
      });
    }

    if (!isAllowedAdmin(user.id, user.email)) {
      return json(403, {
        ok: false,
        code: "FORBIDDEN",
        requestId,
        message: "권한이 없습니다.",
      });
    }

    const admin = createAdminClient();

    const [
      applyCreditsPendingRes,
      paidCardsPendingRes,
      moreViewPendingRes,
      swipeSubscriptionsPendingRes,
      oneOnOneContactPendingRes,
      recentOrdersRes,
    ] = await Promise.all([
      admin.from("apply_credit_orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("dating_paid_cards").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("dating_more_view_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("dating_swipe_subscriptions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin
        .from("dating_1on1_match_proposals")
        .select("id", { count: "exact", head: true })
        .eq("state", "mutual_accepted")
        .eq("contact_exchange_status", "payment_pending_admin"),
      admin
        .from("toss_test_payment_orders")
        .select("id,user_id,product_type,product_meta,toss_order_id,order_name,amount,status,payment_key,approved_at,created_at,raw_response")
        .order("approved_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    const countErrors = [
      applyCreditsPendingRes.error,
      paidCardsPendingRes.error,
      moreViewPendingRes.error,
      swipeSubscriptionsPendingRes.error,
      oneOnOneContactPendingRes.error,
      recentOrdersRes.error,
    ].filter(Boolean);

    if (countErrors.length > 0) {
      console.error(`[admin-payments-overview] ${requestId} query failed`, countErrors);
      return json(500, {
        ok: false,
        code: "OVERVIEW_FAILED",
        requestId,
        message: "결제센터 데이터를 불러오지 못했습니다.",
      });
    }

    const orders = (recentOrdersRes.data ?? []) as TossOrderRow[];
    const userIds = [...new Set(orders.map((row) => row.user_id).filter(Boolean))];
    const nicknameMap = new Map<string, string | null>();

    if (userIds.length > 0) {
      const profilesRes = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
      if (!profilesRes.error) {
        for (const row of (profilesRes.data ?? []) as ProfileRow[]) {
          nicknameMap.set(row.user_id, row.nickname ?? null);
        }
      }
    }

    return json(200, {
      ok: true,
      requestId,
      summary: {
        applyCreditsPending: applyCreditsPendingRes.count ?? 0,
        paidCardsPending: paidCardsPendingRes.count ?? 0,
        moreViewPending: moreViewPendingRes.count ?? 0,
        swipeSubscriptionsPending: swipeSubscriptionsPendingRes.count ?? 0,
        oneOnOneContactPending: oneOnOneContactPendingRes.count ?? 0,
        recentPaidCount: orders.filter((row) => row.status === "paid").length,
        recentReadyCount: orders.filter((row) => row.status === "ready").length,
      },
      orders: orders.map((row) => ({
        ...row,
        nickname: nicknameMap.get(row.user_id) ?? null,
        method: row.raw_response?.method ?? null,
      })),
    });
  } catch (error) {
    console.error(`[admin-payments-overview] ${requestId} unhandled`, error);
    return json(500, {
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
      requestId,
      message: "서버 오류가 발생했습니다.",
    });
  }
}

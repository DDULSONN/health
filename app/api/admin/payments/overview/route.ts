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
  product_type: "apply_credits" | "paid_card" | "more_view" | "city_view" | "one_on_one_contact_exchange" | "swipe_premium_30d" | string;
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

type FunnelOrderRow = {
  product_type: string;
  amount: number;
  status: string;
  created_at: string;
};

const PAYMENT_PRODUCT_LABELS: Record<string, string> = {
  apply_credits: "지원권",
  paid_card: "대기 없이 등록",
  more_view: "이상형 더보기",
  city_view: "가까운 이상형",
  one_on_one_contact_exchange: "1:1 번호교환",
  one_on_one_plus_30d: "1:1 매칭 플러스",
  swipe_premium_30d: "빠른매칭 플러스",
  love_fortune_detail: "연애운 상세 분석",
  account_unban: "이용 제한 해제",
};

async function fetchFunnelOrders(admin: ReturnType<typeof createAdminClient>, sinceIso: string) {
  const rows: FunnelOrderRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < 50000; offset += pageSize) {
    const result = await admin
      .from("toss_test_payment_orders")
      .select("product_type,amount,status,created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (result.error) throw result.error;

    const batch = (result.data ?? []) as FunnelOrderRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}

function buildFunnel(orders: FunnelOrderRow[], sinceMs: number) {
  const grouped = new Map<string, FunnelOrderRow[]>();
  for (const order of orders) {
    if (new Date(order.created_at).getTime() < sinceMs) continue;
    const current = grouped.get(order.product_type) ?? [];
    current.push(order);
    grouped.set(order.product_type, current);
  }

  return Array.from(grouped.entries())
    .map(([productType, productOrders]) => {
      const paidOrders = productOrders.filter((order) => order.status === "paid");
      const readyCount = productOrders.filter((order) => order.status === "ready").length;
      const failedCount = productOrders.filter((order) => order.status === "failed" || order.status === "canceled").length;
      const checkoutCount = productOrders.length;
      return {
        productType,
        label: PAYMENT_PRODUCT_LABELS[productType] ?? productType,
        checkoutCount,
        paidCount: paidOrders.length,
        readyCount,
        failedCount,
        revenueKrw: paidOrders.reduce((sum, order) => sum + Math.max(0, Number(order.amount) || 0), 0),
        conversionRate: checkoutCount > 0 ? Math.round((paidOrders.length / checkoutCount) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.revenueKrw - a.revenueKrw || b.checkoutCount - a.checkoutCount);
}

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
      funnelOrders,
    ] = await Promise.all([
      admin.from("apply_credit_orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("dating_paid_cards").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("dating_more_view_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("dating_swipe_subscription_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
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
      fetchFunnelOrders(admin, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
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
      funnel: {
        recent7d: buildFunnel(funnelOrders, Date.now() - 7 * 24 * 60 * 60 * 1000),
        recent30d: buildFunnel(funnelOrders, Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
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

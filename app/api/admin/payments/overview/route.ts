import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_PERIODS = new Set([7, 30, 90]);

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
  return allowlist.length > 0 ? allowlist.includes(userId) : isAdminEmail(email);
}

function parsePeriodDays(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("days") ?? "30");
  return ALLOWED_PERIODS.has(value) ? value : 30;
}

type ProfileRow = {
  user_id: string;
  nickname: string | null;
};

type TossOrderRow = {
  id: string;
  user_id: string;
  product_type: string;
  product_meta: Record<string, unknown> | null;
  toss_order_id: string;
  order_name: string | null;
  amount: number;
  status: string;
  payment_key: string | null;
  approved_at: string | null;
  created_at: string;
  raw_response: Record<string, unknown> | null;
};

type FunnelEventRow = {
  user_id: string | null;
  session_id: string | null;
  event_name: "view_item" | "select_item" | string;
  product_type: string;
  placement: string | null;
  created_at: string;
};

const PAYMENT_PRODUCT_LABELS: Record<string, string> = {
  apply_credits: "오픈카드 지원권",
  paid_card: "대기 없이 등록",
  more_view: "이상형 더보기",
  city_view: "가까운 이상형",
  one_on_one_contact_exchange: "1:1 번호교환",
  one_on_one_priority_24h: "1:1 우선 추천",
  one_on_one_plus_7d: "1:1 매칭 플러스 7일",
  one_on_one_plus_30d: "1:1 매칭 플러스",
  swipe_premium_30d: "빠른매칭 플러스",
  dating_all_pass_30d: "매칭 올패스",
  open_card_repost: "오픈카드 재등록",
  love_fortune_detail: "연애운 상세 분석",
  account_unban: "이용 제한 해제",
};

function getProductLabel(productType: string) {
  return PAYMENT_PRODUCT_LABELS[productType] ?? productType;
}

function getPaymentMethod(rawResponse: Record<string, unknown> | null) {
  if (!rawResponse) return "기타";
  const direct = typeof rawResponse.method === "string" ? rawResponse.method.trim() : "";
  if (direct) return direct;
  const latest = rawResponse.latest_toss_response;
  if (latest && typeof latest === "object") {
    const method = (latest as { method?: unknown }).method;
    if (typeof method === "string" && method.trim()) return method.trim();
  }
  return "기타";
}

function getRefundAmount(order: TossOrderRow) {
  const raw = order.raw_response;
  const adminRefund = raw?.admin_refund;
  if (adminRefund && typeof adminRefund === "object") {
    const value = Number((adminRefund as { canceledTotal?: unknown }).canceledTotal ?? 0);
    if (Number.isFinite(value)) return Math.min(Math.max(0, value), Math.max(0, order.amount));
  }
  return order.status === "canceled" && order.payment_key ? Math.max(0, order.amount) : 0;
}

function getPaidAt(order: TossOrderRow) {
  if (!order.payment_key && order.status !== "paid") return null;
  return order.approved_at ?? (order.status === "paid" ? order.created_at : null);
}

function inWindow(value: string | null, startMs: number, endMs: number) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= startMs && time < endMs;
}

function changeRate(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function kstDateKey(value: string | number | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

async function fetchFunnelOrders(admin: ReturnType<typeof createAdminClient>, sinceIso: string) {
  const rows = new Map<string, TossOrderRow>();
  const pageSize = 1000;
  const select =
    "id,user_id,product_type,product_meta,toss_order_id,order_name,amount,status,payment_key,approved_at,created_at,raw_response";

  for (const column of ["created_at", "approved_at"] as const) {
    for (let offset = 0; offset < 100000; offset += pageSize) {
      const result = await admin
        .from("toss_test_payment_orders")
        .select(select)
        .gte(column, sinceIso)
        .order(column, { ascending: false, nullsFirst: false })
        .range(offset, offset + pageSize - 1);
      if (result.error) throw result.error;
      const batch = (result.data ?? []) as TossOrderRow[];
      for (const row of batch) rows.set(row.id, row);
      if (batch.length < pageSize) break;
    }
  }

  return [...rows.values()];
}

function isMissingFunnelTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("payment_funnel_events");
}

async function fetchFunnelEvents(admin: ReturnType<typeof createAdminClient>, sinceIso: string) {
  const rows: FunnelEventRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < 100000; offset += pageSize) {
    const result = await admin
      .from("payment_funnel_events")
      .select("user_id,session_id,event_name,product_type,placement,created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (result.error) {
      if (isMissingFunnelTableError(result.error)) return { rows: [], available: false };
      throw result.error;
    }
    const batch = (result.data ?? []) as FunnelEventRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return { rows, available: true };
}

function buildPeriodSummary(orders: TossOrderRow[], startMs: number, endMs: number) {
  const createdOrders = orders.filter((order) => inWindow(order.created_at, startMs, endMs));
  const paidOrders = orders.filter((order) => inWindow(getPaidAt(order), startMs, endMs));
  const activePaidOrders = paidOrders.filter((order) => order.status === "paid");
  const completedCreatedOrders = createdOrders.filter((order) => order.status === "paid");
  const grossRevenueKrw = activePaidOrders.reduce((sum, order) => sum + Math.max(0, order.amount), 0);
  const refundKrw = paidOrders.reduce((sum, order) => sum + getRefundAmount(order), 0);
  const revenueKrw = activePaidOrders.reduce(
    (sum, order) => sum + Math.max(0, order.amount - getRefundAmount(order)),
    0
  );
  const uniquePayers = new Set(activePaidOrders.map((order) => order.user_id)).size;
  const payerCounts = new Map<string, number>();
  for (const order of activePaidOrders) {
    payerCounts.set(order.user_id, (payerCounts.get(order.user_id) ?? 0) + 1);
  }

  return {
    revenueKrw,
    grossRevenueKrw,
    refundKrw,
    paidCount: activePaidOrders.length,
    completedCheckoutCount: completedCreatedOrders.length,
    checkoutCount: createdOrders.length,
    readyCount: createdOrders.filter((order) => order.status === "ready").length,
    failedCount: createdOrders.filter((order) => order.status === "failed").length,
    canceledCount: createdOrders.filter((order) => order.status === "canceled").length,
    uniquePayers,
    repeatPayers: [...payerCounts.values()].filter((count) => count >= 2).length,
    averageOrderKrw: activePaidOrders.length > 0 ? Math.round(revenueKrw / activePaidOrders.length) : 0,
    conversionRate:
      createdOrders.length > 0 ? Math.round((completedCreatedOrders.length / createdOrders.length) * 1000) / 10 : 0,
  };
}

function buildProducts(
  orders: TossOrderRow[],
  events: FunnelEventRow[],
  startMs: number,
  endMs: number,
  previousStartMs: number
) {
  const productTypes = new Set<string>();
  for (const order of orders) productTypes.add(order.product_type);
  for (const event of events) productTypes.add(event.product_type);

  return [...productTypes]
    .map((productType) => {
      const currentCreated = orders.filter(
        (order) => order.product_type === productType && inWindow(order.created_at, startMs, endMs)
      );
      const currentPaid = orders.filter(
        (order) => order.product_type === productType && order.status === "paid" && inWindow(getPaidAt(order), startMs, endMs)
      );
      const completedCurrentCreated = currentCreated.filter((order) => order.status === "paid");
      const previousPaid = orders.filter(
        (order) =>
          order.product_type === productType &&
          order.status === "paid" &&
          inWindow(getPaidAt(order), previousStartMs, startMs)
      );
      const currentEvents = events.filter(
        (event) => event.product_type === productType && inWindow(event.created_at, startMs, endMs)
      );
      const placementCounts = new Map<string, number>();
      for (const event of currentEvents) {
        if (event.placement) placementCounts.set(event.placement, (placementCounts.get(event.placement) ?? 0) + 1);
      }
      for (const order of currentCreated) {
        const placement = String(order.product_meta?.offerPlacement ?? "").trim();
        if (placement) placementCounts.set(placement, (placementCounts.get(placement) ?? 0) + 1);
      }
      const currentRevenueKrw = currentPaid.reduce(
        (sum, order) => sum + Math.max(0, order.amount - getRefundAmount(order)),
        0
      );
      const previousRevenueKrw = previousPaid.reduce(
        (sum, order) => sum + Math.max(0, order.amount - getRefundAmount(order)),
        0
      );
      const payerCounts = new Map<string, number>();
      for (const order of currentPaid) payerCounts.set(order.user_id, (payerCounts.get(order.user_id) ?? 0) + 1);
      const viewCount = currentEvents.filter((event) => event.event_name === "view_item").length;
      const selectCount = currentEvents.filter((event) => event.event_name === "select_item").length;

      return {
        productType,
        label: getProductLabel(productType),
        viewCount,
        selectCount,
        checkoutCount: currentCreated.length,
        paidCount: currentPaid.length,
        completedCheckoutCount: completedCurrentCreated.length,
        readyCount: currentCreated.filter((order) => order.status === "ready").length,
        failedCount: currentCreated.filter((order) => order.status === "failed").length,
        canceledCount: currentCreated.filter((order) => order.status === "canceled").length,
        uniquePayers: payerCounts.size,
        repeatPayers: [...payerCounts.values()].filter((count) => count >= 2).length,
        topPlacement: [...placementCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        revenueKrw: currentRevenueKrw,
        previousRevenueKrw,
        revenueChangeRate: changeRate(currentRevenueKrw, previousRevenueKrw),
        conversionRate:
          currentCreated.length > 0 ? Math.round((completedCurrentCreated.length / currentCreated.length) * 1000) / 10 : 0,
        viewToSelectRate: viewCount > 0 ? Math.round((selectCount / viewCount) * 1000) / 10 : null,
        selectToCheckoutRate:
          selectCount > 0 ? Math.round((currentCreated.length / selectCount) * 1000) / 10 : null,
      };
    })
    .filter((item) => item.checkoutCount > 0 || item.paidCount > 0 || item.viewCount > 0)
    .sort((a, b) => b.revenueKrw - a.revenueKrw || b.checkoutCount - a.checkoutCount);
}

function buildDaily(orders: TossOrderRow[], startMs: number, endMs: number) {
  const buckets = new Map<string, { date: string; revenueKrw: number; paidCount: number; checkoutCount: number }>();
  for (let cursor = startMs; cursor < endMs; cursor += DAY_MS) {
    const date = kstDateKey(cursor);
    buckets.set(date, { date, revenueKrw: 0, paidCount: 0, checkoutCount: 0 });
  }

  for (const order of orders) {
    if (inWindow(order.created_at, startMs, endMs)) {
      const bucket = buckets.get(kstDateKey(order.created_at));
      if (bucket) bucket.checkoutCount += 1;
    }
    const paidAt = getPaidAt(order);
    if (order.status === "paid" && inWindow(paidAt, startMs, endMs) && paidAt) {
      const bucket = buckets.get(kstDateKey(paidAt));
      if (bucket) {
        bucket.paidCount += 1;
        bucket.revenueKrw += Math.max(0, order.amount - getRefundAmount(order));
      }
    }
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function buildMethods(orders: TossOrderRow[], startMs: number, endMs: number) {
  const methods = new Map<string, { method: string; paidCount: number; revenueKrw: number }>();
  for (const order of orders) {
    if (order.status !== "paid" || !inWindow(getPaidAt(order), startMs, endMs)) continue;
    const method = getPaymentMethod(order.raw_response);
    const current = methods.get(method) ?? { method, paidCount: 0, revenueKrw: 0 };
    current.paidCount += 1;
    current.revenueKrw += Math.max(0, order.amount - getRefundAmount(order));
    methods.set(method, current);
  }
  return [...methods.values()].sort((a, b) => b.revenueKrw - a.revenueKrw);
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }
    if (!isAllowedAdmin(user.id, user.email)) {
      return json(403, { ok: false, code: "FORBIDDEN", requestId, message: "관리자 권한이 없습니다." });
    }

    const days = parsePeriodDays(request);
    const endMs = Date.now();
    const startMs = endMs - days * DAY_MS;
    const previousStartMs = startMs - days * DAY_MS;
    const admin = createAdminClient();

    const [
      applyCreditsPendingRes,
      paidCardsPendingRes,
      moreViewPendingRes,
      swipeSubscriptionsPendingRes,
      oneOnOneContactPendingRes,
      recentOrdersRes,
      orders,
      funnelEventResult,
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
        .select(
          "id,user_id,product_type,product_meta,toss_order_id,order_name,amount,status,payment_key,approved_at,created_at,raw_response"
        )
        .order("created_at", { ascending: false })
        .limit(30),
      fetchFunnelOrders(admin, new Date(previousStartMs).toISOString()),
      fetchFunnelEvents(admin, new Date(previousStartMs).toISOString()),
    ]);

    const queryErrors = [
      applyCreditsPendingRes.error,
      paidCardsPendingRes.error,
      moreViewPendingRes.error,
      swipeSubscriptionsPendingRes.error,
      oneOnOneContactPendingRes.error,
      recentOrdersRes.error,
    ].filter(Boolean);
    if (queryErrors.length > 0) {
      console.error(`[admin-payments-overview] ${requestId} query failed`, queryErrors);
      return json(500, {
        ok: false,
        code: "OVERVIEW_FAILED",
        requestId,
        message: "결제센터 데이터를 불러오지 못했습니다.",
      });
    }

    const recentOrders = (recentOrdersRes.data ?? []) as TossOrderRow[];
    const userIds = [...new Set(recentOrders.map((row) => row.user_id).filter(Boolean))];
    const nicknameMap = new Map<string, string | null>();
    if (userIds.length > 0) {
      const profilesRes = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
      if (!profilesRes.error) {
        for (const row of (profilesRes.data ?? []) as ProfileRow[]) nicknameMap.set(row.user_id, row.nickname);
      }
    }

    const current = buildPeriodSummary(orders, startMs, endMs);
    const previous = buildPeriodSummary(orders, previousStartMs, startMs);

    return json(200, {
      ok: true,
      requestId,
      period: {
        days,
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString(),
        previousStartAt: new Date(previousStartMs).toISOString(),
      },
      summary: {
        applyCreditsPending: applyCreditsPendingRes.count ?? 0,
        paidCardsPending: paidCardsPendingRes.count ?? 0,
        moreViewPending: moreViewPendingRes.count ?? 0,
        swipeSubscriptionsPending: swipeSubscriptionsPendingRes.count ?? 0,
        oneOnOneContactPending: oneOnOneContactPendingRes.count ?? 0,
        recentPaidCount: current.paidCount,
        recentReadyCount: current.readyCount,
      },
      overview: {
        current,
        previous,
        changes: {
          revenue: changeRate(current.revenueKrw, previous.revenueKrw),
          paidCount: changeRate(current.paidCount, previous.paidCount),
          uniquePayers: changeRate(current.uniquePayers, previous.uniquePayers),
          conversion: Math.round((current.conversionRate - previous.conversionRate) * 10) / 10,
        },
      },
      trackingAvailable: funnelEventResult.available,
      products: buildProducts(orders, funnelEventResult.rows, startMs, endMs, previousStartMs),
      daily: buildDaily(orders, startMs, endMs),
      methods: buildMethods(orders, startMs, endMs),
      orders: recentOrders.map((row) => ({
        ...row,
        nickname: nicknameMap.get(row.user_id) ?? null,
        method: getPaymentMethod(row.raw_response),
      })),
    });
  } catch (error) {
    console.error(`[admin-payments-overview] ${requestId} unhandled`, error);
    return json(500, {
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
      requestId,
      message: "결제센터를 불러오는 중 서버 오류가 발생했습니다.",
    });
  }
}

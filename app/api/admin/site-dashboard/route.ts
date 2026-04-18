import { requireAdminRoute } from "@/lib/admin-route";
import {
  countCumulativeOpenCardMatches,
  countCumulativeSwipeMatches,
  fetchRecentSwipeMatchTimestampRows,
} from "@/lib/dating-match-metrics";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

type FeatureKey =
  | "new_users"
  | "open_card_created"
  | "open_card_applied"
  | "paid_card_created"
  | "paid_card_applied"
  | "one_on_one_created"
  | "more_view_requested"
  | "city_view_requested"
  | "swipe_likes"
  | "swipe_matches"
  | "apply_credit_orders"
  | "support_inquiries"
  | "cert_requests"
  | "bodybattle_entries"
  | "bodybattle_votes";

type TimestampRow = {
  created_at?: string | null;
};

type Recent7dBucket = {
  dateKey: string;
  label: string;
  counts: Record<FeatureKey, number>;
};

const FEATURE_CONFIG: Array<{ key: FeatureKey; label: string; table: string; timestampColumn?: string }> = [
  { key: "new_users", label: "신규 가입", table: "profiles" },
  { key: "open_card_created", label: "오픈카드 등록", table: "dating_cards" },
  { key: "open_card_applied", label: "오픈카드 지원", table: "dating_card_applications" },
  { key: "paid_card_created", label: "유료카드 등록", table: "dating_paid_cards" },
  { key: "paid_card_applied", label: "유료카드 지원", table: "dating_paid_card_applications" },
  { key: "one_on_one_created", label: "1:1 소개팅 신청", table: "dating_1on1_cards" },
  { key: "more_view_requested", label: "이상형 더보기 신청", table: "dating_more_view_requests" },
  { key: "city_view_requested", label: "가까운 이상형 신청", table: "dating_city_view_requests" },
  { key: "swipe_likes", label: "빠른매칭 라이크", table: "dating_card_swipes" },
  { key: "swipe_matches", label: "빠른매칭 매치", table: "dating_card_swipe_matches" },
  { key: "apply_credit_orders", label: "지원권 주문", table: "apply_credit_orders" },
  { key: "support_inquiries", label: "1:1 문의", table: "support_inquiries" },
  { key: "cert_requests", label: "3대 인증 신청", table: "cert_requests" },
  { key: "bodybattle_entries", label: "바디배틀 참가", table: "bodybattle_entries" },
  { key: "bodybattle_votes", label: "바디배틀 투표", table: "bodybattle_votes" },
];

function getKstDayStart(dayOffset = 0) {
  const shiftedNow = new Date(Date.now() + KST_OFFSET_MS);
  shiftedNow.setUTCDate(shiftedNow.getUTCDate() + dayOffset);
  shiftedNow.setUTCHours(0, 0, 0, 0);
  return new Date(shiftedNow.getTime() - KST_OFFSET_MS);
}

function getKstDateKey(iso: string) {
  const shifted = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getKstDateLabel(date: Date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${month}.${day}`;
}

function isMissingSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("column")
  );
}

async function fetchExactCountSafe(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const result = await query;
  if (result.error) {
    if (isMissingSchemaError(result.error)) return 0;
    throw result.error;
  }
  return result.count ?? 0;
}

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
) {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const page = await fetchPage(from, to);
    if (page.error) {
      if (isMissingSchemaError(page.error)) return [] as T[];
      throw page.error;
    }
    const rows = page.data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

async function fetchRecentTimestampRows(
  admin: SupabaseClient,
  table: string,
  sinceIso: string,
  timestampColumn = "created_at"
) {
  return fetchAllRows<TimestampRow>((from, to) =>
    admin
      .from(table)
      .select(timestampColumn)
      .gte(timestampColumn, sinceIso)
      .order(timestampColumn, { ascending: true })
      .range(from, to) as PromiseLike<{ data: TimestampRow[] | null; error: unknown }>
  );
}

async function fetchIdsByStatus(
  admin: SupabaseClient,
  table: string,
  status: string
) {
  const rows = await fetchAllRows<{ id: string }>((from, to) =>
    admin.from(table).select("id").eq("status", status).range(from, to) as PromiseLike<{
      data: { id: string }[] | null;
      error: unknown;
    }>
  );
  return rows.map((row) => row.id).filter((value) => typeof value === "string" && value.length > 0);
}

async function fetchCountByIdChunks(
  admin: SupabaseClient,
  table: string,
  idColumn: string,
  ids: string[]
) {
  if (ids.length === 0) return 0;

  let total = 0;
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500);
    total += await fetchExactCountSafe(
      admin.from(table).select("id", { count: "exact", head: true }).in(idColumn, chunk)
    );
  }
  return total;
}

export async function GET() {
  const requestId = crypto.randomUUID();
  const adminGuard = await requireAdminRoute();
  if (!adminGuard.ok) return adminGuard.response;

  try {
    const { admin } = adminGuard;
    const todayStart = getKstDayStart(0);
    const tomorrowStart = getKstDayStart(1);
    const weekStart = getKstDayStart(-6);
    const nowIso = new Date().toISOString();
    const todayStartIso = todayStart.toISOString();
    const tomorrowStartIso = tomorrowStart.toISOString();
    const weekStartIso = weekStart.toISOString();

    const featureRows = await Promise.all(
      FEATURE_CONFIG.map(async (feature) => ({
        key: feature.key,
        label: feature.label,
        rows:
          feature.key === "swipe_matches"
            ? await fetchRecentSwipeMatchTimestampRows(admin, weekStartIso)
            : await fetchRecentTimestampRows(admin, feature.table, weekStartIso, feature.timestampColumn),
      }))
    );

    const dailyKeys: string[] = [];
    const recent7d: Recent7dBucket[] = [];
    for (let offset = -6; offset <= 0; offset += 1) {
      const dayStart = getKstDayStart(offset);
      const key = getKstDateKey(dayStart.toISOString());
      dailyKeys.push(key);
      recent7d.push({
        dateKey: key,
        label: getKstDateLabel(dayStart),
        counts: Object.fromEntries(FEATURE_CONFIG.map((feature) => [feature.key, 0])) as Record<FeatureKey, number>,
      });
    }

    const recent7dByKey = new Map(recent7d.map((item) => [item.dateKey, item]));

    for (const feature of featureRows) {
      for (const row of feature.rows) {
        const createdAt = typeof row.created_at === "string" ? row.created_at : null;
        if (!createdAt) continue;
        const dateKey = getKstDateKey(createdAt);
        const bucket = recent7dByKey.get(dateKey);
        if (!bucket) continue;
        bucket.counts[feature.key] += 1;
      }
    }

    const today = Object.fromEntries(
      FEATURE_CONFIG.map((feature) => [
        feature.key,
        recent7d[recent7d.length - 1]?.counts[feature.key] ?? 0,
      ])
    ) as Record<FeatureKey, number>;

    const todayTopFeatures = FEATURE_CONFIG.map((feature) => ({
      key: feature.key,
      label: feature.label,
      count: today[feature.key] ?? 0,
    }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"))
      .slice(0, 8);

    const [publicOpenCardIds, publicPaidCardIds] = await Promise.all([
      fetchIdsByStatus(admin, "dating_cards", "public"),
      fetchIdsByStatus(admin, "dating_paid_cards", "approved"),
    ]);

    const [publicOpenCardApplicationCount, publicPaidCardApplicationCount] = await Promise.all([
      fetchCountByIdChunks(admin, "dating_card_applications", "card_id", publicOpenCardIds),
      fetchCountByIdChunks(admin, "dating_paid_card_applications", "paid_card_id", publicPaidCardIds),
    ]);

    const [
      totalUsers,
      adminUsers,
      phoneVerifiedUsers,
      swipeVisibleUsers,
      publicOpenCards,
      pendingOpenCards,
      totalOpenCardApplications,
      publicPaidCards,
      totalPaidCardApplications,
      approvedOneOnOneCards,
      pendingOneOnOneCards,
      activeMoreView,
      activeCityView,
      openSupport,
      totalSupportInquiries,
      answeredSupportTotal,
      pendingCertRequests,
      approvedCertRequests,
      pendingApplyCreditOrders,
      approvedApplyCreditOrders,
      pendingSwipeSubscriptions,
      activeSwipeSubscriptions,
      totalOpenCardMatches,
      totalSwipeMatches,
      todayAnsweredSupport,
    ] = await Promise.all([
      fetchExactCountSafe(admin.from("profiles").select("id", { count: "exact", head: true })),
      fetchExactCountSafe(admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin")),
      fetchExactCountSafe(admin.from("profiles").select("id", { count: "exact", head: true }).eq("phone_verified", true)),
      fetchExactCountSafe(admin.from("profiles").select("id", { count: "exact", head: true }).neq("swipe_profile_visible", false)),
      fetchExactCountSafe(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("status", "public")),
      fetchExactCountSafe(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("status", "pending")),
      fetchExactCountSafe(admin.from("dating_card_applications").select("id", { count: "exact", head: true })),
      fetchExactCountSafe(admin.from("dating_paid_cards").select("id", { count: "exact", head: true }).eq("status", "approved")),
      fetchExactCountSafe(admin.from("dating_paid_card_applications").select("id", { count: "exact", head: true })),
      fetchExactCountSafe(admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).eq("status", "approved")),
      fetchExactCountSafe(admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).in("status", ["submitted", "reviewing"])),
      fetchExactCountSafe(
        admin.from("dating_more_view_requests").select("id", { count: "exact", head: true }).eq("status", "approved").gt("access_expires_at", nowIso)
      ),
      fetchExactCountSafe(
        admin.from("dating_city_view_requests").select("id", { count: "exact", head: true }).eq("status", "approved").gt("access_expires_at", nowIso)
      ),
      fetchExactCountSafe(admin.from("support_inquiries").select("id", { count: "exact", head: true }).eq("status", "open")),
      fetchExactCountSafe(admin.from("support_inquiries").select("id", { count: "exact", head: true })),
      fetchExactCountSafe(admin.from("support_inquiries").select("id", { count: "exact", head: true }).in("status", ["answered", "closed"])),
      fetchExactCountSafe(admin.from("cert_requests").select("id", { count: "exact", head: true }).eq("status", "pending")),
      fetchExactCountSafe(admin.from("cert_requests").select("id", { count: "exact", head: true }).eq("status", "approved")),
      fetchExactCountSafe(admin.from("apply_credit_orders").select("id", { count: "exact", head: true }).eq("status", "pending")),
      fetchExactCountSafe(admin.from("apply_credit_orders").select("id", { count: "exact", head: true }).eq("status", "approved")),
      fetchExactCountSafe(admin.from("dating_swipe_subscription_requests").select("id", { count: "exact", head: true }).eq("status", "pending")),
      fetchExactCountSafe(admin.from("dating_swipe_subscription_requests").select("id", { count: "exact", head: true }).eq("status", "approved").gt("expires_at", nowIso)),
      countCumulativeOpenCardMatches(admin),
      countCumulativeSwipeMatches(admin),
      fetchExactCountSafe(
        admin
          .from("support_inquiries")
          .select("id", { count: "exact", head: true })
          .gte("answered_at", todayStartIso)
          .lt("answered_at", tomorrowStartIso)
      ),
    ]);

    return NextResponse.json({
      ok: true,
      requestId,
      generatedAt: new Date().toISOString(),
      note: "오늘 유입은 현재 방문 로그가 아닌 신규 가입 기준입니다.",
      featureLabels: Object.fromEntries(FEATURE_CONFIG.map((feature) => [feature.key, feature.label])) as Record<FeatureKey, string>,
      today,
      todayTopFeatures,
      recent7d,
      current: {
        totalUsers,
        adminUsers,
        phoneVerifiedUsers,
        swipeVisibleUsers,
        publicOpenCards,
        pendingOpenCards,
        totalOpenCardApplications,
        publicPaidCards,
        totalPaidCardApplications,
        approvedOneOnOneCards,
        pendingOneOnOneCards,
        activeMoreView,
        activeCityView,
        openSupport,
        totalSupportInquiries,
        answeredSupportTotal,
        pendingCertRequests,
        approvedCertRequests,
        pendingApplyCreditOrders,
        approvedApplyCreditOrders,
        pendingSwipeSubscriptions,
        activeSwipeSubscriptions,
        totalOpenCardMatches,
        totalSwipeMatches,
        totalDatingMatches: totalOpenCardMatches + totalSwipeMatches,
        todayAnsweredSupport,
      },
      averages: {
        openCardApplicationsPerPublicCard:
          publicOpenCardIds.length > 0 ? Number((publicOpenCardApplicationCount / publicOpenCardIds.length).toFixed(2)) : 0,
        paidCardApplicationsPerApprovedCard:
          publicPaidCardIds.length > 0 ? Number((publicPaidCardApplicationCount / publicPaidCardIds.length).toFixed(2)) : 0,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/site-dashboard] failed", error);
    return NextResponse.json(
      { ok: false, requestId, error: "운영 현황을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}

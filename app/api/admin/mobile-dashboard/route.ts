import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { DATING_STORE_PRODUCT_IDS, type DatingStoreProductId } from "@/lib/dating-store-products";

type PurchaseStatus = "processing" | "fulfilled" | "failed" | "ignored";

type PurchaseRow = {
  id: string;
  user_id: string | null;
  product_id: string | null;
  platform: "ios" | "android" | null;
  store: "app_store" | "play_store" | null;
  status: PurchaseStatus;
  verified: boolean | null;
  note: string | null;
  created_at: string;
  fulfilled_at: string | null;
};

type ProfileRow = {
  user_id: string;
  nickname: string | null;
};

type SupportRow = {
  id: string;
  user_id: string | null;
  category: string | null;
  subject: string | null;
  message: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: "open" | "answered" | "closed";
  created_at: string;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function isMissingSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205" || message.includes("does not exist");
}

async function fetchExactCountSafe(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const result = await query;
  if (result.error) {
    if (isMissingSchemaError(result.error)) return 0;
    throw result.error;
  }
  return result.count ?? 0;
}

const PRODUCT_ORDER: DatingStoreProductId[] = [
  DATING_STORE_PRODUCT_IDS.applyCredits5,
  DATING_STORE_PRODUCT_IDS.instantOpenCard,
  DATING_STORE_PRODUCT_IDS.nearbyIdeal3h,
  DATING_STORE_PRODUCT_IDS.moreView3h,
  DATING_STORE_PRODUCT_IDS.oneOnOneContactExchange,
  DATING_STORE_PRODUCT_IDS.oneOnOnePlus7d,
  DATING_STORE_PRODUCT_IDS.oneOnOnePlus30d,
  DATING_STORE_PRODUCT_IDS.datingAllPass30d,
  DATING_STORE_PRODUCT_IDS.openCardRepost,
  DATING_STORE_PRODUCT_IDS.swipePremium30d,
];

export async function GET() {
  const adminGuard = await requireAdminRoute();
  if (!adminGuard.ok) return adminGuard.response;

  try {
    const { admin } = adminGuard;
    const nowIso = new Date().toISOString();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [
      cardsTotal,
      cardsPending,
      cardsPublic,
      cardsExpired,
      applicationsTotal,
      applicationsSubmitted,
      applicationsAccepted,
      applicationsRejected,
      purchasesProcessing,
      purchasesFulfilled,
      purchasesFailed,
      purchasesToday,
      supportOpen,
      supportAnsweredToday,
      oneOnOneCardsReviewing,
      oneOnOneCardsApproved,
      oneOnOneMatchesMutual,
      oneOnOneContactsPending,
      swipeSubscriptionPending,
      swipeSubscriptionActive,
      latestPurchasesRes,
      openSupportRes,
    ] = await Promise.all([
      fetchExactCountSafe(admin.from("dating_cards").select("id", { count: "exact", head: true })),
      fetchExactCountSafe(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("status", "pending")),
      fetchExactCountSafe(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("status", "public")),
      fetchExactCountSafe(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("status", "expired")),
      fetchExactCountSafe(admin.from("dating_card_applications").select("id", { count: "exact", head: true })),
      fetchExactCountSafe(admin.from("dating_card_applications").select("id", { count: "exact", head: true }).eq("status", "submitted")),
      fetchExactCountSafe(admin.from("dating_card_applications").select("id", { count: "exact", head: true }).eq("status", "accepted")),
      fetchExactCountSafe(admin.from("dating_card_applications").select("id", { count: "exact", head: true }).eq("status", "rejected")),
      fetchExactCountSafe(admin.from("app_purchase_events").select("id", { count: "exact", head: true }).eq("status", "processing")),
      fetchExactCountSafe(admin.from("app_purchase_events").select("id", { count: "exact", head: true }).eq("status", "fulfilled")),
      fetchExactCountSafe(admin.from("app_purchase_events").select("id", { count: "exact", head: true }).eq("status", "failed")),
      fetchExactCountSafe(admin.from("app_purchase_events").select("id", { count: "exact", head: true }).gte("created_at", todayIso)),
      fetchExactCountSafe(admin.from("support_inquiries").select("id", { count: "exact", head: true }).eq("status", "open")),
      fetchExactCountSafe(admin.from("support_inquiries").select("id", { count: "exact", head: true }).gte("answered_at", todayIso)),
      fetchExactCountSafe(
        admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).in("status", ["submitted", "reviewing"])
      ),
      fetchExactCountSafe(admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).eq("status", "approved")),
      fetchExactCountSafe(
        admin.from("dating_1on1_match_proposals").select("id", { count: "exact", head: true }).eq("state", "mutual_accepted")
      ),
      fetchExactCountSafe(
        admin
          .from("dating_1on1_match_proposals")
          .select("id", { count: "exact", head: true })
          .in("contact_exchange_status", ["awaiting_applicant_payment", "payment_pending_admin"])
      ),
      fetchExactCountSafe(admin.from("dating_swipe_subscription_requests").select("id", { count: "exact", head: true }).eq("status", "pending")),
      fetchExactCountSafe(admin.from("dating_swipe_subscription_requests").select("id", { count: "exact", head: true }).eq("status", "approved").gt("expires_at", nowIso)),
      admin
        .from("app_purchase_events")
        .select("id,user_id,product_id,platform,store,status,verified,note,created_at,fulfilled_at")
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("support_inquiries")
        .select("id,user_id,category,subject,message,contact_email,contact_phone,status,created_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

    if (latestPurchasesRes.error && !isMissingSchemaError(latestPurchasesRes.error)) throw latestPurchasesRes.error;
    if (openSupportRes.error && !isMissingSchemaError(openSupportRes.error)) throw openSupportRes.error;

    const latestPurchases = (latestPurchasesRes.data ?? []) as PurchaseRow[];
    const openSupportItems = (openSupportRes.data ?? []) as SupportRow[];
    const userIds = [
      ...new Set(
        [...latestPurchases.map((item) => item.user_id), ...openSupportItems.map((item) => item.user_id)].filter(
          (value): value is string => !!value
        )
      ),
    ];

    let profilesByUserId: Record<string, string | null> = {};
    if (userIds.length > 0) {
      const profilesRes = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
      if (profilesRes.error && !isMissingSchemaError(profilesRes.error)) throw profilesRes.error;
      profilesByUserId = Object.fromEntries(((profilesRes.data ?? []) as ProfileRow[]).map((row) => [row.user_id, row.nickname]));
    }

    const productStats = await Promise.all(
      PRODUCT_ORDER.map(async (productId) => ({
        productId,
        fulfilledCount: await fetchExactCountSafe(
          admin.from("app_purchase_events").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("status", "fulfilled")
        ),
        failedCount: await fetchExactCountSafe(
          admin.from("app_purchase_events").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("status", "failed")
        ),
        processingCount: await fetchExactCountSafe(
          admin.from("app_purchase_events").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("status", "processing")
        ),
      }))
    );

    return json(200, {
      ok: true,
      overview: {
        cardsTotal,
        cardsPending,
        cardsPublic,
        cardsExpired,
        applicationsTotal,
        applicationsSubmitted,
        applicationsAccepted,
        applicationsRejected,
        purchasesProcessing,
        purchasesFulfilled,
        purchasesFailed,
        purchasesToday,
        supportOpen,
        supportAnsweredToday,
        oneOnOneCardsReviewing,
        oneOnOneCardsApproved,
        oneOnOneMatchesMutual,
        oneOnOneContactsPending,
        swipeSubscriptionPending,
        swipeSubscriptionActive,
      },
      latestPurchases: latestPurchases.map((item) => ({
        id: item.id,
        userId: item.user_id,
        nickname: item.user_id ? profilesByUserId[item.user_id] ?? null : null,
        productId: item.product_id ?? "",
        platform: item.platform ?? "android",
        store: item.store ?? "play_store",
        status: item.status,
        verified: item.verified === true,
        note: item.note,
        createdAt: item.created_at,
        fulfilledAt: item.fulfilled_at,
      })),
      productStats,
      openSupportItems: openSupportItems.map((item) => ({
        id: item.id,
        userId: item.user_id,
        nickname: item.user_id ? profilesByUserId[item.user_id] ?? null : null,
        category: item.category ?? "other",
        subject: item.subject ?? "문의",
        message: item.message ?? "",
        contactEmail: item.contact_email,
        contactPhone: item.contact_phone,
        status: item.status,
        createdAt: item.created_at,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/mobile-dashboard] failed", error);
    return json(500, { ok: false, message: "운영 대시보드를 불러오지 못했습니다." });
  }
}

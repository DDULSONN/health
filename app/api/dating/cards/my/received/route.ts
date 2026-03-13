import { createAdminClient } from "@/lib/supabase/server";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { syncOpenCardQueue } from "@/lib/dating-cards-queue";
import { getDatingBlockedUserIds } from "@/lib/dating-blocks";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type SignCounters = { signCalls: number; cacheHit: number; cacheMiss: number };

type CardRow = {
  id: string;
  sex: "male" | "female";
  display_nickname: string | null;
  age: number | null;
  region: string | null;
  expires_at: string | null;
  created_at: string;
  status: string;
  applications_last_viewed_at?: string | null;
};

type ApplicationRow = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  status: string;
  created_at: string;
  instagram_id: string | null;
  photo_paths: unknown[];
};

function normalizeApplyPhotoPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";
  return extractStorageObjectPathFromBuckets(value, ["dating-apply-photos", "dating-photos"]) ?? value;
}

async function createApplyPhotoSignedUrl(
  _adminClient: ReturnType<typeof createAdminClient>,
  path: string,
  _requestId: string,
  counters: SignCounters
) {
  const proxy = buildSignedImageUrl("dating-apply-photos", path);
  if (proxy) counters.cacheMiss += 1;
  return proxy;
}

async function getPendingQueuePosition(
  adminClient: ReturnType<typeof createAdminClient>,
  sex: "male" | "female",
  createdAt: string,
  cardId: string
): Promise<number | null> {
  const [beforeRes, sameTsRes] = await Promise.all([
    adminClient
      .from("dating_cards")
      .select("id", { head: true, count: "exact" })
      .eq("sex", sex)
      .eq("status", "pending")
      .lt("created_at", createdAt),
    adminClient
      .from("dating_cards")
      .select("id", { head: true, count: "exact" })
      .eq("sex", sex)
      .eq("status", "pending")
      .eq("created_at", createdAt)
      .lte("id", cardId),
  ]);

  if (beforeRes.error || sameTsRes.error) {
    return null;
  }
  return (beforeRes.count ?? 0) + (sameTsRes.count ?? 0);
}

async function fetchOwnedCards(adminClient: ReturnType<typeof createAdminClient>, userId: string) {
  let { data, error } = await adminClient
    .from("dating_cards")
    .select("id, sex, display_nickname, age, region, expires_at, created_at, status, applications_last_viewed_at")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false });

  if (error && error.code === "42703") {
    const fallback = await adminClient
      .from("dating_cards")
      .select("id, sex, display_nickname, age, region, expires_at, created_at, status")
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: false });

    error = fallback.error;
    data = (fallback.data ?? []).map((row) => ({
      ...row,
      applications_last_viewed_at: null,
    }));
  }

  return {
    data: (data ?? []) as CardRow[],
    error,
  };
}

async function fetchApplications(adminClient: ReturnType<typeof createAdminClient>, cardIds: string[]) {
  let { data, error } = await adminClient
    .from("dating_card_applications")
    .select(
      "id, card_id, applicant_user_id, applicant_display_nickname, age, height_cm, region, job, training_years, intro_text, status, created_at, instagram_id, photo_paths"
    )
    .in("card_id", cardIds)
    .order("created_at", { ascending: false });

  if (error && error.code === "42703") {
    const fallback = await adminClient
      .from("dating_card_applications")
      .select(
        "id, card_id, applicant_user_id, age, height_cm, region, job, training_years, intro_text, status, created_at, instagram_id, photo_urls"
      )
      .in("card_id", cardIds)
      .order("created_at", { ascending: false });

    error = fallback.error;
    data = (fallback.data ?? []).map((row) => ({
      ...row,
      applicant_display_nickname: null,
      photo_paths: Array.isArray(row.photo_urls) ? row.photo_urls : [],
    }));
  }

  return {
    data: (data ?? []) as ApplicationRow[],
    error,
  };
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const { user } = await getRequestAuthContext(req);
  const ip = extractClientIp(req);
  const { searchParams } = new URL(req.url);
  const requestedCardId = searchParams.get("cardId")?.trim() ?? "";
  const markViewed = searchParams.get("markViewed") === "1";

  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "dating-cards-my-received",
    userId: user?.id ?? null,
    ip,
    userLimitPerMin: 30,
    ipLimitPerMin: 120,
    path: "/api/dating/cards/my/received",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMIT", message: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSec) } }
    );
  }

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const counters: SignCounters = { signCalls: 0, cacheHit: 0, cacheMiss: 0 };
  const adminClient = createAdminClient();
  const blockedUserIds = await getDatingBlockedUserIds(adminClient, user.id);

  try {
    await syncOpenCardQueue(adminClient);
  } catch (error) {
    console.error("[GET /api/dating/cards/my/received] queue sync failed", { requestId, error });
  }

  const cardsRes = await fetchOwnedCards(adminClient, user.id);
  if (cardsRes.error) {
    console.error("[GET /api/dating/cards/my/received] cards failed", {
      requestId,
      code: cardsRes.error.code ?? null,
      message: cardsRes.error.message ?? null,
      stack: cardsRes.error instanceof Error ? cardsRes.error.stack : undefined,
    });
    return NextResponse.json({ error: "내 카드를 불러오지 못했습니다." }, { status: 500 });
  }

  let cards = cardsRes.data;
  if (requestedCardId) {
    cards = cards.filter((card) => card.id === requestedCardId);
  }

  const cardIds = cards.map((card) => card.id);
  if (cardIds.length === 0) {
    return NextResponse.json({ cards: [], applications: [] });
  }

  if (markViewed) {
    const viewedAt = new Date().toISOString();
    const markRes = await adminClient
      .from("dating_cards")
      .update({ applications_last_viewed_at: viewedAt })
      .in("id", cardIds)
      .eq("owner_user_id", user.id);

    if (markRes.error && markRes.error.code !== "42703") {
      console.error("[GET /api/dating/cards/my/received] mark viewed failed", {
        requestId,
        code: markRes.error.code ?? null,
        message: markRes.error.message ?? null,
      });
    } else if (!markRes.error) {
      cards = cards.map((card) => ({ ...card, applications_last_viewed_at: viewedAt }));
    }
  }

  const appsRes = await fetchApplications(adminClient, cardIds);
  if (appsRes.error) {
    console.error("[GET /api/dating/cards/my/received] apps failed", {
      requestId,
      code: appsRes.error.code ?? null,
      message: appsRes.error.message ?? null,
      stack: appsRes.error instanceof Error ? appsRes.error.stack : undefined,
    });
    return NextResponse.json({ error: "지원자 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const visibleApps = appsRes.data.filter((app) => !blockedUserIds.has(app.applicant_user_id));
  let rawSignedCount = 0;
  const safeApps = await Promise.all(
    visibleApps.map(async (app) => {
      const rawPhotoPaths = Array.isArray(app.photo_paths)
        ? app.photo_paths
            .map((item) => normalizeApplyPhotoPath(item))
            .filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];

      const signedUrls = await Promise.all(
        rawPhotoPaths.map((path) => createApplyPhotoSignedUrl(adminClient, path, requestId, counters))
      );
      const filteredUrls = signedUrls.filter((url) => url.length > 0);
      rawSignedCount += filteredUrls.length;

      return {
        ...app,
        instagram_id: app.status === "accepted" ? app.instagram_id : null,
        photo_signed_urls: filteredUrls,
      };
    })
  );

  const signedTotal = counters.cacheHit + counters.cacheMiss;
  const cacheHitRatePct = signedTotal > 0 ? Math.round((counters.cacheHit / signedTotal) * 1000) / 10 : 0;
  console.log(
    `[list.metrics] requestId=${requestId} path=/api/dating/cards/my/received cards=${cards.length} rawSigned=${rawSignedCount} blurSigned=0 cacheHitRatePct=${cacheHitRatePct} signCalls=${counters.signCalls}`
  );

  const applicationsByCard = new Map<string, ApplicationRow[]>();
  for (const app of visibleApps) {
    const list = applicationsByCard.get(app.card_id) ?? [];
    list.push(app);
    applicationsByCard.set(app.card_id, list);
  }

  const cardsWithQueuePosition = await Promise.all(
    cards.map(async (card) => {
      const applications = applicationsByCard.get(card.id) ?? [];
      const lastViewedAt = card.applications_last_viewed_at ? Date.parse(card.applications_last_viewed_at) : null;
      const unreadCount = applications.filter((app) => {
        const createdAt = Date.parse(app.created_at);
        if (Number.isNaN(createdAt)) return false;
        return lastViewedAt == null || createdAt > lastViewedAt;
      }).length;

      const queuePosition =
        card.status === "pending"
          ? await getPendingQueuePosition(adminClient, card.sex, card.created_at, card.id)
          : null;

      return {
        ...card,
        applicant_count: applications.length,
        unread_application_count: unreadCount,
        queue_position: queuePosition,
      };
    })
  );

  return NextResponse.json({ cards: cardsWithQueuePosition, applications: safeApps });
}



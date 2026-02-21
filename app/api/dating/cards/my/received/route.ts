import { createClient, createAdminClient } from "@/lib/supabase/server";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { NextResponse } from "next/server";

type SignCounters = { signCalls: number; cacheHit: number; cacheMiss: number };

function normalizeApplyPhotoPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";
  return (
    extractStorageObjectPathFromBuckets(value, ["dating-apply-photos", "dating-photos"]) ??
    value
  );
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

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ip = extractClientIp(req);

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
  let { data: cards, error: cardsError } = await adminClient
    .from("dating_cards")
    .select("id, sex, display_nickname, age, region, expires_at, created_at, status")
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: false });

  // Compatibility fallback for environments where new columns are not migrated yet.
  if (cardsError && cardsError.code === "42703") {
    const fallback = await adminClient
      .from("dating_cards")
      .select("id, sex, age, region, created_at, status")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: false });

    cardsError = fallback.error;
    cards = (fallback.data ?? []).map((row) => ({
      ...row,
      display_nickname: null,
      expires_at: null,
    }));
  }

  if (cardsError) {
    console.error("[GET /api/dating/cards/my/received] cards failed", {
      requestId,
      code: cardsError.code ?? null,
      message: cardsError.message ?? null,
      stack: cardsError instanceof Error ? cardsError.stack : undefined,
    });
    return NextResponse.json({ error: "내 카드를 불러오지 못했습니다." }, { status: 500 });
  }

  const cardIds = (cards ?? []).map((c) => c.id);
  if (cardIds.length === 0) {
    return NextResponse.json({ cards: [], applications: [] });
  }

  let { data: applications, error: appsError } = await adminClient
    .from("dating_card_applications")
    .select("id, card_id, applicant_user_id, applicant_display_nickname, age, height_cm, region, job, training_years, intro_text, status, created_at, instagram_id, photo_paths")
    .in("card_id", cardIds)
    .order("created_at", { ascending: false });

  // Compatibility fallback for legacy schema (photo_urls / no applicant_display_nickname).
  if (appsError && appsError.code === "42703") {
    const fallback = await adminClient
      .from("dating_card_applications")
      .select("id, card_id, applicant_user_id, age, height_cm, region, job, training_years, intro_text, status, created_at, instagram_id, photo_urls")
      .in("card_id", cardIds)
      .order("created_at", { ascending: false });

    appsError = fallback.error;
    applications = (fallback.data ?? []).map((row) => ({
      ...row,
      applicant_display_nickname: null,
      photo_paths: row.photo_urls ?? [],
    }));
  }

  if (appsError) {
    console.error("[GET /api/dating/cards/my/received] apps failed", {
      requestId,
      code: appsError.code ?? null,
      message: appsError.message ?? null,
      stack: appsError instanceof Error ? appsError.stack : undefined,
    });
    return NextResponse.json({ error: "지원자 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  let rawSignedCount = 0;
  const safeApps = await Promise.all(
    (applications ?? []).map(async (app) => {
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
    `[list.metrics] requestId=${requestId} path=/api/dating/cards/my/received cards=${(cards ?? []).length} rawSigned=${rawSignedCount} blurSigned=0 cacheHitRatePct=${cacheHitRatePct} signCalls=${counters.signCalls}`
  );

  return NextResponse.json({ cards: cards ?? [], applications: safeApps });
}

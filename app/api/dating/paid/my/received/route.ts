import { createAdminClient, createClient } from "@/lib/supabase/server";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { getCachedSignedUrlResolved } from "@/lib/signed-url-cache";
import { NextResponse } from "next/server";

const SIGNED_URL_TTL_SEC = 3600;

type SignCounters = { signCalls: number; cacheHit: number; cacheMiss: number };

async function createApplyPhotoSignedUrl(
  adminClient: ReturnType<typeof createAdminClient>,
  path: string,
  requestId: string,
  counters: SignCounters
) {
  const result = await getCachedSignedUrlResolved({
    requestId,
    path,
    ttlSec: SIGNED_URL_TTL_SEC,
    buckets: ["dating-apply-photos", "dating-photos"],
    getSignCallCount: () => counters.signCalls,
    createSignedUrl: async (bucket, p, ttlSec) => {
      counters.signCalls += 1;
      const signRes = await adminClient.storage.from(bucket).createSignedUrl(p, ttlSec);
      if (signRes.error || !signRes.data?.signedUrl) return "";
      return signRes.data.signedUrl;
    },
  });

  if (result.cacheStatus === "hit") counters.cacheHit += 1;
  if (result.cacheStatus === "miss") counters.cacheMiss += 1;
  return result.url;
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
    scope: "dating-paid-my-received",
    userId: user?.id ?? null,
    ip,
    userLimitPerMin: 30,
    ipLimitPerMin: 120,
    path: "/api/dating/paid/my/received",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMIT", message: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSec) } }
    );
  }

  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const counters: SignCounters = { signCalls: 0, cacheHit: 0, cacheMiss: 0 };
  const admin = createAdminClient();
  const { data: cards, error: cardsError } = await admin
    .from("dating_paid_cards")
    .select("id,nickname,gender,age,region,expires_at,created_at,status")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (cardsError) {
    console.error("[GET /api/dating/paid/my/received] cards failed", {
      requestId,
      code: cardsError.code ?? null,
      message: cardsError.message ?? null,
      stack: cardsError instanceof Error ? cardsError.stack : undefined,
    });
    return NextResponse.json({ error: "내 유료카드를 불러오지 못했습니다." }, { status: 500 });
  }

  const cardIds = (cards ?? []).map((c) => c.id);
  if (cardIds.length === 0) return NextResponse.json({ cards: [], applications: [] });

  const { data: apps, error: appsError } = await admin
    .from("dating_paid_card_applications")
    .select("id,paid_card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,status,created_at,instagram_id,photo_paths")
    .in("paid_card_id", cardIds)
    .order("created_at", { ascending: false });

  if (appsError) {
    console.error("[GET /api/dating/paid/my/received] apps failed", {
      requestId,
      code: appsError.code ?? null,
      message: appsError.message ?? null,
      stack: appsError instanceof Error ? appsError.stack : undefined,
    });
    return NextResponse.json({ error: "유료 지원자 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  let rawSignedCount = 0;
  const safeApps = await Promise.all(
    (apps ?? []).map(async (app) => {
      const rawPaths = Array.isArray(app.photo_paths)
        ? app.photo_paths.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
      const signed = await Promise.all(rawPaths.map((p) => createApplyPhotoSignedUrl(admin, p, requestId, counters)));
      const filtered = signed.filter((u) => u.length > 0);
      rawSignedCount += filtered.length;
      return {
        ...app,
        card_id: app.paid_card_id,
        instagram_id: app.status === "accepted" ? app.instagram_id : null,
        photo_signed_urls: filtered,
      };
    })
  );

  const signedTotal = counters.cacheHit + counters.cacheMiss;
  const cacheHitRatePct = signedTotal > 0 ? Math.round((counters.cacheHit / signedTotal) * 1000) / 10 : 0;
  console.log(
    `[list.metrics] requestId=${requestId} path=/api/dating/paid/my/received cards=${(cards ?? []).length} rawSigned=${rawSignedCount} blurSigned=0 cacheHitRatePct=${cacheHitRatePct} signCalls=${counters.signCalls}`
  );

  return NextResponse.json({ cards: cards ?? [], applications: safeApps });
}

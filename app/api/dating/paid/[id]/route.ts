import { createAdminClient } from "@/lib/supabase/server";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { getCachedSignedUrlResolved } from "@/lib/signed-url-cache";
import { NextResponse } from "next/server";

const SIGNED_URL_TTL_SEC = 3600;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const ip = extractClientIp(req);
  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "dating-paid-signed-urls",
    userId: null,
    ip,
    userLimitPerMin: 30,
    ipLimitPerMin: 120,
    path: "/api/dating/paid/[id]",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMIT", message: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSec) } }
    );
  }

  const { id } = await params;
  const admin = createAdminClient();
  let signCalls = 0;
  let cacheHit = 0;
  let cacheMiss = 0;

  const { data, error } = await admin
    .from("dating_paid_cards")
    .select(
      "id,nickname,gender,age,region,height_cm,job,training_years,strengths_text,ideal_text,intro_text,photo_visibility,blur_thumb_path,photo_paths,status,expires_at,paid_at,created_at"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  const now = Date.now();
  if (data.status !== "approved" || !data.expires_at || new Date(data.expires_at).getTime() <= now) {
    return NextResponse.json({ error: "지원 가능한 카드가 아닙니다." }, { status: 403 });
  }

  const firstPath =
    Array.isArray(data.photo_paths) && data.photo_paths.length > 0 && typeof data.photo_paths[0] === "string"
      ? data.photo_paths[0]
      : "";

  const createSignedUrl = async (path: string) => {
    const result = await getCachedSignedUrlResolved({
      requestId,
      path,
      ttlSec: SIGNED_URL_TTL_SEC,
      buckets: ["dating-card-photos", "dating-photos"],
      getSignCallCount: () => signCalls,
      createSignedUrl: async (bucket, p, ttlSec) => {
        signCalls += 1;
        const signRes = await admin.storage.from(bucket).createSignedUrl(p, ttlSec);
        if (signRes.error || !signRes.data?.signedUrl) return "";
        return signRes.data.signedUrl;
      },
    });
    if (result.cacheStatus === "hit") cacheHit += 1;
    if (result.cacheStatus === "miss") cacheMiss += 1;
    return result.url;
  };

  let imageUrl = "";
  if (data.photo_visibility === "public" && firstPath) {
    imageUrl = await createSignedUrl(firstPath);
  } else if (data.blur_thumb_path) {
    imageUrl = await createSignedUrl(data.blur_thumb_path);
  }
  console.log(
    `[signedUrl.stats] requestId=${requestId} path=/api/dating/paid/[id] signCalls=${signCalls} cacheHit=${cacheHit} cacheMiss=${cacheMiss}`
  );

  return NextResponse.json({
    card: {
      id: data.id,
      nickname: data.nickname,
      gender: data.gender,
      age: data.age,
      region: data.region,
      height_cm: data.height_cm,
      job: data.job,
      training_years: data.training_years,
      strengths_text: data.strengths_text,
      ideal_text: data.ideal_text,
      intro_text: data.intro_text,
      expires_at: data.expires_at,
      image_url: imageUrl,
      photo_visibility: data.photo_visibility === "public" ? "public" : "blur",
    },
  });
}

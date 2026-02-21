import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { getCachedSignedUrlResolved } from "@/lib/signed-url-cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const SIGNED_URL_TTL_SEC = 3600;

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

type SignCounters = {
  signCalls: number;
  cacheHit: number;
  cacheMiss: number;
};

function toLitePath(rawPath: string): string {
  return rawPath.replace("/raw/", "/lite/").replace(/\.[^.\/]+$/, ".webp");
}

async function signPathWithCache(
  adminClient: ReturnType<typeof createAdminClient>,
  path: string,
  requestId: string,
  counters: SignCounters
) {
  const result = await getCachedSignedUrlResolved({
    requestId,
    path,
    ttlSec: SIGNED_URL_TTL_SEC,
    buckets: ["dating-card-photos", "dating-photos"],
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

async function createSignedImageUrls(
  adminClient: ReturnType<typeof createAdminClient>,
  photoPaths: unknown,
  blurPaths: unknown,
  blurThumbPath: unknown,
  photoVisibility: "blur" | "public",
  requestId: string,
  counters: SignCounters
) {
  if (photoVisibility === "public") {
    const rawPaths = Array.isArray(photoPaths)
      ? photoPaths.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 2)
      : [];
    const rawUrls: string[] = [];
    for (const rawPath of rawPaths) {
      const litePath = toLitePath(rawPath);
      const liteSigned = await signPathWithCache(adminClient, litePath, requestId, counters);
      if (liteSigned) {
        rawUrls.push(liteSigned);
        continue;
      }
      const rawSigned = await signPathWithCache(adminClient, rawPath, requestId, counters);
      if (rawSigned) rawUrls.push(rawSigned);
    }
    if (rawUrls.length > 0) return rawUrls;
  }

  const blurPathList = Array.isArray(blurPaths)
    ? blurPaths.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 2)
    : [];
  const blurUrls: string[] = [];
  for (const blurPath of blurPathList) {
    const signed = await signPathWithCache(adminClient, blurPath, requestId, counters);
    if (signed) blurUrls.push(signed);
  }
  if (blurUrls.length > 0) return blurUrls;

  if (typeof blurThumbPath === "string" && blurThumbPath) {
    const thumb = await signPathWithCache(adminClient, blurThumbPath, requestId, counters);
    if (thumb) {
      if (photoVisibility === "blur") return [thumb, thumb];
      return [thumb];
    }
  }

  return [];
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ip = extractClientIp(req);

  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "dating-cards-signed-urls",
    userId: user?.id ?? null,
    ip,
    userLimitPerMin: 30,
    ipLimitPerMin: 120,
    path: "/api/dating/cards/[id]",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMIT", message: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSec) } }
    );
  }

  const counters: SignCounters = { signCalls: 0, cacheHit: 0, cacheMiss: 0 };
  const { id } = await params;
  const adminClient = createAdminClient();

  let { data, error } = await adminClient
    .from("dating_cards")
    .select(
      "id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, photo_visibility, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_paths, blur_thumb_path, expires_at, created_at, status"
    )
    .eq("id", id)
    .single();

  if (error && isMissingColumnError(error)) {
    const legacyRes = await adminClient
      .from("dating_cards")
      .select(
        "id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, expires_at, created_at, status"
      )
      .eq("id", id)
      .single();

    data = legacyRes.data
      ? {
          ...legacyRes.data,
          strengths_text: null,
          photo_visibility: "blur",
          blur_paths: [],
        }
      : null;
    error = legacyRes.error;
  }

  if (error || !data) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  if (data.status !== "public" || !data.expires_at || new Date(data.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "공개 중인 카드가 아닙니다." }, { status: 403 });
  }

  const photoVisibility = data.photo_visibility === "public" ? "public" : "blur";
  const imageUrls = await createSignedImageUrls(
    adminClient,
    data.photo_paths,
    data.blur_paths,
    data.blur_thumb_path,
    photoVisibility,
    requestId,
    counters
  );

  console.log(
    `[signedUrl.stats] requestId=${requestId} scope=dating-cards-signed-urls signCalls=${counters.signCalls} cacheHit=${counters.cacheHit} cacheMiss=${counters.cacheMiss}`
  );

  return NextResponse.json({
    card: {
      id: data.id,
      sex: data.sex,
      display_nickname: data.display_nickname,
      age: data.age,
      region: data.region,
      height_cm: data.height_cm,
      job: data.job,
      training_years: data.training_years,
      ideal_type: data.ideal_type,
      strengths_text: data.strengths_text,
      photo_visibility: photoVisibility,
      total_3lift: data.total_3lift,
      percent_all: data.percent_all,
      is_3lift_verified: data.is_3lift_verified,
      image_urls: imageUrls,
      expires_at: data.expires_at,
      created_at: data.created_at,
    },
    can_apply: true,
  });
}

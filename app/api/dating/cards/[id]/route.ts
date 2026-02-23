import { buildPublicLiteImageUrl, buildSignedImageUrl, buildSignedImageUrlAllowRaw, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { hasMoreViewAccess } from "@/lib/dating-more-view";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { kvGetString, kvSetString } from "@/lib/edge-kv";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

const LITE_PUBLIC_BUCKET = "dating-card-lite";
const LITE_PUBLIC_PROBE_TTL_MS = 6 * 60 * 60 * 1000;
const LITE_PUBLIC_NEGATIVE_PROBE_TTL_MS = 5 * 60 * 1000;

type LitePublicProbeCacheValue = {
  exists: boolean;
  expiresAtEpochMs: number;
};

const litePublicProbeCache = new Map<string, LitePublicProbeCacheValue>();

function normalizeDatingPhotoPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";
  return (
    extractStorageObjectPathFromBuckets(value, ["dating-card-photos", "dating-photos"]) ??
    value
  );
}

async function signPathWithCache(
  _adminClient: ReturnType<typeof createAdminClient>,
  path: string,
  _requestId: string,
  counters: SignCounters,
  allowRaw = false
) {
  const primary = allowRaw
    ? buildSignedImageUrlAllowRaw("dating-card-photos", path)
    : buildSignedImageUrl("dating-card-photos", path);
  if (primary) {
    counters.cacheMiss += 1;
    return primary;
  }

  // lite/thumb가 dating-card-lite 버킷에만 있는 케이스 fallback
  if (path.includes("/lite/") || path.includes("/thumb/")) {
    const liteBucketSigned = buildSignedImageUrlAllowRaw("dating-card-lite", path);
    if (liteBucketSigned) {
      counters.cacheMiss += 1;
      return liteBucketSigned;
    }
  }

  return "";
}

function toBlurWebpPath(path: string): string {
  return path.includes("/blur/") ? path.replace(/\.[^.\/]+$/, ".webp") : path;
}

function toThumbPath(rawPath: string): string {
  return rawPath.replace("/raw/", "/thumb/").replace(/\.[^.\/]+$/, ".webp");
}

function toLitePath(rawPath: string): string {
  return rawPath.replace("/raw/", "/lite/").replace(/\.[^.\/]+$/, ".webp");
}

async function getLitePublicUrlIfAvailable(
  adminClient: ReturnType<typeof createAdminClient>,
  litePath: string
): Promise<string> {
  const now = Date.now();
  const cachedProbe = litePublicProbeCache.get(litePath);
  if (cachedProbe && cachedProbe.expiresAtEpochMs > now) {
    if (!cachedProbe.exists) return "";
    return buildPublicLiteImageUrl(LITE_PUBLIC_BUCKET, litePath);
  }

  const marker = await kvGetString(`litepublic:${litePath}`);
  const missingMarker = await kvGetString(`litepublic:missing:${litePath}`);
  const proxyUrl = buildPublicLiteImageUrl(LITE_PUBLIC_BUCKET, litePath);
  if (!proxyUrl) return "";
  const publicUrl = adminClient.storage.from(LITE_PUBLIC_BUCKET).getPublicUrl(litePath).data.publicUrl;
  if (typeof publicUrl !== "string" || !publicUrl) return "";
  if (marker) {
    litePublicProbeCache.set(litePath, { exists: true, expiresAtEpochMs: now + LITE_PUBLIC_PROBE_TTL_MS });
    return proxyUrl;
  }
  if (missingMarker) {
    litePublicProbeCache.set(litePath, { exists: false, expiresAtEpochMs: now + LITE_PUBLIC_NEGATIVE_PROBE_TTL_MS });
    return "";
  }

  const probe = await fetch(publicUrl, { method: "HEAD", cache: "no-store" }).catch(() => null);
  if (probe?.ok) {
    litePublicProbeCache.set(litePath, { exists: true, expiresAtEpochMs: now + LITE_PUBLIC_PROBE_TTL_MS });
    return proxyUrl;
  }

  litePublicProbeCache.set(litePath, {
    exists: false,
    expiresAtEpochMs: now + LITE_PUBLIC_NEGATIVE_PROBE_TTL_MS,
  });
  await kvSetString(`litepublic:missing:${litePath}`, "1", Math.ceil(LITE_PUBLIC_NEGATIVE_PROBE_TTL_MS / 1000));
  return "";
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
      ? photoPaths.map((item) => normalizeDatingPhotoPath(item)).filter((item) => item.length > 0).slice(0, 2)
      : [];
    const rawUrls: string[] = [];
    for (const rawPath of rawPaths) {
      const litePath = toLitePath(rawPath);
      const liteSigned = await signPathWithCache(adminClient, litePath, requestId, counters);
      if (liteSigned) {
        rawUrls.push(liteSigned);
        continue;
      }
      const litePublic = await getLitePublicUrlIfAvailable(adminClient, litePath);
      if (litePublic) {
        rawUrls.push(litePublic);
        continue;
      }
      const thumbPath = toThumbPath(rawPath);
      const thumbSigned = await signPathWithCache(adminClient, thumbPath, requestId, counters);
      if (thumbSigned) {
        rawUrls.push(thumbSigned);
        continue;
      }
      const thumbPublic = await getLitePublicUrlIfAvailable(adminClient, thumbPath);
      if (thumbPublic) {
        rawUrls.push(thumbPublic);
        continue;
      }
      const rawSigned = await signPathWithCache(adminClient, rawPath, requestId, counters, true);
      if (rawSigned) rawUrls.push(rawSigned);
    }
    if (rawUrls.length > 0) return rawUrls;
  }

  const blurPathList = Array.isArray(blurPaths)
    ? blurPaths.map((item) => normalizeDatingPhotoPath(item)).filter((item) => item.length > 0).slice(0, 2)
    : [];
  const blurUrls: string[] = [];
  for (const originalBlurPath of blurPathList) {
    const signed = await signPathWithCache(adminClient, originalBlurPath, requestId, counters);
    if (signed) {
      blurUrls.push(signed);
      continue;
    }
    const blurWebpPath = toBlurWebpPath(originalBlurPath);
    const blurPublicUrl = await getLitePublicUrlIfAvailable(adminClient, blurWebpPath);
    if (blurPublicUrl) blurUrls.push(blurPublicUrl);
  }
  if (blurUrls.length > 0) return blurUrls;

  const normalizedBlurThumbPath = normalizeDatingPhotoPath(blurThumbPath);
  if (normalizedBlurThumbPath) {
    const blurThumbWebpPath = toBlurWebpPath(normalizedBlurThumbPath);
    const publicThumb = await getLitePublicUrlIfAvailable(adminClient, blurThumbWebpPath);
    if (publicThumb) {
      if (photoVisibility === "blur") return [publicThumb, publicThumb];
      return [publicThumb];
    }
    const thumb = await signPathWithCache(adminClient, normalizedBlurThumbPath, requestId, counters);
    if (thumb) {
      if (photoVisibility === "blur") return [thumb, thumb];
      return [thumb];
    }
  }

  // 마지막 안전장치: blur/lite 자산 누락 시 raw signed를 상세에서만 제한적으로 허용
  const emergencyRawPaths = Array.isArray(photoPaths)
    ? photoPaths.map((item) => normalizeDatingPhotoPath(item)).filter((item) => item.length > 0).slice(0, 2)
    : [];
  const emergencyRawUrls: string[] = [];
  for (const rawPath of emergencyRawPaths) {
    const rawSigned = await signPathWithCache(adminClient, rawPath, requestId, counters, true);
    if (rawSigned) emergencyRawUrls.push(rawSigned);
  }
  if (emergencyRawUrls.length > 0) return emergencyRawUrls;

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
    return NextResponse.json({ error: "移대뱶瑜?李얠쓣 ???놁뒿?덈떎." }, { status: 404 });
  }

  const isPublicAvailable = data.status === "public" && !!data.expires_at && new Date(data.expires_at).getTime() > Date.now();
  let canReadPending = false;
  if (!isPublicAvailable && data.status === "pending" && user?.id) {
    canReadPending = await hasMoreViewAccess(adminClient, user.id, data.sex);
  }

  if (!isPublicAvailable && !canReadPending) {
    return NextResponse.json({ error: "怨듦컻 以묒씤 移대뱶媛 ?꾨떃?덈떎." }, { status: 403 });
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

import { buildPublicLiteImageUrl, buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { kvGetString } from "@/lib/edge-kv";
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
  counters: SignCounters
) {
  const proxy = buildSignedImageUrl("dating-card-photos", path);
  if (proxy) counters.cacheMiss += 1;
  return proxy;
}

function toBlurWebpPath(path: string): string {
  return path.includes("/blur/") ? path.replace(/\.[^.\/]+$/, ".webp") : path;
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
  const proxyUrl = buildPublicLiteImageUrl(LITE_PUBLIC_BUCKET, litePath);
  if (!proxyUrl) return "";
  const publicUrl = adminClient.storage.from(LITE_PUBLIC_BUCKET).getPublicUrl(litePath).data.publicUrl;
  if (typeof publicUrl !== "string" || !publicUrl) return "";
  if (marker) {
    litePublicProbeCache.set(litePath, { exists: true, expiresAtEpochMs: now + LITE_PUBLIC_PROBE_TTL_MS });
    return proxyUrl;
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
      const rawSigned = await signPathWithCache(adminClient, rawPath, requestId, counters);
      if (rawSigned) rawUrls.push(rawSigned);
    }
    if (rawUrls.length > 0) return rawUrls;
  }

  const blurPathList = Array.isArray(blurPaths)
    ? blurPaths.map((item) => normalizeDatingPhotoPath(item)).filter((item) => item.length > 0).slice(0, 2)
    : [];
  const blurUrls: string[] = [];
  for (const originalBlurPath of blurPathList) {
    const blurWebpPath = toBlurWebpPath(originalBlurPath);
    const blurPublicUrl = await getLitePublicUrlIfAvailable(adminClient, blurWebpPath);
    if (blurPublicUrl) {
      blurUrls.push(blurPublicUrl);
      continue;
    }
    const signed = await signPathWithCache(adminClient, originalBlurPath, requestId, counters);
    if (signed) blurUrls.push(signed);
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

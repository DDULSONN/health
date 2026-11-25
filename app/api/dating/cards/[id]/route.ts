import { buildPublicLiteImageUrl, buildSignedImageUrl, buildSignedImageUrlAllowRaw, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { hasMoreViewAccess } from "@/lib/dating-more-view";
import { buildDatingCardPreviewUrl } from "@/lib/images";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactBlockBetween } from "@/lib/dating-contact-blocks";
import { isDatingCardBlurPath } from "@/lib/dating-card-photo-visibility";
import { hasCityViewCardAccess } from "@/lib/dating-city-view";
import { hasLovePassNearbyCardAccess } from "@/lib/dating-love-pass-access";
import { getLovePassPhotoPaths } from "@/lib/dating-love-pass-photos";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { kvGetString, kvSetString } from "@/lib/edge-kv";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
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
  try {
    return extractStorageObjectPathFromBuckets(value, ["dating-card-photos", "dating-photos"]) ?? "";
  } catch {
    return "";
  }
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

  // lite/thumb媛 dating-card-lite 踰꾪궥?먮쭔 ?덈뒗 耳?댁뒪 fallback
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
  ownerId: string,
  photoPaths: unknown,
  blurPaths: unknown,
  blurThumbPath: unknown,
  photoVisibility: "blur" | "public",
  requestId: string,
  counters: SignCounters,
  membersOnly = false
) {
  if (photoVisibility === "public") {
    const rawPaths = Array.isArray(photoPaths)
      ? photoPaths.map((item) => normalizeDatingPhotoPath(item)).filter((item) => item.length > 0).slice(0, 2)
      : [];
    const rawUrls = rawPaths.map(buildDatingCardPreviewUrl).filter(Boolean);
    if (rawUrls.length > 0) return rawUrls;
  }

  const blurPathList = Array.isArray(blurPaths)
    ? blurPaths.map(normalizeDatingPhotoPath).filter(path => isDatingCardBlurPath(path, ownerId)).slice(0, 2)
    : [];
  const blurUrls: string[] = [];
  for (const originalBlurPath of blurPathList) {
    const signed = await signPathWithCache(adminClient, originalBlurPath, requestId, counters);
    if (signed) {
      blurUrls.push(signed);
      continue;
    }
    const blurWebpPath = toBlurWebpPath(originalBlurPath);
    const blurPublicUrl = membersOnly ? "" : await getLitePublicUrlIfAvailable(adminClient, blurWebpPath);
    if (blurPublicUrl) blurUrls.push(blurPublicUrl);
  }
  if (blurUrls.length > 0) return blurUrls;

  const normalizedBlurThumbPath = normalizeDatingPhotoPath(blurThumbPath);
  if (isDatingCardBlurPath(normalizedBlurThumbPath, ownerId)) {
    const blurThumbWebpPath = toBlurWebpPath(normalizedBlurThumbPath);
    const publicThumb = membersOnly ? "" : await getLitePublicUrlIfAvailable(adminClient, blurThumbWebpPath);
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

  // 留덉?留??덉쟾?μ튂: blur/lite ?먯궛 ?꾨씫 ??raw signed瑜??곸꽭?먯꽌留??쒗븳?곸쑝濡??덉슜
  return [];
}

const privateCardHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const { user } = await getRequestAuthContext(req);
  const ip = extractClientIp(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

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
      "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, photo_visibility, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_paths, blur_thumb_path, instagram_id, expires_at, created_at, status, members_only"
    )
    .eq("id", id)
    .single();

  if (error && isMissingColumnError(error)) {
    const legacyRes = await adminClient
      .from("dating_cards")
      .select(
        "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, instagram_id, expires_at, created_at, status, members_only"
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

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: "카드를 잠시 불러오지 못했어요. 다시 시도해 주세요." }, { status: 503, headers: privateCardHeaders });
  }
  if (!data) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  if (user?.id) {
    const blocked = await hasDatingBlockBetween(adminClient, user.id, String(data.owner_user_id ?? ""));
    const contactBlocked = await hasDatingContactBlockBetween(adminClient, user.id, String(data.owner_user_id ?? ""), {
      userBInstagramIds: [data.instagram_id],
    });
    if (blocked || contactBlocked) {
      return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
    }
  }

  const isPublicAvailable = data.status === "public" && !!data.expires_at && new Date(data.expires_at).getTime() > Date.now();
  let canReadPending = false;
  let viaLovePass = false;
  if (!isPublicAvailable && data.status === "pending" && user?.id) {
    const byMoreView = await hasMoreViewAccess(adminClient, user.id, data.sex);
    const byCityView = await hasCityViewCardAccess(adminClient, user.id, String(data.id ?? id), data.region ?? null);
    canReadPending = byMoreView || byCityView;
    if (!canReadPending) {
      viaLovePass = await hasLovePassNearbyCardAccess(adminClient, user.id, String(data.id ?? id));
      canReadPending = viaLovePass;
    }
  }

  if (!isPublicAvailable && !canReadPending) {
    return NextResponse.json({ error: "현재 열람할 수 없는 카드입니다." }, { status: 403 });
  }

  const photoVisibility = data.photo_visibility === "public" ? "public" : "blur";
  let isPhoneVerified = false;
  if (data.owner_user_id) {
    const profileRes = await adminClient
      .from("profiles")
      .select("phone_verified")
      .eq("user_id", data.owner_user_id)
      .maybeSingle();
    isPhoneVerified = profileRes.data?.phone_verified === true;
  }
  const imageUrls = viaLovePass ? getLovePassPhotoPaths(data).map((_, slot) => `/api/dating/love-pass/photo?cardId=${encodeURIComponent(data.id)}&slot=${slot}`) : await createSignedImageUrls(
    adminClient,
    data.owner_user_id,
    data.photo_paths,
    data.blur_paths,
    data.blur_thumb_path,
    photoVisibility,
    requestId,
    counters,
    data.members_only === true
  );

  console.log(
    `[signedUrl.stats] requestId=${requestId} scope=dating-cards-signed-urls signCalls=${counters.signCalls} cacheHit=${counters.cacheHit} cacheMiss=${counters.cacheMiss}`
  );

  return NextResponse.json({
    card: {
      id: data.id,
      owner_user_id: data.owner_user_id,
      sex: data.sex,
      display_nickname: data.display_nickname,
      is_phone_verified: isPhoneVerified,
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
  }, { headers: privateCardHeaders });
}



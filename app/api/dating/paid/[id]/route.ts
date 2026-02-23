import { createAdminClient } from "@/lib/supabase/server";
import { buildPublicLiteImageUrl, buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { kvGetString, kvSetString } from "@/lib/edge-kv";
import { NextResponse } from "next/server";

function normalizeDatingPhotoPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";
  return (
    extractStorageObjectPathFromBuckets(value, ["dating-card-photos", "dating-photos"]) ??
    value
  );
}

const LITE_PUBLIC_BUCKET = "dating-card-lite";
const LITE_PUBLIC_PROBE_TTL_MS = 6 * 60 * 60 * 1000;
const LITE_PUBLIC_NEGATIVE_PROBE_TTL_MS = 5 * 60 * 1000;

type LitePublicProbeCacheValue = {
  exists: boolean;
  expiresAtEpochMs: number;
};

const litePublicProbeCache = new Map<string, LitePublicProbeCacheValue>();

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
  admin: ReturnType<typeof createAdminClient>,
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
  const publicUrl = admin.storage.from(LITE_PUBLIC_BUCKET).getPublicUrl(litePath).data.publicUrl;
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
  const signCalls = 0;
  const cacheHit = 0;
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

  const rawPaths = Array.isArray(data.photo_paths)
    ? data.photo_paths
        .map((item) => normalizeDatingPhotoPath(item))
        .filter((item) => item.length > 0)
        .slice(0, 2)
    : [];

  const createSignedUrl = async (path: string) => {
    const proxy = buildSignedImageUrl("dating-card-photos", path);
    if (proxy) cacheMiss += 1;
    return proxy;
  };

  const imageUrls: string[] = [];
  if (data.photo_visibility === "public") {
    for (const rawPath of rawPaths) {
      let url = await getLitePublicUrlIfAvailable(admin, toLitePath(rawPath));
      if (!url) url = await createSignedUrl(toLitePath(rawPath));
      if (!url) url = await createSignedUrl(rawPath);
      if (!url) url = await getLitePublicUrlIfAvailable(admin, toThumbPath(rawPath));
      if (url) imageUrls.push(url);
    }
  } else {
    for (const rawPath of rawPaths) {
      let url = await getLitePublicUrlIfAvailable(admin, toLitePath(rawPath));
      if (!url) url = await createSignedUrl(toLitePath(rawPath));
      if (!url) url = await createSignedUrl(rawPath);
      if (!url) url = await getLitePublicUrlIfAvailable(admin, toThumbPath(rawPath));
      if (url) imageUrls.push(url);
    }

    if (imageUrls.length === 0) {
      const blurThumbPath = normalizeDatingPhotoPath(data.blur_thumb_path);
      if (blurThumbPath) {
        const blurWebpPath = toBlurWebpPath(blurThumbPath);
        let blurUrl = await getLitePublicUrlIfAvailable(admin, blurWebpPath);
        if (!blurUrl) {
          blurUrl = await createSignedUrl(blurThumbPath);
        }
        if (blurUrl) imageUrls.push(blurUrl);
      }
    }
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
      image_urls: imageUrls,
      photo_visibility: data.photo_visibility === "public" ? "public" : "blur",
    },
  });
}

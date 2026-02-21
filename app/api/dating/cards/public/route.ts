import { syncOpenCardQueue } from "@/lib/dating-cards-queue";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { getCachedSignedUrlResolved } from "@/lib/signed-url-cache";
import { kvGetString } from "@/lib/edge-kv";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const SIGNED_URL_TTL_SEC = 3600;
const RAW_COUNT_MAX = 40;
const THUMB_LIST_TRANSFORM = { width: 560, quality: 68 };
const RAW_LIST_TRANSFORM = { width: 720, quality: 72 };
const BLUR_LIST_TRANSFORM = { width: 720, quality: 70 };
const LITE_PUBLIC_BUCKET = "dating-card-lite";
const LITE_PUBLIC_RENDER_WIDTH = 560;
const LITE_PUBLIC_RENDER_QUALITY = 68;
const LITE_PUBLIC_PROBE_TTL_MS = 6 * 60 * 60 * 1000;
const LITE_PUBLIC_NEGATIVE_PROBE_TTL_MS = 5 * 60 * 1000;

type LitePublicProbeCacheValue = {
  exists: boolean;
  expiresAtEpochMs: number;
};

const litePublicProbeCache = new Map<string, LitePublicProbeCacheValue>();

function parseIntSafe(value: string | null, fallback: number) {
  if (!value) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

function parseCursorTs(value: string | null): string | null {
  if (!value) return null;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  return ts.toISOString();
}

function parseCursorId(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

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
  rawCount: number;
  blurCount: number;
  rawGuardExceeded: boolean;
  rawGuardFallbackCount: number;
};

function toLitePath(rawPath: string): string {
  return rawPath.replace("/raw/", "/lite/").replace(/\.[^.\/]+$/, ".webp");
}

function toThumbPath(rawPath: string): string {
  return rawPath.replace("/raw/", "/thumb/").replace(/\.[^.\/]+$/, ".webp");
}

async function getLitePublicUrlIfAvailable(
  adminClient: ReturnType<typeof createAdminClient>,
  litePath: string
): Promise<string> {
  const now = Date.now();
  const cachedProbe = litePublicProbeCache.get(litePath);
  if (cachedProbe && cachedProbe.expiresAtEpochMs > now) {
    if (!cachedProbe.exists) return "";
    const publicUrlCached = adminClient.storage.from(LITE_PUBLIC_BUCKET).getPublicUrl(litePath).data.publicUrl;
    return typeof publicUrlCached === "string" ? toPublicRenderListUrl(publicUrlCached) : "";
  }

  const marker = await kvGetString(`litepublic:${litePath}`);
  const publicUrl = adminClient.storage.from(LITE_PUBLIC_BUCKET).getPublicUrl(litePath).data.publicUrl;
  if (typeof publicUrl !== "string" || !publicUrl) return "";
  if (marker) {
    litePublicProbeCache.set(litePath, { exists: true, expiresAtEpochMs: now + LITE_PUBLIC_PROBE_TTL_MS });
    return toPublicRenderListUrl(publicUrl);
  }

  const probe = await fetch(publicUrl, { method: "HEAD", cache: "no-store" }).catch(() => null);
  if (probe?.ok) {
    litePublicProbeCache.set(litePath, { exists: true, expiresAtEpochMs: now + LITE_PUBLIC_PROBE_TTL_MS });
    return toPublicRenderListUrl(publicUrl);
  }

  litePublicProbeCache.set(litePath, {
    exists: false,
    expiresAtEpochMs: now + LITE_PUBLIC_NEGATIVE_PROBE_TTL_MS,
  });
  return "";
}

function toPublicRenderListUrl(publicUrl: string): string {
  const converted = publicUrl.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  const separator = converted.includes("?") ? "&" : "?";
  return `${converted}${separator}width=${LITE_PUBLIC_RENDER_WIDTH}&quality=${LITE_PUBLIC_RENDER_QUALITY}`;
}

async function signPathWithCache(
  adminClient: ReturnType<typeof createAdminClient>,
  path: string,
  requestId: string,
  counters: SignCounters,
  variant: "thumb-list" | "raw-list" | "blur-list"
) {
  const transform =
    variant === "thumb-list" ? THUMB_LIST_TRANSFORM : variant === "raw-list" ? RAW_LIST_TRANSFORM : BLUR_LIST_TRANSFORM;
  const result = await getCachedSignedUrlResolved({
    requestId,
    path,
    cachePath: `${path}::${variant}:w${transform.width}:q${transform.quality}`,
    ttlSec: SIGNED_URL_TTL_SEC,
    buckets: ["dating-card-photos", "dating-photos"],
    getSignCallCount: () => counters.signCalls,
    createSignedUrl: async (bucket, p, ttlSec) => {
      counters.signCalls += 1;
      const transformed = await adminClient.storage
        .from(bucket)
        .createSignedUrl(p, ttlSec, { transform });
      if (!transformed.error && transformed.data?.signedUrl) return transformed.data.signedUrl;
      const fallback = await adminClient.storage.from(bucket).createSignedUrl(p, ttlSec);
      if (fallback.error || !fallback.data?.signedUrl) return "";
      return fallback.data.signedUrl;
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
      const thumbPath = toThumbPath(rawPath);
      const thumbPublicUrl = await getLitePublicUrlIfAvailable(adminClient, thumbPath);
      if (thumbPublicUrl) {
        rawUrls.push(thumbPublicUrl);
        counters.rawCount += 1;
        continue;
      }
      const thumbSigned = await signPathWithCache(adminClient, thumbPath, requestId, counters, "thumb-list");
      if (thumbSigned) {
        rawUrls.push(thumbSigned);
        counters.rawCount += 1;
        continue;
      }
      const litePath = toLitePath(rawPath);
      const litePublicUrl = await getLitePublicUrlIfAvailable(adminClient, litePath);
      if (litePublicUrl) {
        rawUrls.push(litePublicUrl);
        counters.rawCount += 1;
        continue;
      }
      const liteSigned = await signPathWithCache(adminClient, litePath, requestId, counters, "raw-list");
      if (liteSigned) {
        rawUrls.push(liteSigned);
        counters.rawCount += 1;
        continue;
      }
      if (counters.rawCount >= RAW_COUNT_MAX) {
        counters.rawGuardExceeded = true;
        counters.rawGuardFallbackCount += 1;
        break;
      }
      const signed = await signPathWithCache(adminClient, rawPath, requestId, counters, "raw-list");
      if (signed) {
        rawUrls.push(signed);
        counters.rawCount += 1;
      }
    }
    if (rawUrls.length > 0 && !counters.rawGuardExceeded) return rawUrls;
  }

  const blurPathList = Array.isArray(blurPaths)
    ? blurPaths.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 2)
    : [];
  const blurUrls: string[] = [];
  for (const blurPath of blurPathList) {
    const signed = await signPathWithCache(adminClient, blurPath, requestId, counters, "blur-list");
    if (signed) {
      blurUrls.push(signed);
      counters.blurCount += 1;
    }
  }
  if (blurUrls.length > 0) return blurUrls;

  if (typeof blurThumbPath === "string" && blurThumbPath) {
    const thumb = await signPathWithCache(adminClient, blurThumbPath, requestId, counters, "blur-list");
    if (thumb) {
      counters.blurCount += 1;
      if (photoVisibility === "blur") return [thumb, thumb];
      return [thumb];
    }
  }

  return [];
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
    scope: "dating-cards-list",
    userId: user?.id ?? null,
    ip,
    userLimitPerMin: 30,
    ipLimitPerMin: 120,
    path: "/api/dating/cards/public",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMIT", message: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSec) } }
    );
  }

  const counters: SignCounters = {
    signCalls: 0,
    cacheHit: 0,
    cacheMiss: 0,
    rawCount: 0,
    blurCount: 0,
    rawGuardExceeded: false,
    rawGuardFallbackCount: 0,
  };

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseIntSafe(searchParams.get("limit"), 20), 50);
  const cursorCreatedAt = parseCursorTs(searchParams.get("cursorCreatedAt"));
  const cursorId = parseCursorId(searchParams.get("cursorId"));
  const sex = searchParams.get("sex");

  const adminClient = createAdminClient();
  await syncOpenCardQueue(adminClient).catch((error) => {
    console.error(`[GET /api/dating/cards/list] requestId=${requestId} queue sync failed`, error);
  });

  let query = adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, photo_visibility, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_paths, blur_thumb_path, expires_at, created_at"
    )
    .eq("status", "public")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (sex === "male" || sex === "female") {
    query = query.eq("sex", sex);
  }
  if (cursorCreatedAt && cursorId) {
    query = query.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`);
  } else if (cursorCreatedAt) {
    query = query.lt("created_at", cursorCreatedAt);
  }

  const queryStart = Date.now();
  let { data, error } = await query;
  const queryMs = Date.now() - queryStart;
  if (queryMs > 200) {
    console.warn(`[slow.query] requestId=${requestId} name=dating_cards_public durationMs=${queryMs}`);
  }
  if (error && isMissingColumnError(error)) {
    let legacyQuery = adminClient
      .from("dating_cards")
      .select(
        "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, expires_at, created_at"
      )
      .eq("status", "public")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (sex === "male" || sex === "female") {
      legacyQuery = legacyQuery.eq("sex", sex);
    }
    if (cursorCreatedAt && cursorId) {
      legacyQuery = legacyQuery.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`);
    } else if (cursorCreatedAt) {
      legacyQuery = legacyQuery.lt("created_at", cursorCreatedAt);
    }
    const legacyStart = Date.now();
    const legacyRes = await legacyQuery;
    const legacyMs = Date.now() - legacyStart;
    if (legacyMs > 200) {
      console.warn(`[slow.query] requestId=${requestId} name=dating_cards_public_legacy durationMs=${legacyMs}`);
    }
    data = (legacyRes.data ?? []).map((row) => ({
      ...row,
      strengths_text: null,
      photo_visibility: "blur",
      blur_paths: [],
    }));
    error = legacyRes.error;
  }
  if (error) {
    const err = error as { code?: string; message?: string };
    console.error(`[GET /api/dating/cards/list] requestId=${requestId} failed`, {
      code: err?.code ?? null,
      message: err?.message ?? null,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "카드 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const items = await Promise.all(
    pageRows.map(async (row) => {
      const photoVisibility = row.photo_visibility === "public" ? "public" : "blur";
      const imageUrls = await createSignedImageUrls(
        adminClient,
        row.photo_paths,
        row.blur_paths,
        row.blur_thumb_path,
        photoVisibility,
        requestId,
        counters
      );
      return {
        id: row.id,
        sex: row.sex,
        display_nickname: row.display_nickname,
        age: row.age,
        region: row.region,
        height_cm: row.height_cm,
        job: row.job,
        training_years: row.training_years,
        ideal_type: row.ideal_type,
        strengths_text: row.strengths_text,
        photo_visibility: photoVisibility,
        total_3lift: row.total_3lift,
        percent_all: row.percent_all,
        is_3lift_verified: row.is_3lift_verified,
        image_urls: imageUrls,
        expires_at: row.expires_at,
        created_at: row.created_at,
      };
    })
  );

  console.log(
    `[signedUrl.guard] requestId=${requestId} rawCount=${counters.rawCount} exceeded=${counters.rawGuardExceeded} fallbackCount=${counters.rawGuardFallbackCount}`
  );
  console.log(
    `[signedUrl.stats] requestId=${requestId} signCalls=${counters.signCalls} cacheHit=${counters.cacheHit} cacheMiss=${counters.cacheMiss}`
  );
  const signedTotal = counters.cacheHit + counters.cacheMiss;
  const cacheHitRatePct = signedTotal > 0 ? Math.round((counters.cacheHit / signedTotal) * 1000) / 10 : 0;
  console.log(
    `[list.metrics] requestId=${requestId} path=/api/dating/cards/public cards=${items.length} rawSigned=${counters.rawCount} blurSigned=${counters.blurCount} cacheHitRatePct=${cacheHitRatePct} signCalls=${counters.signCalls}`
  );

  const lastItem = items.length > 0 ? items[items.length - 1] : null;
  return NextResponse.json(
    {
      items,
      hasMore,
      nextCursorCreatedAt: hasMore && lastItem ? lastItem.created_at : null,
      nextCursorId: hasMore && lastItem ? lastItem.id : null,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    }
  );
}

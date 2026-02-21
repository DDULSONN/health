import { createAdminClient } from "@/lib/supabase/server";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { buildPublicLiteImageUrl, buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { kvGetString } from "@/lib/edge-kv";
import { NextResponse } from "next/server";

const LITE_PUBLIC_BUCKET = "dating-card-lite";
const LITE_PUBLIC_PROBE_TTL_MS = 6 * 60 * 60 * 1000;
const LITE_PUBLIC_NEGATIVE_PROBE_TTL_MS = 5 * 60 * 1000;

type LitePublicProbeCacheValue = {
  exists: boolean;
  expiresAtEpochMs: number;
};

const litePublicProbeCache = new Map<string, LitePublicProbeCacheValue>();

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
}

function toLitePath(rawPath: string): string {
  return rawPath.replace("/raw/", "/lite/").replace(/\.[^.\/]+$/, ".webp");
}

function toThumbPath(rawPath: string): string {
  return rawPath.replace("/raw/", "/thumb/").replace(/\.[^.\/]+$/, ".webp");
}

function normalizeDatingPhotoPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";
  return (
    extractStorageObjectPathFromBuckets(value, ["dating-card-photos", "dating-photos"]) ??
    value
  );
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
  const proxyUrl = buildPublicLiteImageUrl(LITE_PUBLIC_BUCKET, litePath);
  if (!proxyUrl) return "";
  const publicUrl = admin.storage.from(LITE_PUBLIC_BUCKET).getPublicUrl(litePath).data.publicUrl;
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

type SignCounters = { signCalls: number; cacheHit: number; cacheMiss: number; rawSigned: number; blurSigned: number };

async function createSignedUrl(
  _admin: ReturnType<typeof createAdminClient>,
  _requestId: string,
  path: string,
  counters: SignCounters,
  _variant: "thumb-list" | "raw-list" | "blur-list"
) {
  const proxy = buildSignedImageUrl("dating-card-photos", path);
  if (proxy) counters.cacheMiss += 1;
  return proxy;
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[dating-paid-list] ${requestId} start`);

  try {
    const admin = createAdminClient();
    const ip = extractClientIp(req);
    const rateLimit = await checkRouteRateLimit({
      requestId,
      scope: "dating-paid-list",
      userId: null,
      ip,
      userLimitPerMin: 30,
      ipLimitPerMin: 120,
      path: "/api/dating/paid/list",
    });
    if (!rateLimit.allowed) {
      return json(429, { ok: false, code: "RATE_LIMIT", requestId, message: "Too many requests" });
    }
    const counters: SignCounters = { signCalls: 0, cacheHit: 0, cacheMiss: 0, rawSigned: 0, blurSigned: 0 };
    const nowIso = new Date().toISOString();

    // Opportunistic expiration so stale approved cards are 내려감 even without cron timing drift.
    const expireRes = await admin
      .from("dating_paid_cards")
      .update({ status: "expired" })
      .eq("status", "approved")
      .lte("expires_at", nowIso);
    if (expireRes.error) {
      console.error(`[dating-paid-list] ${requestId} expire update error`, expireRes.error);
    }

    const { data, error } = await admin
      .from("dating_paid_cards")
      .select(
        "id,nickname,gender,age,region,height_cm,job,training_years,strengths_text,ideal_text,intro_text,is_3lift_verified,photo_visibility,blur_thumb_path,photo_paths,expires_at,paid_at,created_at"
      )
      .eq("status", "approved")
      .gt("expires_at", nowIso)
      .order("paid_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) {
      const err = error as { code?: string; message?: string };
      console.error(`[dating-paid-list] ${requestId} query error`, {
        code: err?.code ?? null,
        message: err?.message ?? null,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return json(500, { ok: false, code: "LIST_FAILED", requestId, message: "목록을 불러오지 못했습니다." });
    }

    const items = await Promise.all(
      (data ?? []).map(async (row) => {
        const firstPath =
          Array.isArray(row.photo_paths) && row.photo_paths.length > 0
            ? normalizeDatingPhotoPath(row.photo_paths[0])
            : "";

        let thumbUrl = "";
        if (row.photo_visibility === "public" && firstPath) {
          const thumbPath = toThumbPath(firstPath);
          thumbUrl = await getLitePublicUrlIfAvailable(admin, thumbPath);
          if (!thumbUrl) {
            thumbUrl = await createSignedUrl(admin, requestId, thumbPath, counters, "thumb-list");
          }
          const litePath = toLitePath(firstPath);
          if (!thumbUrl) {
            thumbUrl = await getLitePublicUrlIfAvailable(admin, litePath);
          }
          if (!thumbUrl) {
            thumbUrl = await createSignedUrl(admin, requestId, litePath, counters, "raw-list");
          }
          if (!thumbUrl) {
            thumbUrl = await createSignedUrl(admin, requestId, firstPath, counters, "raw-list");
          }
          if (thumbUrl) counters.rawSigned += 1;
        } else {
          const blurThumbPath = normalizeDatingPhotoPath(row.blur_thumb_path);
          if (blurThumbPath) {
            thumbUrl = await createSignedUrl(admin, requestId, blurThumbPath, counters, "blur-list");
          }
          if (thumbUrl) counters.blurSigned += 1;
        }

        return {
          id: row.id,
          nickname: row.nickname,
          gender: row.gender,
          age: row.age,
          region: row.region,
          height_cm: row.height_cm,
          job: row.job,
          training_years: row.training_years,
          is_3lift_verified: Boolean(row.is_3lift_verified),
          strengths_text: row.strengths_text,
          ideal_text: row.ideal_text,
          intro_text: row.intro_text,
          thumbUrl,
          expires_at: row.expires_at,
          paid_at: row.paid_at,
        };
      })
    );

    const signedTotal = counters.cacheHit + counters.cacheMiss;
    const cacheHitRatePct = signedTotal > 0 ? Math.round((counters.cacheHit / signedTotal) * 1000) / 10 : 0;
    console.log(
      `[list.metrics] requestId=${requestId} path=/api/dating/paid/list cards=${items.length} rawSigned=${counters.rawSigned} blurSigned=${counters.blurSigned} cacheHitRatePct=${cacheHitRatePct} signCalls=${counters.signCalls}`
    );

    return json(200, { ok: true, requestId, items });
  } catch (error) {
    console.error(`[dating-paid-list] ${requestId} unhandled`, {
      message: error instanceof Error ? error.message : null,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}

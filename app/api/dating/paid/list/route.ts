import { createAdminClient } from "@/lib/supabase/server";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { getCachedSignedUrlResolved } from "@/lib/signed-url-cache";
import { NextResponse } from "next/server";

const SIGNED_URL_TTL_SEC = 3600;
const RAW_LIST_TRANSFORM = { width: 1200, quality: 78 };
const BLUR_LIST_TRANSFORM = { width: 720, quality: 70 };

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

type SignCounters = { signCalls: number; cacheHit: number; cacheMiss: number; rawSigned: number; blurSigned: number };

async function createSignedUrl(
  admin: ReturnType<typeof createAdminClient>,
  requestId: string,
  path: string,
  counters: SignCounters,
  variant: "raw-list" | "blur-list"
) {
  const transform = variant === "raw-list" ? RAW_LIST_TRANSFORM : BLUR_LIST_TRANSFORM;
  const result = await getCachedSignedUrlResolved({
    requestId,
    path,
    cachePath: `${path}::${variant}:w${transform.width}:q${transform.quality}`,
    ttlSec: SIGNED_URL_TTL_SEC,
    buckets: ["dating-card-photos", "dating-photos"],
    getSignCallCount: () => counters.signCalls,
    createSignedUrl: async (bucket, p, ttlSec) => {
      counters.signCalls += 1;
      const transformed = await admin.storage
        .from(bucket)
        .createSignedUrl(p, ttlSec, { transform });
      if (!transformed.error && transformed.data?.signedUrl) return transformed.data.signedUrl;
      const fallback = await admin.storage.from(bucket).createSignedUrl(p, ttlSec);
      if (fallback.error || !fallback.data?.signedUrl) return "";
      return fallback.data.signedUrl;
    },
  });
  if (result.cacheStatus === "hit") counters.cacheHit += 1;
  if (result.cacheStatus === "miss") counters.cacheMiss += 1;
  return result.url;
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
          Array.isArray(row.photo_paths) && row.photo_paths.length > 0 && typeof row.photo_paths[0] === "string"
            ? row.photo_paths[0]
            : "";

        let thumbUrl = "";
        if (row.photo_visibility === "public" && firstPath) {
          thumbUrl = await createSignedUrl(admin, requestId, toLitePath(firstPath), counters, "raw-list");
          if (!thumbUrl) {
            thumbUrl = await createSignedUrl(admin, requestId, firstPath, counters, "raw-list");
          }
          if (thumbUrl) counters.rawSigned += 1;
        } else if (row.blur_thumb_path) {
          thumbUrl = await createSignedUrl(admin, requestId, row.blur_thumb_path, counters, "blur-list");
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

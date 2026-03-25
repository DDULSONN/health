import { createAdminClient } from "@/lib/supabase/server";
import { publicCachedJson } from "@/lib/http-cache";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { buildPublicLiteImageUrl, buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { kvGetString, kvSetString } from "@/lib/edge-kv";
import { shouldRunAtMostEvery } from "@/lib/throttled-task";
import { ensureBlurThumbFromRaw } from "@/lib/dating-blur-thumb";
import { NextResponse } from "next/server";

const LITE_PUBLIC_BUCKET = "dating-card-lite";
const LITE_PUBLIC_PROBE_TTL_MS = 6 * 60 * 60 * 1000;
const LITE_PUBLIC_NEGATIVE_PROBE_TTL_MS = 5 * 60 * 1000;
const PAID_CARD_EXPIRE_SYNC_INTERVAL_SEC = 60;

type LitePublicProbeCacheValue = {
  exists: boolean;
  expiresAtEpochMs: number;
};

const litePublicProbeCache = new Map<string, LitePublicProbeCacheValue>();

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("column") || message.includes("display_mode");
}

function toTimeMs(value: unknown): number {
  if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function jsonNoStore(status: number, payload: Record<string, unknown>) {
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

function toBlurWebpPath(path: string): string {
  return path.includes("/blur/") ? path.replace(/\.[^.\/]+$/, ".webp") : path;
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

type SignCounters = { signCalls: number; cacheHit: number; cacheMiss: number; rawSigned: number; blurSigned: number };

async function createSignedUrl(
  _admin: ReturnType<typeof createAdminClient>,
  _requestId: string,
  path: string,
  counters: SignCounters
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
      return jsonNoStore(429, { ok: false, code: "RATE_LIMIT", requestId, message: "Too many requests" });
    }
    const counters: SignCounters = { signCalls: 0, cacheHit: 0, cacheMiss: 0, rawSigned: 0, blurSigned: 0 };
    const nowIso = new Date().toISOString();

    // Opportunistic expiration so stale approved cards are 내려감 even without cron timing drift.
    if (await shouldRunAtMostEvery("dating:paid-cards:expire-sync", PAID_CARD_EXPIRE_SYNC_INTERVAL_SEC)) {
      const expireRes = await admin
        .from("dating_paid_cards")
        .update({ status: "expired" })
        .eq("status", "approved")
        .lte("expires_at", nowIso);
      if (expireRes.error) {
        console.error(`[dating-paid-list] ${requestId} expire update error`, expireRes.error);
      }
    }

    const queryRes = await admin
      .from("dating_paid_cards")
      .select(
        "id,user_id,nickname,gender,age,region,height_cm,job,training_years,strengths_text,ideal_text,intro_text,is_3lift_verified,photo_visibility,display_mode,blur_thumb_path,photo_paths,expires_at,paid_at,created_at"
      )
      .eq("status", "approved")
      .gt("expires_at", nowIso);

    let rowsData = (queryRes.data as Array<Record<string, unknown>> | null) ?? null;
    let rowsError = queryRes.error;

    if (rowsError && isMissingColumnError(rowsError)) {
      const legacy = await admin
        .from("dating_paid_cards")
        .select(
          "id,user_id,nickname,gender,age,region,height_cm,job,training_years,strengths_text,ideal_text,intro_text,is_3lift_verified,photo_visibility,blur_thumb_path,photo_paths,expires_at,paid_at,created_at"
        )
        .eq("status", "approved")
        .gt("expires_at", nowIso);
      rowsError = legacy.error;
      rowsData = (legacy.data ?? []).map((row) => ({
        ...(row as Record<string, unknown>),
        display_mode: "priority_24h",
      }));
    }

    if (rowsError) {
      const err = rowsError as { code?: string; message?: string };
      console.error(`[dating-paid-list] ${requestId} query error`, {
        code: err?.code ?? null,
        message: err?.message ?? null,
        stack: rowsError instanceof Error ? rowsError.stack : undefined,
      });
      return jsonNoStore(500, { ok: false, code: "LIST_FAILED", requestId, message: "목록을 불러오지 못했습니다." });
    }

    const rows = (rowsData ?? []).sort((a, b) => {
      const aMode = a.display_mode === "instant_public" ? "instant_public" : "priority_24h";
      const bMode = b.display_mode === "instant_public" ? "instant_public" : "priority_24h";
      const aRank = aMode === "priority_24h" ? 0 : 1;
      const bRank = bMode === "priority_24h" ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;

      if (aMode === "priority_24h" && bMode === "priority_24h") {
        const aPaid = toTimeMs(a.paid_at);
        const bPaid = toTimeMs(b.paid_at);
        if (aPaid !== bPaid) return aPaid - bPaid;
        const aCreated = toTimeMs(a.created_at);
        const bCreated = toTimeMs(b.created_at);
        return aCreated - bCreated;
      }

      const aCreated = toTimeMs(a.created_at);
      const bCreated = toTimeMs(b.created_at);
      return bCreated - aCreated;
    });
    const ownerIds = [...new Set(rows.map((row) => String(row.user_id ?? "")).filter((id) => id.length > 0))];
    const phoneVerifiedByOwner = new Map<string, boolean>();
    if (ownerIds.length > 0) {
      const profileRes = await admin.from("profiles").select("user_id,phone_verified").in("user_id", ownerIds);
      if (!profileRes.error && Array.isArray(profileRes.data)) {
        for (const profile of profileRes.data as Array<{ user_id: string; phone_verified: boolean | null }>) {
          phoneVerifiedByOwner.set(String(profile.user_id), profile.phone_verified === true);
        }
      }
    }

    const items = await Promise.all(
      rows.map(async (row) => {
        const rawPaths = Array.isArray(row.photo_paths)
          ? row.photo_paths
              .map((item) => normalizeDatingPhotoPath(item))
              .filter((item) => item.length > 0)
              .slice(0, 2)
          : [];

        let thumbUrl = "";
        if (row.photo_visibility === "public" && rawPaths.length > 0) {
          for (const rawPath of rawPaths) {
            const litePath = toLitePath(rawPath);
            thumbUrl = await getLitePublicUrlIfAvailable(admin, litePath);
            if (!thumbUrl) {
              const thumbPath = toThumbPath(rawPath);
              thumbUrl = await getLitePublicUrlIfAvailable(admin, thumbPath);
            }
            if (thumbUrl) break;
          }
          if (thumbUrl) counters.rawSigned += 1;
        } else {
          let blurThumbPath = normalizeDatingPhotoPath(row.blur_thumb_path);
          if (!blurThumbPath && rawPaths.length > 0) {
            blurThumbPath = (await ensureBlurThumbFromRaw(admin, rawPaths[0])) ?? "";
          }
          if (blurThumbPath) {
            const blurWebpPath = toBlurWebpPath(blurThumbPath);
            thumbUrl = await getLitePublicUrlIfAvailable(admin, blurWebpPath);
            if (!thumbUrl) {
              thumbUrl = await createSignedUrl(admin, requestId, blurThumbPath, counters);
            }
          }
          if (thumbUrl) counters.blurSigned += 1;
        }

        return {
          id: row.id,
          nickname: row.nickname,
          is_phone_verified: phoneVerifiedByOwner.get(String(row.user_id ?? "")) === true,
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
          created_at: row.created_at,
          display_mode: row.display_mode === "instant_public" ? "instant_public" : "priority_24h",
        };
      })
    );

    const signedTotal = counters.cacheHit + counters.cacheMiss;
    const cacheHitRatePct = signedTotal > 0 ? Math.round((counters.cacheHit / signedTotal) * 1000) / 10 : 0;
    console.log(
      `[list.metrics] requestId=${requestId} path=/api/dating/paid/list cards=${items.length} rawSigned=${counters.rawSigned} blurSigned=${counters.blurSigned} cacheHitRatePct=${cacheHitRatePct} signCalls=${counters.signCalls}`
    );

    return publicCachedJson({ ok: true, requestId, items }, { sMaxAge: 30, staleWhileRevalidate: 60 });
  } catch (error) {
    console.error(`[dating-paid-list] ${requestId} unhandled`, {
      message: error instanceof Error ? error.message : null,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonNoStore(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}

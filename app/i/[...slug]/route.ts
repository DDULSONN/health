import { getCachedSignedUrlWithBucket } from "@/lib/signed-url-cache";
import { hasCityViewCardAccess } from "@/lib/dating-city-view";
import { hasMoreViewAccess, normalizeCardSex } from "@/lib/dating-more-view";
import { isAllowedAdminUser } from "@/lib/admin";
import { extractStorageObjectPathFromBuckets } from "@/lib/images";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import sharp from "sharp";

export const runtime = "nodejs";

const SIGNED_TTL_SEC = 3600;
const OPTIMIZED_BUCKETS = new Set(["community", "dating-apply-photos"]);
const PUBLIC_SIGNED_BUCKETS = new Set(["community", "dating-card-lite"]);
const SENSITIVE_SIGNED_BUCKETS = new Set([
  "dating-card-photos",
  "dating-apply-photos",
  "dating-1on1-photos",
  "reels-dating-application-photos",
]);
const BLOCKED_SIGNED_PREFIXES: Record<string, string[]> = {
  "dating-apply-photos": ["admin-application-backups/"],
};
const DEFAULT_MAX_WIDTH = 1080;
const DEFAULT_QUALITY = 72;
const LONG_IMAGE_CACHE_CONTROL = "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800";

function pickUpstreamHeaders(src: Headers): Headers {
  const dst = new Headers();
  const allow = [
    "content-type",
    "content-length",
    "etag",
    "last-modified",
    "accept-ranges",
    "content-range",
    "cache-control",
  ];
  for (const key of allow) {
    const value = src.get(key);
    if (value) dst.set(key, value);
  }
  return dst;
}

function isCacheableImage(headers: Headers): boolean {
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.startsWith("image/");
}

function decodeSegments(parts: string[]): string {
  return parts.map((v) => decodeURIComponent(v)).join("/");
}

function ownerFromPath(objectPath: string): string {
  const parts = objectPath.split("/");
  return parts.length >= 2 && parts[0] === "cards" ? parts[1] : "";
}

function applicantFromApplyPath(objectPath: string): string {
  const parts = objectPath.split("/");
  if ((parts[0] === "card-applications" || parts[0] === "paid-card-applications") && parts.length >= 2) {
    return parts[1];
  }
  return "";
}

function applicantFromReelsApplyPath(objectPath: string): string {
  const parts = objectPath.split("/");
  return parts[0] === "applications" && parts.length >= 2 ? parts[1] : "";
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

function toBlurPath(rawPath: string): string {
  return rawPath.replace("/raw/", "/blur/").replace(/\.[^.\/]+$/, ".webp");
}

function pathList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function matchesDatingCardPhoto(objectPath: string, row: Record<string, unknown>): boolean {
  const rawPaths = pathList(row.photo_paths);
  const blurPaths = pathList(row.blur_paths);
  const blurThumbPath = typeof row.blur_thumb_path === "string" ? row.blur_thumb_path : "";
  const candidates = new Set<string>();

  for (const rawPath of rawPaths) {
    candidates.add(rawPath);
    candidates.add(toLitePath(rawPath));
    candidates.add(toThumbPath(rawPath));
    candidates.add(toBlurPath(rawPath));
  }
  for (const blurPath of blurPaths) {
    candidates.add(blurPath);
    candidates.add(toBlurWebpPath(blurPath));
  }
  if (blurThumbPath) {
    candidates.add(blurThumbPath);
    candidates.add(toBlurWebpPath(blurThumbPath));
  }
  return candidates.has(objectPath);
}

async function canReadSwipeRelatedDatingCardPhoto(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  ownerId: string,
  cardId: string
): Promise<boolean> {
  const [sentRes, receivedRes, matchRes] = await Promise.all([
    admin
      .from("dating_card_swipes")
      .select("id")
      .eq("actor_user_id", userId)
      .eq("target_user_id", ownerId)
      .eq("target_card_id", cardId)
      .eq("action", "like")
      .limit(1),
    admin
      .from("dating_card_swipes")
      .select("id")
      .eq("actor_user_id", ownerId)
      .eq("target_user_id", userId)
      .eq("actor_card_id", cardId)
      .eq("action", "like")
      .limit(1),
    admin
      .from("dating_card_swipe_matches")
      .select("id")
      .or(`and(user_a_id.eq.${userId},user_b_id.eq.${ownerId}),and(user_a_id.eq.${ownerId},user_b_id.eq.${userId})`)
      .limit(1),
  ]);

  return (
    (!sentRes.error && Array.isArray(sentRes.data) && sentRes.data.length > 0) ||
    (!receivedRes.error && Array.isArray(receivedRes.data) && receivedRes.data.length > 0) ||
    (!matchRes.error && Array.isArray(matchRes.data) && matchRes.data.length > 0)
  );
}

async function canReadAcceptedDatingCardPhoto(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  cardId: string
): Promise<boolean> {
  const acceptedRes = await admin
    .from("dating_card_applications")
    .select("id")
    .eq("applicant_user_id", userId)
    .eq("card_id", cardId)
    .eq("status", "accepted")
    .limit(1);

  return !acceptedRes.error && Array.isArray(acceptedRes.data) && acceptedRes.data.length > 0;
}

async function canReadDatingCardPhoto(
  admin: ReturnType<typeof createAdminClient>,
  objectPath: string,
  userId: string | null,
  isAdmin: boolean
): Promise<boolean> {
  const ownerId = ownerFromPath(objectPath);
  if (isAdmin || (ownerId && userId === ownerId)) return true;

  const isRaw = objectPath.includes("/raw/");
  const nowIso = new Date().toISOString();
  const openRowsRes = ownerId
    ? await admin
        .from("dating_cards")
        .select("id,owner_user_id,sex,region,status,expires_at,photo_visibility,photo_paths,blur_paths,blur_thumb_path")
        .eq("owner_user_id", ownerId)
        .limit(100)
    : await admin
        .from("dating_cards")
        .select("id,owner_user_id,sex,region,status,expires_at,photo_visibility,photo_paths,blur_paths,blur_thumb_path")
        .limit(100);

  if (!openRowsRes.error && Array.isArray(openRowsRes.data)) {
    for (const row of openRowsRes.data as Array<Record<string, unknown>>) {
      if (!matchesDatingCardPhoto(objectPath, row)) continue;
      const status = String(row.status ?? "");
      const expiresAt = typeof row.expires_at === "string" ? row.expires_at : "";
      const activePublic = status === "public" && expiresAt > nowIso;
      if (activePublic && (!isRaw || row.photo_visibility === "public")) return true;

      const rowOwnerId = typeof row.owner_user_id === "string" ? row.owner_user_id : "";
      const rowCardId = typeof row.id === "string" ? row.id : "";
      if (userId && rowOwnerId && rowCardId) {
        const acceptedConnection = await canReadAcceptedDatingCardPhoto(admin, userId, rowCardId);
        if (acceptedConnection) return !isRaw || row.photo_visibility === "public";

        const swipeRelated = await canReadSwipeRelatedDatingCardPhoto(admin, userId, rowOwnerId, rowCardId);
        if (swipeRelated) return !isRaw || row.photo_visibility === "public";
      }

      if (!userId || status !== "pending") return false;

      const sex = normalizeCardSex(row.sex);
      const byMoreView = sex ? await hasMoreViewAccess(admin, userId, sex) : false;
      const byCityView = await hasCityViewCardAccess(
        admin,
        userId,
        rowCardId,
        typeof row.region === "string" ? row.region : null
      );
      return byMoreView || byCityView;
    }
  }

  const paidRowsRes = ownerId
    ? await admin
        .from("dating_paid_cards")
        .select("id,user_id,status,expires_at,photo_visibility,photo_paths,blur_thumb_path")
        .eq("user_id", ownerId)
        .limit(100)
    : await admin
        .from("dating_paid_cards")
        .select("id,user_id,status,expires_at,photo_visibility,photo_paths,blur_thumb_path")
        .limit(100);

  if (!paidRowsRes.error && Array.isArray(paidRowsRes.data)) {
    for (const row of paidRowsRes.data as Array<Record<string, unknown>>) {
      if (!matchesDatingCardPhoto(objectPath, row)) continue;
      const activeApproved = row.status === "approved" && typeof row.expires_at === "string" && row.expires_at > nowIso;
      return activeApproved && (!isRaw || row.photo_visibility === "public");
    }
  }

  return false;
}

async function canReadApplyPhoto(
  admin: ReturnType<typeof createAdminClient>,
  objectPath: string,
  userId: string | null,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;
  const applicantId = applicantFromApplyPath(objectPath);
  if (!userId || !applicantId) return false;
  if (userId === applicantId) return true;

  if (objectPath.startsWith("card-applications/")) {
    const appRes = await admin
      .from("dating_card_applications")
      .select("card_id,applicant_user_id,photo_paths,photo_urls")
      .eq("applicant_user_id", applicantId)
      .limit(100);
    const appRows = !appRes.error && Array.isArray(appRes.data) ? appRes.data : [];
    const matchedCardIds = appRows
      .filter((row) => [...pathList(row.photo_paths), ...pathList(row.photo_urls)].includes(objectPath))
      .map((row) => String(row.card_id ?? ""))
      .filter(Boolean);
    if (matchedCardIds.length === 0) return false;

    const cardRes = await admin.from("dating_cards").select("id").in("id", matchedCardIds).eq("owner_user_id", userId).limit(1);
    return !cardRes.error && Array.isArray(cardRes.data) && cardRes.data.length > 0;
  }

  if (objectPath.startsWith("paid-card-applications/")) {
    const appRes = await admin
      .from("dating_paid_card_applications")
      .select("paid_card_id,applicant_user_id,photo_paths")
      .eq("applicant_user_id", applicantId)
      .limit(100);
    const appRows = !appRes.error && Array.isArray(appRes.data) ? appRes.data : [];
    const matchedCardIds = appRows
      .filter((row) => pathList(row.photo_paths).includes(objectPath))
      .map((row) => String(row.paid_card_id ?? ""))
      .filter(Boolean);
    if (matchedCardIds.length === 0) return false;

    const cardRes = await admin.from("dating_paid_cards").select("id").in("id", matchedCardIds).eq("user_id", userId).limit(1);
    return !cardRes.error && Array.isArray(cardRes.data) && cardRes.data.length > 0;
  }

  return false;
}

async function canReadOneOnOnePhoto(
  admin: ReturnType<typeof createAdminClient>,
  objectPath: string,
  userId: string | null,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;
  const ownerId = ownerFromPath(objectPath);
  if (!userId || !ownerId) return false;
  if (userId === ownerId) return true;

  const cardRes = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,photo_paths")
    .eq("user_id", ownerId)
    .limit(100);
  if (cardRes.error || !Array.isArray(cardRes.data)) return false;

  const matchingCards = cardRes.data.filter((row) => {
    const normalizedPaths = pathList(row.photo_paths)
      .map((path) => extractStorageObjectPathFromBuckets(path, ["dating-1on1-photos"]) ?? path);
    return normalizedPaths.includes(objectPath);
  });
  if (matchingCards.length === 0) return false;

  const hasActiveCard = matchingCards.some((row) => {
    const status = String(row.status ?? "");
    return ["submitted", "reviewing", "approved", "active"].includes(status);
  });
  if (hasActiveCard) return true;

  const cardIds = matchingCards
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);
  if (cardIds.length === 0) return false;

  const [sourceMatchRes, candidateMatchRes] = await Promise.all([
    admin
      .from("dating_1on1_match_proposals")
      .select("id")
      .eq("source_user_id", userId)
      .eq("candidate_user_id", ownerId)
      .in("candidate_card_id", cardIds)
      .limit(1),
    admin
      .from("dating_1on1_match_proposals")
      .select("id")
      .eq("candidate_user_id", userId)
      .eq("source_user_id", ownerId)
      .in("source_card_id", cardIds)
      .limit(1),
  ]);

  const hasSourceMatch = !sourceMatchRes.error && Array.isArray(sourceMatchRes.data) && sourceMatchRes.data.length > 0;
  const hasCandidateMatch =
    !candidateMatchRes.error && Array.isArray(candidateMatchRes.data) && candidateMatchRes.data.length > 0;
  return hasSourceMatch || hasCandidateMatch;
}

async function canReadReelsApplicationPhoto(objectPath: string, userId: string | null, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const applicantId = applicantFromReelsApplyPath(objectPath);
  return Boolean(userId && applicantId && userId === applicantId);
}

async function canReadSignedObject(req: Request, bucket: string, objectPath: string): Promise<boolean> {
  if (PUBLIC_SIGNED_BUCKETS.has(bucket)) return true;
  if (!SENSITIVE_SIGNED_BUCKETS.has(bucket)) return false;

  const { user } = await getRequestAuthContext(req);
  const userId = user?.id ?? null;
  const isAdmin = isAllowedAdminUser(user?.id, user?.email);
  const admin = createAdminClient();

  if (bucket === "dating-card-photos") {
    return canReadDatingCardPhoto(admin, objectPath, userId, isAdmin);
  }
  if (bucket === "dating-apply-photos") {
    return canReadApplyPhoto(admin, objectPath, userId, isAdmin);
  }
  if (bucket === "dating-1on1-photos") {
    return canReadOneOnOnePhoto(admin, objectPath, userId, isAdmin);
  }
  if (bucket === "reels-dating-application-photos") {
    return canReadReelsApplicationPhoto(objectPath, userId, isAdmin);
  }

  return false;
}

async function fetchPublicLite(bucket: string, objectPath: string, method: string, requestId: string) {
  const admin = createAdminClient();
  const publicUrl = admin.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
  if (!publicUrl) return new Response("Not Found", { status: 404 });

  const upstream = await fetch(publicUrl, {
    method,
    cache: "no-store",
  }).catch(() => null);
  if (!upstream) return new Response("Bad Gateway", { status: 502 });

  // Some legacy community images can be non-public/misconfigured even though list payload expects public.
  // In that case, retry through signed fetch so thumbnails don't randomly break.
  if (!upstream.ok && bucket === "community") {
    return fetchSigned(bucket, objectPath, method, requestId);
  }

  if (!upstream.ok) {
    const headers = pickUpstreamHeaders(upstream.headers);
    headers.set("Cache-Control", "no-store");
    headers.delete("set-cookie");
    return new Response(method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  }

  const headers = pickUpstreamHeaders(upstream.headers);
  if (isCacheableImage(upstream.headers)) {
    headers.set("Cache-Control", LONG_IMAGE_CACHE_CONTROL);
    headers.set("Vary", "Accept");
  } else {
    headers.set("Cache-Control", "no-store");
  }
  headers.delete("set-cookie");
  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function createSignedUpstreamUrl(bucket: string, objectPath: string, requestId: string): Promise<string> {
  let signCalls = 0;
  const signed = await getCachedSignedUrlWithBucket({
    requestId,
    bucket,
    path: objectPath,
    ttlSec: SIGNED_TTL_SEC,
    getSignCallCount: () => signCalls,
    createSignedUrl: async (inputBucket, inputPath, ttlSec) => {
      signCalls += 1;
      const admin = createAdminClient();
      const res = await admin.storage.from(inputBucket).createSignedUrl(inputPath, ttlSec);
      if (res.error || !res.data?.signedUrl) return "";
      return res.data.signedUrl;
    },
  });
  if (signed.url) return signed.url;

  // Legacy fallback for old paths that may still live in dating-photos.
  if (bucket === "dating-card-photos" || bucket === "dating-apply-photos") {
    const fallback = await getCachedSignedUrlWithBucket({
      requestId,
      bucket: "dating-photos",
      path: objectPath,
      ttlSec: SIGNED_TTL_SEC,
      getSignCallCount: () => signCalls,
      createSignedUrl: async (inputBucket, inputPath, ttlSec) => {
        signCalls += 1;
        const admin = createAdminClient();
        const res = await admin.storage.from(inputBucket).createSignedUrl(inputPath, ttlSec);
        if (res.error || !res.data?.signedUrl) return "";
        return res.data.signedUrl;
      },
    });
    if (fallback.url) return fallback.url;
  }

  return "";
}

async function fetchSigned(bucket: string, objectPath: string, method: string, requestId: string) {
  if (BLOCKED_SIGNED_PREFIXES[bucket]?.some((prefix) => objectPath.startsWith(prefix))) {
    return new Response("Not Found", { status: 404 });
  }

  const signedUrl = await createSignedUpstreamUrl(bucket, objectPath, requestId);
  if (!signedUrl) return new Response("Not Found", { status: 404 });

  const upstream = await fetch(signedUrl, {
    method,
    cache: "no-store",
  }).catch(() => null);
  if (!upstream) return new Response("Bad Gateway", { status: 502 });

  const headers = pickUpstreamHeaders(upstream.headers);
  if (!(upstream.ok && isCacheableImage(upstream.headers))) {
    headers.set("Cache-Control", "no-store");
    headers.delete("set-cookie");
    return new Response(method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  }

  // Signed fetch still benefits from edge/browser caching because this proxy URL is stable.
  headers.set("Cache-Control", LONG_IMAGE_CACHE_CONTROL);
  headers.set("Vary", "Accept");
  headers.delete("set-cookie");
  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function optimizeSignedImageResponse(
  req: Request,
  bucket: string,
  objectPath: string,
  method: string,
  requestId: string
) {
  if (BLOCKED_SIGNED_PREFIXES[bucket]?.some((prefix) => objectPath.startsWith(prefix))) {
    return new Response("Not Found", { status: 404 });
  }

  const signedUrl = await createSignedUpstreamUrl(bucket, objectPath, requestId);
  if (!signedUrl) return new Response("Not Found", { status: 404 });

  const upstream = await fetch(signedUrl, { method, cache: "no-store" }).catch(() => null);
  if (!upstream) return new Response("Bad Gateway", { status: 502 });

  const upstreamHeaders = pickUpstreamHeaders(upstream.headers);
  const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
  if (!upstream.ok || !contentType.startsWith("image/")) {
    upstreamHeaders.set("Cache-Control", "no-store");
    upstreamHeaders.delete("set-cookie");
    return new Response(method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: upstreamHeaders,
    });
  }

  if (method === "HEAD") {
    upstreamHeaders.set("Cache-Control", LONG_IMAGE_CACHE_CONTROL);
    upstreamHeaders.set("Vary", "Accept");
    upstreamHeaders.delete("set-cookie");
    return new Response(null, { status: upstream.status, headers: upstreamHeaders });
  }

  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "1";
  if (full) {
    upstreamHeaders.set("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
    upstreamHeaders.set("Vary", "Accept");
    upstreamHeaders.delete("set-cookie");
    return new Response(upstream.body, { status: upstream.status, headers: upstreamHeaders });
  }

  const widthParam = Number(url.searchParams.get("w") ?? DEFAULT_MAX_WIDTH);
  const qualityParam = Number(url.searchParams.get("q") ?? DEFAULT_QUALITY);
  const width = Number.isFinite(widthParam) ? Math.max(320, Math.min(1600, Math.round(widthParam))) : DEFAULT_MAX_WIDTH;
  const quality = Number.isFinite(qualityParam) ? Math.max(45, Math.min(85, Math.round(qualityParam))) : DEFAULT_QUALITY;

  try {
    const input = Buffer.from(await upstream.arrayBuffer());
    const output = await sharp(input, { limitInputPixels: 33_000_000 })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    const headers = new Headers();
    headers.set("Content-Type", "image/webp");
    headers.set("Content-Length", String(output.byteLength));
    headers.set("Cache-Control", LONG_IMAGE_CACHE_CONTROL);
    headers.set("Vary", "Accept");
    if (upstream.headers.get("etag")) headers.set("ETag", upstream.headers.get("etag")!);
    if (upstream.headers.get("last-modified")) headers.set("Last-Modified", upstream.headers.get("last-modified")!);
    return new Response(new Uint8Array(output), { status: 200, headers });
  } catch (error) {
    console.warn("[image-proxy] optimize fallback to original", {
      bucket,
      objectPathTail: objectPath.split("/").slice(-2).join("/"),
      error: error instanceof Error ? error.message : String(error),
    });
    upstreamHeaders.set("Cache-Control", LONG_IMAGE_CACHE_CONTROL);
    upstreamHeaders.set("Vary", "Accept");
    upstreamHeaders.delete("set-cookie");
    return new Response(upstream.body, { status: upstream.status, headers: upstreamHeaders });
  }
}

async function handler(req: Request, params: Promise<{ slug: string[] }>) {
  const requestId = crypto.randomUUID();
  const { slug } = await params;
  const [mode, encodedBucket, ...encodedPathParts] = slug ?? [];
  if (!mode || !encodedBucket || encodedPathParts.length === 0) {
    return new Response("Bad Request", { status: 400 });
  }

  const bucket = decodeURIComponent(encodedBucket);
  const objectPath = decodeSegments(encodedPathParts);
  if (!bucket || !objectPath) return new Response("Bad Request", { status: 400 });

  if (mode === "public-lite") {
    return fetchPublicLite(bucket, objectPath, req.method, requestId);
  }
  if (mode === "signed") {
    const allowed = await canReadSignedObject(req, bucket, objectPath);
    if (!allowed) {
      return new Response("Not Found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (OPTIMIZED_BUCKETS.has(bucket)) {
      return optimizeSignedImageResponse(req, bucket, objectPath, req.method, requestId);
    }
    return fetchSigned(bucket, objectPath, req.method, requestId);
  }
  return new Response("Not Found", { status: 404 });
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  return handler(req, ctx.params);
}

export async function HEAD(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  return handler(req, ctx.params);
}

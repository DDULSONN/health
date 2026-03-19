import { getCachedSignedUrlWithBucket } from "@/lib/signed-url-cache";
import { createAdminClient } from "@/lib/supabase/server";
import sharp from "sharp";

export const runtime = "nodejs";

const SIGNED_TTL_SEC = 3600;
const OPTIMIZED_BUCKETS = new Set(["community", "dating-apply-photos"]);
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

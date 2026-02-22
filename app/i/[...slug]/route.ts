import { getCachedSignedUrlWithBucket } from "@/lib/signed-url-cache";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SIGNED_TTL_SEC = 3600;

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
    headers.set("Cache-Control", "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800");
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
  if (upstream.ok && isCacheableImage(upstream.headers)) {
    // Signed fetch still benefits from edge/browser caching because this proxy URL is stable.
    headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
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

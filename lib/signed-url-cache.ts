import { kvGetJson, kvGetString, kvSetJson, kvSetString } from "@/lib/edge-kv";

type SignedUrlCacheValue = {
  url: string;
  expiresAtEpochMs: number;
};

type SignedUrlResult = {
  url: string;
  cacheStatus: "hit" | "miss";
  signCalled: boolean;
  bucket: string;
};

type SignedUrlOptions = {
  requestId: string;
  bucket: string;
  path: string;
  ttlSec?: number;
  refreshBeforeMs?: number;
  createSignedUrl: (bucket: string, path: string, ttlSec: number) => Promise<string>;
};

function cacheKey(bucket: string, path: string) {
  return `signedurl:${bucket}:${path}`;
}

function bucketHintKey(path: string) {
  return `signedurlbucket:${path}`;
}

export async function getCachedSignedUrlWithBucket(options: SignedUrlOptions): Promise<SignedUrlResult> {
  const ttlSec = options.ttlSec ?? 3600;
  const refreshBeforeMs = options.refreshBeforeMs ?? 10 * 60 * 1000;
  const key = cacheKey(options.bucket, options.path);
  const now = Date.now();

  const cached = await kvGetJson<SignedUrlCacheValue>(key);
  if (cached?.url && cached.expiresAtEpochMs - now > refreshBeforeMs) {
    const ttlRemaining = cached.expiresAtEpochMs - now;
    console.log(
      `[signedUrl.cache] hit requestId=${options.requestId} key=${key} path=${options.path} ttlRemainingMs=${ttlRemaining}`
    );
    return {
      url: cached.url,
      cacheStatus: "hit",
      signCalled: false,
      bucket: options.bucket,
    };
  }

  console.log(`[signedUrl.cache] miss requestId=${options.requestId} key=${key} path=${options.path}`);
  const url = await options.createSignedUrl(options.bucket, options.path, ttlSec);
  if (!url) {
    return { url: "", cacheStatus: "miss", signCalled: true, bucket: options.bucket };
  }

  const expiresAtEpochMs = now + ttlSec * 1000;
  await kvSetJson(key, { url, expiresAtEpochMs }, ttlSec);
  return { url, cacheStatus: "miss", signCalled: true, bucket: options.bucket };
}

type ResolvedSignedUrlOptions = {
  requestId: string;
  path: string;
  buckets: string[];
  ttlSec?: number;
  refreshBeforeMs?: number;
  createSignedUrl: (bucket: string, path: string, ttlSec: number) => Promise<string>;
};

export async function getCachedSignedUrlResolved(options: ResolvedSignedUrlOptions): Promise<SignedUrlResult> {
  const hint = await kvGetString(bucketHintKey(options.path));
  const orderedBuckets = hint
    ? [hint, ...options.buckets.filter((bucket) => bucket !== hint)]
    : [...options.buckets];

  for (const bucket of orderedBuckets) {
    const result = await getCachedSignedUrlWithBucket({
      requestId: options.requestId,
      bucket,
      path: options.path,
      ttlSec: options.ttlSec,
      refreshBeforeMs: options.refreshBeforeMs,
      createSignedUrl: options.createSignedUrl,
    });
    if (result.url) {
      await kvSetString(bucketHintKey(options.path), bucket, 24 * 60 * 60);
      return result;
    }
  }

  return { url: "", cacheStatus: "miss", signCalled: false, bucket: "" };
}

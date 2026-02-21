import { kvGetJson, kvGetString, kvIncrWindow, kvSetJson, kvSetString } from "@/lib/edge-kv";

type SignedUrlCacheValue = {
  url: string;
  expiresAtEpochMs: number;
};

type SignedUrlResult = {
  url: string;
  cacheStatus: "hit" | "miss";
  signCalled: boolean;
  bucket: string;
  ttlRemainingMs: number;
};

type SignedUrlOptions = {
  requestId: string;
  bucket: string;
  path: string;
  cachePath?: string;
  ttlSec?: number;
  refreshBeforeMs?: number;
  getSignCallCount?: () => number;
  createSignedUrl: (bucket: string, path: string, ttlSec: number) => Promise<string>;
};

function cacheKey(bucket: string, path: string) {
  return `signedurl:${bucket}:${path}`;
}

function bucketHintKey(path: string) {
  return `signedurlbucket:${path}`;
}

function pathTail(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  return parts.slice(-2).join("/");
}

async function recordMissBurst(requestId: string, bucket: string) {
  const hour = await kvIncrWindow(`signedurl:miss:hour:${bucket}`, 60 * 60);
  if (hour.count === 1000 || hour.count === 5000 || hour.count === 10000) {
    console.warn(
      `[signedUrl.burst] requestId=${requestId} bucket=${bucket} window=hour count=${hour.count} provider=${hour.provider}`
    );
  }
  const day = await kvIncrWindow(`signedurl:miss:day:${bucket}`, 24 * 60 * 60);
  if (day.count === 10000 || day.count === 50000 || day.count === 100000) {
    console.warn(
      `[signedUrl.burst] requestId=${requestId} bucket=${bucket} window=day count=${day.count} provider=${day.provider}`
    );
  }
}

export async function getCachedSignedUrlWithBucket(options: SignedUrlOptions): Promise<SignedUrlResult> {
  const ttlSec = options.ttlSec ?? 3600;
  const refreshBeforeMs = options.refreshBeforeMs ?? 10 * 60 * 1000;
  const key = cacheKey(options.bucket, options.cachePath ?? options.path);
  const now = Date.now();

  const cached = await kvGetJson<SignedUrlCacheValue>(key);
  if (cached?.url && cached.expiresAtEpochMs - now > refreshBeforeMs) {
    const ttlRemaining = cached.expiresAtEpochMs - now;
    const signCallCount = options.getSignCallCount?.() ?? 0;
    console.log(
      `[signedUrl.cache] requestId=${options.requestId} cache=hit bucket=${options.bucket} pathTail=${pathTail(
        options.path
      )} ttlRemainingMs=${ttlRemaining} signCallCount=${signCallCount}`
    );
    return {
      url: cached.url,
      cacheStatus: "hit",
      signCalled: false,
      bucket: options.bucket,
      ttlRemainingMs: ttlRemaining,
    };
  }

  const signCallCountBefore = options.getSignCallCount?.() ?? 0;
  console.log(
    `[signedUrl.cache] requestId=${options.requestId} cache=miss bucket=${options.bucket} pathTail=${pathTail(
      options.path
    )} ttlRemainingMs=0 signCallCount=${signCallCountBefore}`
  );
  await recordMissBurst(options.requestId, options.bucket);
  const url = await options.createSignedUrl(options.bucket, options.path, ttlSec);
  if (!url) {
    return { url: "", cacheStatus: "miss", signCalled: true, bucket: options.bucket, ttlRemainingMs: 0 };
  }

  const expiresAtEpochMs = now + ttlSec * 1000;
  await kvSetJson(key, { url, expiresAtEpochMs }, ttlSec);
  return { url, cacheStatus: "miss", signCalled: true, bucket: options.bucket, ttlRemainingMs: ttlSec * 1000 };
}

type ResolvedSignedUrlOptions = {
  requestId: string;
  path: string;
  cachePath?: string;
  buckets: string[];
  ttlSec?: number;
  refreshBeforeMs?: number;
  getSignCallCount?: () => number;
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
      cachePath: options.cachePath,
      ttlSec: options.ttlSec,
      refreshBeforeMs: options.refreshBeforeMs,
      getSignCallCount: options.getSignCallCount,
      createSignedUrl: options.createSignedUrl,
    });
    if (result.url) {
      await kvSetString(bucketHintKey(options.path), bucket, 24 * 60 * 60);
      return result;
    }
  }

  return { url: "", cacheStatus: "miss", signCalled: false, bucket: "", ttlRemainingMs: 0 };
}

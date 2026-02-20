import { kvIncrWindow } from "@/lib/edge-kv";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

// Backward-compatible in-memory helper.
export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size > 5000) {
    pruneExpired(now);
  }

  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  current.count += 1;
  if (current.count > limit) {
    const retryAfterMs = Math.max(0, current.resetAt - now);
    return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }

  return { allowed: true, retryAfterSec: 0 };
}

export function extractClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  return "unknown";
}

type RouteRateLimitOptions = {
  requestId: string;
  scope: string;
  userId: string | null;
  ip: string;
  userLimitPerMin: number;
  ipLimitPerMin: number;
};

export async function checkRouteRateLimit(options: RouteRateLimitOptions) {
  const isUser = Boolean(options.userId);
  const subject = isUser ? `user:${options.userId}` : `ip:${options.ip}`;
  const limit = isUser ? options.userLimitPerMin : options.ipLimitPerMin;
  const key = `ratelimit:${options.scope}:${subject}`;
  const result = await kvIncrWindow(key, 60);
  const allowed = result.count <= limit;

  console.log(
    `[ratelimit] requestId=${options.requestId} key=${subject} count=${result.count} limit=${limit} scope=${options.scope} provider=${result.provider} allowed=${allowed}`
  );

  return {
    allowed,
    retryAfterSec: result.ttlRemainingSec,
    count: result.count,
    limit,
    subject,
  };
}

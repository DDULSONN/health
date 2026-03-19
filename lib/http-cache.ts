import { NextResponse } from "next/server";

type PublicCacheOptions = {
  browserMaxAge?: number;
  sMaxAge: number;
  staleWhileRevalidate?: number;
  status?: number;
};

export function createPublicCacheHeaders({
  browserMaxAge = 0,
  sMaxAge,
  staleWhileRevalidate = 0,
}: PublicCacheOptions): HeadersInit {
  const parts = [`public`, `max-age=${Math.max(0, browserMaxAge)}`, `s-maxage=${Math.max(0, sMaxAge)}`];
  if (staleWhileRevalidate > 0) {
    parts.push(`stale-while-revalidate=${Math.max(0, staleWhileRevalidate)}`);
  }

  const value = parts.join(", ");
  return {
    "Cache-Control": value,
    "CDN-Cache-Control": value,
    "Vercel-CDN-Cache-Control": value,
  };
}

export function publicCachedJson<T>(body: T, options: PublicCacheOptions) {
  return NextResponse.json(body, {
    status: options.status,
    headers: createPublicCacheHeaders(options),
  });
}

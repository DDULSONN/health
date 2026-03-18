import { NextResponse } from "next/server";

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function collectAllowedOrigins(request: Request): string[] {
  const allowed = new Set<string>();
  const hostHeaders = [request.headers.get("x-forwarded-host"), request.headers.get("host")];
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  for (const host of hostHeaders) {
    if (!host) continue;
    allowed.add(normalizeOrigin(`${proto}://${host}`));
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl) {
    try {
      allowed.add(normalizeOrigin(new URL(siteUrl).origin));
    } catch {
      // ignore malformed site url env
    }
  }

  const extraOrigins = (process.env.ALLOWED_API_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of extraOrigins) {
    try {
      allowed.add(normalizeOrigin(new URL(origin).origin));
    } catch {
      // ignore malformed configured origin
    }
  }

  return [...allowed];
}

function readRequestOrigin(request: Request): string | null {
  const originHeader = request.headers.get("origin");
  if (originHeader) return originHeader;

  const refererHeader = request.headers.get("referer");
  if (!refererHeader) return null;

  try {
    return new URL(refererHeader).origin;
  } catch {
    return null;
  }
}

export function ensureAllowedMutationOrigin(request: Request): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const requestOrigin = readRequestOrigin(request);
  if (!requestOrigin) {
    return null;
  }

  let normalizedRequestOrigin: string;
  try {
    normalizedRequestOrigin = normalizeOrigin(new URL(requestOrigin).origin);
  } catch {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const allowedOrigins = collectAllowedOrigins(request);
  if (allowedOrigins.includes(normalizedRequestOrigin)) {
    return null;
  }

  return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
}

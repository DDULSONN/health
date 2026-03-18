import { NextResponse } from "next/server";

function hasMatchingBearerSecret(request: Request, secret: string): boolean {
  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
  return authHeader === `Bearer ${secret}`;
}

function isLikelyVercelCron(request: Request): boolean {
  const cronHeader = request.headers.get("x-vercel-cron");
  if (!cronHeader) return false;

  const userAgent = (request.headers.get("user-agent") ?? "").toLowerCase();
  return userAgent.includes("vercel-cron");
}

function isLocalDevelopmentRequest(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return false;

  const url = new URL(request.url);
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

export function ensureCronAuthorized(request: Request): NextResponse | null {
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();

  if (cronSecret) {
    if (hasMatchingBearerSecret(request, cronSecret)) {
      return null;
    }

    return NextResponse.json({ error: "unauthorized", reason: "invalid_cron_secret" }, { status: 401 });
  }

  if (isLikelyVercelCron(request) || isLocalDevelopmentRequest(request)) {
    return null;
  }

  return NextResponse.json({ error: "unauthorized", reason: "missing_cron_secret" }, { status: 401 });
}

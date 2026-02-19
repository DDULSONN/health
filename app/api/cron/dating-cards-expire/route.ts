import { createAdminClient } from "@/lib/supabase/server";
import { syncOpenCardQueue } from "@/lib/dating-cards-queue";
import { NextResponse } from "next/server";

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return Boolean(request.headers.get("x-vercel-cron"));
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const syncRes = await syncOpenCardQueue(adminClient).catch((error) => ({ error }));
  if ("error" in syncRes) {
    console.error("[GET /api/cron/dating-cards-expire] failed", syncRes.error);
    const message = syncRes.error instanceof Error ? syncRes.error.message : "queue sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    expired_count: syncRes.expiredIds.length,
    promoted: {
      male: syncRes.promoted.male.length,
      female: syncRes.promoted.female.length,
    },
  });
}

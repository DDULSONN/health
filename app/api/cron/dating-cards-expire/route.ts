import { createAdminClient } from "@/lib/supabase/server";
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
  const nowIso = new Date().toISOString();
  const { data, error } = await adminClient
    .from("dating_cards")
    .update({ status: "expired" })
    .eq("status", "public")
    .lte("expires_at", nowIso)
    .select("id");

  if (error) {
    console.error("[GET /api/cron/dating-cards-expire] failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, expired_count: data?.length ?? 0 });
}

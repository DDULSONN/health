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

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("dating_city_view_requests")
    .update({
      status: "rejected",
      note: "자동 만료 정리",
      reviewed_at: nowIso,
      reviewed_by_user_id: null,
    })
    .eq("status", "approved")
    .lte("access_expires_at", nowIso)
    .select("id");

  if (error) {
    console.error("[GET /api/cron/dating-city-view-expire] failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    expired_count: data?.length ?? 0,
  });
}


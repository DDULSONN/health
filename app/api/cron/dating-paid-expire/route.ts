import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const authResponse = ensureCronAuthorized(request);
  if (authResponse) return authResponse;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("dating_paid_cards")
    .update({ status: "expired" })
    .eq("status", "approved")
    .lte("expires_at", nowIso)
    .select("id");

  if (error) {
    console.error("[GET /api/cron/dating-paid-expire] failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    expired_count: data?.length ?? 0,
  });
}

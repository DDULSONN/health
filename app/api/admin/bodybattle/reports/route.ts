import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "../_auth";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  const status = searchParams.get("status");
  const limit = Math.max(1, Math.min(500, Number(searchParams.get("limit") ?? 200)));

  const admin = createAdminClient();
  let query = admin
    .from("bodybattle_reports")
    .select("id,season_id,entry_id,reporter_user_id,reason,status,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (seasonId) query = query.eq("season_id", seasonId);
  if (status === "pending" || status === "reviewed" || status === "dismissed") query = query.eq("status", status);

  const reportsRes = await query;
  if (reportsRes.error) {
    return NextResponse.json({ ok: false, message: reportsRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: reportsRes.data ?? [] });
}

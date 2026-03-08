import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "../_auth";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") ?? 50)));

  const admin = createAdminClient();
  const runsRes = await admin
    .from("bodybattle_admin_runs")
    .select("id,run_type,status,requested_by_user_id,payload,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (runsRes.error) {
    return NextResponse.json({ ok: false, message: runsRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: runsRes.data ?? [] });
}

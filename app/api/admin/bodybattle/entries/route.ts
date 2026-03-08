import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "../_auth";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  const moderation = searchParams.get("moderation");
  const status = searchParams.get("status");
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(searchParams.get("limit") ?? 200)));

  const admin = createAdminClient();
  let query = admin
    .from("bodybattle_entries")
    .select(
      "id,season_id,user_id,nickname,gender,intro_text,champion_comment,image_urls,rating,wins,losses,draws,current_streak,best_streak,exposures,votes_received,moderation_status,status,report_count,created_at,updated_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (seasonId) query = query.eq("season_id", seasonId);
  if (moderation === "pending" || moderation === "approved" || moderation === "rejected") query = query.eq("moderation_status", moderation);
  if (status === "active" || status === "inactive" || status === "hidden") query = query.eq("status", status);

  const entriesRes = await query;
  if (entriesRes.error) {
    return NextResponse.json({ ok: false, message: entriesRes.error.message }, { status: 500 });
  }

  let items = entriesRes.data ?? [];
  if (q) {
    items = items.filter((item) => {
      const hay = `${item.id} ${item.user_id} ${item.nickname ?? ""} ${item.intro_text ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  return NextResponse.json({ ok: true, items });
}

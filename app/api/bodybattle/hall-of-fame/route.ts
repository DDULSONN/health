import { clampBodyBattleTop } from "@/lib/bodybattle";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = clampBodyBattleTop(Number(searchParams.get("limit") ?? 30), 30);

  const admin = createAdminClient();
  const hofRes = await admin
    .from("bodybattle_hall_of_fame")
    .select(
      "id,season_id,week_id,theme_slug,theme_label,champion_entry_id,user_id,nickname,image_url,rating,votes_received,wins,losses,draws,champion_comment,created_at"
    )
    .order("week_id", { ascending: false })
    .limit(limit);

  if (hofRes.error) {
    return NextResponse.json({ ok: false, message: hofRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    items: hofRes.data ?? [],
  });
}

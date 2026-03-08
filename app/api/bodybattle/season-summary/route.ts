import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const admin = createAdminClient();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const latestRes = await admin
    .from("bodybattle_season_results")
    .select("season_id,champion_entry_id,top10,finalized_at")
    .order("finalized_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestRes.error) {
    return NextResponse.json({ ok: false, message: latestRes.error.message }, { status: 500 });
  }
  if (!latestRes.data) {
    return NextResponse.json({ ok: true, latest: null, me: null });
  }

  const seasonRes = await admin
    .from("bodybattle_seasons")
    .select("id,week_id,theme_label,status")
    .eq("id", latestRes.data.season_id)
    .maybeSingle();
  if (seasonRes.error) {
    return NextResponse.json({ ok: false, message: seasonRes.error.message }, { status: 500 });
  }

  const top10 = Array.isArray(latestRes.data.top10) ? latestRes.data.top10 : [];
  const champion = top10[0] ?? null;
  let me: Record<string, unknown> | null = null;

  if (user?.id) {
    const idx = top10.findIndex((row) => String((row as { user_id?: string }).user_id ?? "") === user.id);
    if (idx >= 0) {
      const item = top10[idx] as Record<string, unknown>;
      me = { rank: idx + 1, ...item };
    }
  }

  return NextResponse.json({
    ok: true,
    latest: {
      season_id: latestRes.data.season_id,
      finalized_at: latestRes.data.finalized_at,
      week_id: seasonRes.data?.week_id ?? null,
      theme_label: seasonRes.data?.theme_label ?? null,
      champion,
    },
    me,
  });
}


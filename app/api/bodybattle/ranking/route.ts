import { BODY_BATTLE_MIN_EXPOSURES, BODY_BATTLE_MIN_VOTES, clampBodyBattleTop } from "@/lib/bodybattle";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type RankingRow = {
  id: string;
  user_id: string;
  nickname: string;
  gender: "male" | "female";
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  exposures: number;
  votes_received: number;
  image_url: string | null;
  champion_comment: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  const genderParam = searchParams.get("gender");
  const top = clampBodyBattleTop(Number(searchParams.get("top") ?? 50), 50);
  const gender = genderParam === "male" || genderParam === "female" ? genderParam : null;

  const admin = createAdminClient();
  const seasonQuery = admin
    .from("bodybattle_seasons")
    .select("id,week_id,theme_slug,theme_label,start_at,end_at,status")
    .order("start_at", { ascending: false })
    .limit(1);

  const seasonRes = seasonId ? await seasonQuery.eq("id", seasonId).maybeSingle() : await seasonQuery.eq("status", "active").maybeSingle();

  if (seasonRes.error) {
    return NextResponse.json({ ok: false, message: seasonRes.error.message }, { status: 500 });
  }
  if (!seasonRes.data) {
    return NextResponse.json({ ok: true, season: null, items: [], min_votes: BODY_BATTLE_MIN_VOTES, min_exposures: BODY_BATTLE_MIN_EXPOSURES });
  }

  let rankingQuery = admin
    .from("bodybattle_entries")
    .select("id,user_id,nickname,gender,rating,wins,losses,draws,exposures,votes_received,image_url:image_urls->>0,champion_comment,created_at")
    .eq("season_id", seasonRes.data.id)
    .eq("status", "active")
    .eq("moderation_status", "approved")
    .gte("exposures", BODY_BATTLE_MIN_EXPOSURES)
    .gte("votes_received", BODY_BATTLE_MIN_VOTES)
    .lt("report_count", 5)
    .order("rating", { ascending: false })
    .order("votes_received", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(top);
  if (gender) rankingQuery = rankingQuery.eq("gender", gender);

  const rankingRes = await rankingQuery;
  if (rankingRes.error) {
    return NextResponse.json({ ok: false, message: rankingRes.error.message }, { status: 500 });
  }

  const items = ((rankingRes.data ?? []) as RankingRow[]).map((row, idx) => ({
    rank: idx + 1,
    ...row,
    win_rate:
      row.wins + row.losses + row.draws > 0
        ? Number((row.wins / (row.wins + row.losses + row.draws)).toFixed(4))
        : 0,
  }));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let me: Record<string, unknown> | null = null;
  if (user) {
    const myEntryRes = await admin
      .from("bodybattle_entries")
      .select("id,user_id,nickname,gender,rating,wins,losses,draws,exposures,votes_received,image_url:image_urls->>0,champion_comment,status,moderation_status")
      .eq("season_id", seasonRes.data.id)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!myEntryRes.error && myEntryRes.data) {
      const idx = items.findIndex((row) => row.id === myEntryRes.data?.id);
      me = {
        ...myEntryRes.data,
        rank: idx >= 0 ? idx + 1 : null,
      };
    }
  }

  return NextResponse.json({
    ok: true,
    season: seasonRes.data,
    items,
    me,
    min_votes: BODY_BATTLE_MIN_VOTES,
    min_exposures: BODY_BATTLE_MIN_EXPOSURES,
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getKstWeekRange } from "@/lib/weekly";

type RankRow = {
  id: string;
  user_id: string;
  gender: "male" | "female";
  score_sum: number;
  vote_count: number;
  created_at: string;
  title: string;
};

function sortRows(a: RankRow, b: RankRow) {
  if (a.score_sum !== b.score_sum) return b.score_sum - a.score_sum;
  if (a.vote_count !== b.vote_count) return b.vote_count - a.vote_count;
  return a.created_at.localeCompare(b.created_at);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const week = getKstWeekRange();
  const { data: mine, error: mineError } = await supabase
    .from("posts")
    .select("id, user_id, gender, score_sum, vote_count, created_at, title")
    .eq("type", "photo_bodycheck")
    .eq("is_hidden", false)
    .eq("is_deleted", false)
    .eq("user_id", user.id)
    .gte("created_at", week.startUtcIso)
    .lt("created_at", week.endUtcIso);

  if (mineError) {
    return NextResponse.json({ error: mineError.message }, { status: 500 });
  }

  if (!mine || mine.length === 0) {
    return NextResponse.json({
      has_post: false,
      week: { start_utc: week.startUtcIso, end_utc: week.endUtcIso },
    });
  }

  const myBest = [...(mine as RankRow[])].sort(sortRows)[0];
  const { data: pool, error: poolError } = await supabase
    .from("posts")
    .select("id, user_id, gender, score_sum, vote_count, created_at, title")
    .eq("type", "photo_bodycheck")
    .eq("is_hidden", false)
    .eq("is_deleted", false)
    .eq("gender", myBest.gender)
    .gte("created_at", week.startUtcIso)
    .lt("created_at", week.endUtcIso);

  if (poolError) {
    return NextResponse.json({ error: poolError.message }, { status: 500 });
  }

  const sorted = [...((pool ?? []) as RankRow[])].sort(sortRows);
  const rank = sorted.findIndex((post) => post.id === myBest.id) + 1;

  return NextResponse.json({
    has_post: true,
    week: { start_utc: week.startUtcIso, end_utc: week.endUtcIso },
    rank,
    total: sorted.length,
    post: myBest,
  });
}

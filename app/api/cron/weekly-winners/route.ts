import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getPreviousKstWeekId } from "@/lib/weekly";

const MIN_VOTES = 5;

type WeeklyTop = {
  post_id: string;
  score_sum: number;
  score_avg: number;
  vote_count: number;
  posts: {
    user_id: string;
    images: string[] | null;
  } | null;
};

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Boolean(request.headers.get("x-vercel-cron"));
  }

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}

async function fetchTopByGender(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  weekId: string,
  gender: "male" | "female"
): Promise<WeeklyTop | null> {
  const { data, error } = await supabase
    .from("post_score_weekly")
    .select("post_id, score_sum, score_avg, vote_count, posts!inner(user_id, images)")
    .eq("week_id", weekId)
    .eq("gender", gender)
    .gte("vote_count", MIN_VOTES)
    .order("score_sum", { ascending: false })
    .order("score_avg", { ascending: false })
    .order("vote_count", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as WeeklyTop | null) ?? null;
}

async function getNickname(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  userId: string
): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("nickname").eq("user_id", userId).maybeSingle();
  return data?.nickname ?? null;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const weekId = getPreviousKstWeekId();
  const supabase = createAdminClient();

  try {
    const [maleTop, femaleTop] = await Promise.all([
      fetchTopByGender(supabase, weekId, "male"),
      fetchTopByGender(supabase, weekId, "female"),
    ]);

    const inserted: string[] = [];

    if (maleTop?.posts?.user_id) {
      const nickname = await getNickname(supabase, maleTop.posts.user_id);
      const { error } = await supabase.from("hall_of_fame").upsert(
        {
          week_id: weekId,
          gender: "male",
          post_id: maleTop.post_id,
          user_id: maleTop.posts.user_id,
          nickname,
          image_url: maleTop.posts.images?.[0] ?? null,
          score_avg: maleTop.score_avg,
          vote_count: maleTop.vote_count,
        },
        { onConflict: "week_id,gender", ignoreDuplicates: true }
      );
      if (error && error.code !== "23505") {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      inserted.push("male");
    }

    if (femaleTop?.posts?.user_id) {
      const nickname = await getNickname(supabase, femaleTop.posts.user_id);
      const { error } = await supabase.from("hall_of_fame").upsert(
        {
          week_id: weekId,
          gender: "female",
          post_id: femaleTop.post_id,
          user_id: femaleTop.posts.user_id,
          nickname,
          image_url: femaleTop.posts.images?.[0] ?? null,
          score_avg: femaleTop.score_avg,
          vote_count: femaleTop.vote_count,
        },
        { onConflict: "week_id,gender", ignoreDuplicates: true }
      );
      if (error && error.code !== "23505") {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      inserted.push("female");
    }

    return NextResponse.json({
      ok: true,
      week_id: weekId,
      inserted,
      skipped: inserted.length === 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

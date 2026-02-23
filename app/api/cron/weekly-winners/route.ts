import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getPreviousKstWeekId } from "@/lib/weekly";

const MIN_VOTES = 5;
const MAX_BACKFILL_WEEKS = 12;

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

type HallOfFameKeyRow = {
  week_id: string;
  gender: "male" | "female";
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

async function fetchCandidateWeekIds(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  latestClosedWeekId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("post_score_weekly")
    .select("week_id")
    .lte("week_id", latestClosedWeekId)
    .order("week_id", { ascending: false })
    .limit(2000);

  if (error) throw error;

  const weekIds = [...new Set((data ?? []).map((row) => row.week_id).filter(Boolean))] as string[];
  return weekIds.slice(0, MAX_BACKFILL_WEEKS);
}

async function fetchHallOfFameRows(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  weekIds: string[]
): Promise<HallOfFameKeyRow[]> {
  if (weekIds.length === 0) return [];

  const { data, error } = await supabase.from("hall_of_fame").select("week_id, gender").in("week_id", weekIds);
  if (error) throw error;

  return (data ?? []) as HallOfFameKeyRow[];
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

  const url = new URL(request.url);
  const forcedWeekId = url.searchParams.get("week_id")?.trim() || null;
  const latestClosedWeekId = getPreviousKstWeekId();
  const supabase = createAdminClient();

  try {
    const candidateWeekIds = forcedWeekId ? [forcedWeekId] : await fetchCandidateWeekIds(supabase, latestClosedWeekId);
    const hofRows = await fetchHallOfFameRows(supabase, candidateWeekIds);
    const hofSet = new Set(hofRows.map((row) => `${row.week_id}:${row.gender}`));

    const weekIdsToProcess = candidateWeekIds.filter((weekId) => {
      return !hofSet.has(`${weekId}:male`) || !hofSet.has(`${weekId}:female`);
    });

    const inserted: Array<{ week_id: string; gender: "male" | "female" }> = [];
    const skipped: Array<{ week_id: string; reason: string }> = [];

    for (const weekId of weekIdsToProcess) {
      const [maleTop, femaleTop] = await Promise.all([
        fetchTopByGender(supabase, weekId, "male"),
        fetchTopByGender(supabase, weekId, "female"),
      ]);

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
          { onConflict: "week_id,gender" }
        );
        if (error) {
          return NextResponse.json({ error: error.message, week_id: weekId, gender: "male" }, { status: 500 });
        }
        inserted.push({ week_id: weekId, gender: "male" });
      } else {
        skipped.push({ week_id: weekId, reason: "male_top_not_found_or_min_votes_not_met" });
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
          { onConflict: "week_id,gender" }
        );
        if (error) {
          return NextResponse.json({ error: error.message, week_id: weekId, gender: "female" }, { status: 500 });
        }
        inserted.push({ week_id: weekId, gender: "female" });
      } else {
        skipped.push({ week_id: weekId, reason: "female_top_not_found_or_min_votes_not_met" });
      }
    }

    return NextResponse.json({
      ok: true,
      latest_closed_week_id: latestClosedWeekId,
      forced_week_id: forcedWeekId,
      scanned_week_ids: candidateWeekIds,
      processed_week_ids: weekIdsToProcess,
      inserted,
      skipped,
      no_op: inserted.length === 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

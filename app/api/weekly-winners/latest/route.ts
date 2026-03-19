import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { publicCachedJson } from "@/lib/http-cache";
import { getKstWeekRange, getPreviousKstWeekRange } from "@/lib/weekly";

type WinnerPost = {
  id: string;
  title: string;
  user_id: string;
  score_sum: number;
  vote_count: number;
  gender: "male" | "female" | null;
  nickname: string | null;
  profiles: { nickname: string | null } | null;
};

async function fetchLiveTopByGender(
  supabase: ReturnType<typeof createAdminClient>,
  gender: "male" | "female",
  startUtcIso: string,
  endUtcIso: string,
) {
  const { data, error } = await supabase
    .from("posts")
    .select("id, title, user_id, score_sum, vote_count, gender")
    .eq("type", "photo_bodycheck")
    .eq("is_hidden", false)
    .eq("is_deleted", false)
    .eq("gender", gender)
    .gte("created_at", startUtcIso)
    .lt("created_at", endUtcIso)
    .order("score_sum", { ascending: false })
    .order("vote_count", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, nickname")
    .eq("user_id", data.user_id)
    .maybeSingle();

  return {
    ...data,
    nickname: profile?.nickname ?? null,
    profiles: profile ? { nickname: profile.nickname ?? null } : null,
  } satisfies WinnerPost;
}

export async function GET() {
  const supabase = createAdminClient();

  const { data: latestWinner, error } = await supabase
    .from("weekly_winners")
    .select("week_start, week_end, male_post_id, female_post_id, male_score, female_score")
    .lte("week_start", new Date().toISOString())
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const postIds = [
    latestWinner?.male_post_id,
    latestWinner?.female_post_id,
  ].filter(Boolean) as string[];

  const postMap = new Map<string, WinnerPost>();
  if (postIds.length > 0) {
    const { data: posts } = await supabase
      .from("posts")
      .select("id, title, user_id, score_sum, vote_count, gender")
      .in("id", postIds);

    const userIds = [...new Set((posts ?? []).map((post) => post.user_id))];
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("user_id, nickname").in("user_id", userIds)
      : { data: [] as { user_id: string; nickname: string | null }[] };

    const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    for (const post of posts ?? []) {
      postMap.set(post.id, {
        ...post,
        nickname: profileMap.get(post.user_id)?.nickname ?? null,
        profiles: profileMap.get(post.user_id)
          ? { nickname: profileMap.get(post.user_id)?.nickname ?? null }
          : null,
      });
    }
  }

  const currentWeek = getKstWeekRange();
  const latestClosedWeek = getPreviousKstWeekRange();
  const isLatestClosedWeekConfirmed = Boolean(
    latestWinner &&
      latestWinner.week_start === latestClosedWeek.startUtcIso &&
      latestWinner.week_end === latestClosedWeek.endUtcIso,
  );

  if (isLatestClosedWeekConfirmed && latestWinner) {
    return publicCachedJson({
      mode: "confirmed",
      week: {
        start_utc: latestWinner.week_start,
        end_utc: latestWinner.week_end,
      },
      male: latestWinner.male_post_id
        ? {
            post_id: latestWinner.male_post_id,
            score: latestWinner.male_score ?? 0,
            post: postMap.get(latestWinner.male_post_id) ?? null,
          }
        : null,
      female: latestWinner.female_post_id
        ? {
            post_id: latestWinner.female_post_id,
            score: latestWinner.female_score ?? 0,
            post: postMap.get(latestWinner.female_post_id) ?? null,
          }
        : null,
    }, { sMaxAge: 600, staleWhileRevalidate: 3600 });
  }

  try {
    const [maleLive, femaleLive] = await Promise.all([
      fetchLiveTopByGender(
        supabase,
        "male",
        currentWeek.startUtcIso,
        currentWeek.endUtcIso,
      ),
      fetchLiveTopByGender(
        supabase,
        "female",
        currentWeek.startUtcIso,
        currentWeek.endUtcIso,
      ),
    ]);

    return publicCachedJson({
      mode: "collecting",
      week: {
        start_utc: currentWeek.startUtcIso,
        end_utc: currentWeek.endUtcIso,
      },
      male: maleLive,
      female: femaleLive,
      last_confirmed: latestWinner
        ? {
            week_start: latestWinner.week_start,
            week_end: latestWinner.week_end,
            male_post_id: latestWinner.male_post_id,
            female_post_id: latestWinner.female_post_id,
          }
        : null,
    }, { sMaxAge: 120, staleWhileRevalidate: 600 });
  } catch (liveError) {
    const message = liveError instanceof Error ? liveError.message : String(liveError);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

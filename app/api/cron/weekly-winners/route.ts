import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getKstWeekRangeFromWeekId, getPreviousKstWeekId } from "@/lib/weekly";

const MIN_VOTES = 5;
const MAX_BACKFILL_WEEKS = 520;
const WEEK_ID_FETCH_PAGE_SIZE = 1000;

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

function normalizeWeeklyTop(raw: unknown): WeeklyTop | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const postsRaw = row.posts;
  const postsRow =
    Array.isArray(postsRaw) && postsRaw.length > 0 && typeof postsRaw[0] === "object" && postsRaw[0] !== null
      ? (postsRaw[0] as Record<string, unknown>)
      : postsRaw && typeof postsRaw === "object"
        ? (postsRaw as Record<string, unknown>)
        : null;

  return {
    post_id: String(row.post_id ?? ""),
    score_sum: Number(row.score_sum ?? 0),
    score_avg: Number(row.score_avg ?? 0),
    vote_count: Number(row.vote_count ?? 0),
    posts: postsRow
      ? {
          user_id: String(postsRow.user_id ?? ""),
          images: Array.isArray(postsRow.images) ? (postsRow.images as string[]) : null,
        }
      : null,
  };
}

function isAuthorized(request: Request): boolean {
  const vercelCronHeader = request.headers.get("x-vercel-cron");
  if (vercelCronHeader) return true;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}

function isMissingRpcError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes("could not find the function") ||
    message.includes("function public.bodycheck_")
  );
}

async function fetchTopByGender(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  weekId: string,
  gender: "male" | "female"
): Promise<WeeklyTop | null> {
  const baseQuery = supabase
    .from("post_score_weekly")
    .select("post_id, score_sum, score_avg, vote_count, posts!inner(user_id, images)")
    .eq("week_id", weekId)
    .eq("gender", gender);

  const rankedQuery = baseQuery
    .gte("vote_count", MIN_VOTES)
    .order("score_sum", { ascending: false })
    .order("score_avg", { ascending: false })
    .order("vote_count", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(1);

  const { data, error } = await rankedQuery.maybeSingle();
  if (error) throw error;
  const normalizedTop = normalizeWeeklyTop(data);
  if (normalizedTop?.post_id) return normalizedTop;

  // Fallback: if no one reached MIN_VOTES, still pin weekly 1st among existing votes.
  const fallbackQuery = baseQuery
    .order("score_sum", { ascending: false })
    .order("score_avg", { ascending: false })
    .order("vote_count", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(1);

  const { data: fallbackData, error: fallbackError } = await fallbackQuery.maybeSingle();
  if (fallbackError) throw fallbackError;
  const normalizedFallback = normalizeWeeklyTop(fallbackData);
  return normalizedFallback?.post_id ? normalizedFallback : null;
}

async function fetchCandidateWeekIds(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  latestClosedWeekId: string
): Promise<string[]> {
  const weekIdSet = new Set<string>();
  let from = 0;

  while (weekIdSet.size < MAX_BACKFILL_WEEKS) {
    const to = from + WEEK_ID_FETCH_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("post_score_weekly")
      .select("week_id")
      .lte("week_id", latestClosedWeekId)
      .order("week_id", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = data ?? [];
    for (const row of rows) {
      const weekId = String(row.week_id ?? "");
      if (!weekId) continue;
      weekIdSet.add(weekId);
      if (weekIdSet.size >= MAX_BACKFILL_WEEKS) break;
    }

    if (rows.length < WEEK_ID_FETCH_PAGE_SIZE) break;
    from += WEEK_ID_FETCH_PAGE_SIZE;
  }

  return Array.from(weekIdSet);
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
    return NextResponse.json({ error: "unauthorized", reason: "missing_valid_cron_auth" }, { status: 401 });
  }

  const url = new URL(request.url);
  const forcedWeekId = url.searchParams.get("week_id")?.trim() || null;
  const latestClosedWeekId = getPreviousKstWeekId();
  const supabase = createAdminClient();

  try {
    if (forcedWeekId) {
      const rpcRes = await supabase.rpc("bodycheck_sync_weekly_winner", {
        p_week_id: forcedWeekId,
        p_min_votes: MIN_VOTES,
      });

      if (!rpcRes.error) {
        return NextResponse.json({
          ok: true,
          mode: "rpc",
          forced_week_id: forcedWeekId,
          result: rpcRes.data ?? null,
        });
      }
      if (!isMissingRpcError(rpcRes.error)) {
        return NextResponse.json({ error: rpcRes.error.message, target: "bodycheck_sync_weekly_winner" }, { status: 500 });
      }
    } else {
      const rpcRes = await supabase.rpc("bodycheck_backfill_hall_of_fame", {
        p_latest_closed_week_id: latestClosedWeekId,
        p_limit: MAX_BACKFILL_WEEKS,
        p_min_votes: MIN_VOTES,
      });

      if (!rpcRes.error) {
        return NextResponse.json({
          ok: true,
          mode: "rpc",
          latest_closed_week_id: latestClosedWeekId,
          result: rpcRes.data ?? null,
        });
      }
      if (!isMissingRpcError(rpcRes.error)) {
        return NextResponse.json({ error: rpcRes.error.message, target: "bodycheck_backfill_hall_of_fame" }, { status: 500 });
      }
    }

    const candidateWeekIds = forcedWeekId ? [forcedWeekId] : await fetchCandidateWeekIds(supabase, latestClosedWeekId);
    const inserted: Array<{ week_id: string; gender: "male" | "female" }> = [];
    const skipped: Array<{ week_id: string; reason: string }> = [];
    const snapshots: Array<{ week_id: string; male_post_id: string | null; female_post_id: string | null }> = [];

    for (const weekId of candidateWeekIds) {
      const weekRange = getKstWeekRangeFromWeekId(weekId);
      if (!weekRange) {
        skipped.push({ week_id: weekId, reason: "invalid_week_id" });
        continue;
      }

      const [maleTop, femaleTop] = await Promise.all([
        fetchTopByGender(supabase, weekId, "male"),
        fetchTopByGender(supabase, weekId, "female"),
      ]);

      const weeklySnapshotRes = await supabase.from("weekly_winners").upsert(
        {
          week_start: weekRange.startUtcIso,
          week_end: weekRange.endUtcIso,
          male_post_id: maleTop?.post_id ?? null,
          female_post_id: femaleTop?.post_id ?? null,
          male_score: Math.max(0, Number(maleTop?.score_sum ?? 0)),
          female_score: Math.max(0, Number(femaleTop?.score_sum ?? 0)),
        },
        { onConflict: "week_start" }
      );
      if (weeklySnapshotRes.error) {
        return NextResponse.json({ error: weeklySnapshotRes.error.message, week_id: weekId, target: "weekly_winners" }, { status: 500 });
      }
      snapshots.push({
        week_id: weekId,
        male_post_id: maleTop?.post_id ?? null,
        female_post_id: femaleTop?.post_id ?? null,
      });

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
      processed_week_ids: candidateWeekIds,
      snapshots,
      inserted,
      skipped,
      no_op: inserted.length === 0 && snapshots.length === 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

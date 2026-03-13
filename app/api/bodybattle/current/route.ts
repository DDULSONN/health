import { BODY_BATTLE_MIN_VOTES, buildMatchupKey, resolvePrompt } from "@/lib/bodybattle";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type SeasonRow = {
  id: string;
  week_id: string;
  theme_slug: string;
  theme_label: string;
  start_at: string;
  end_at: string;
  status: "active" | "draft" | "closed";
};

type EntryRow = {
  id: string;
  user_id: string;
  nickname: string;
  gender: "male" | "female";
  intro_text: string | null;
  image_url: string | null;
  rating: number;
  current_streak: number;
  best_streak: number;
  exposures: number;
  votes_received: number;
  created_at: string;
};

const MAX_ENTRY_POOL = 200;
const MAX_RECENT_PAIR_VOTES = 1200;
const MAX_MATCH_RATING_DIFF = 200;

function readViewerFingerprint(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const parts = cookie.split(";").map((v) => v.trim());
  const target = parts.find((v) => v.startsWith("bb_vid="));
  const existing = target?.slice("bb_vid=".length).trim();
  if (existing) return existing;
  return crypto.randomUUID();
}

function withViewerCookie(response: NextResponse, viewerId: string, request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie.includes("bb_vid=")) {
    response.cookies.set("bb_vid", viewerId, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  return response;
}

function weightedPick(items: EntryRow[]) {
  if (items.length === 0) return null;
  const weights = items.map((entry, idx) => {
    const exposurePenalty = 1 / (1 + Math.max(0, Number(entry.exposures ?? 0)));
    const votePenalty = 1 / (1 + Math.max(0, Number(entry.votes_received ?? 0)));
    const freshnessBoost = Math.max(0, 30 - idx) / 30;
    return exposurePenalty * 0.65 + votePenalty * 0.25 + freshnessBoost * 0.1;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[0] ?? null;
  let pick = Math.random() * total;
  for (let i = 0; i < items.length; i += 1) {
    pick -= weights[i] ?? 0;
    if (pick <= 0) return items[i] ?? null;
  }
  return items[items.length - 1] ?? null;
}

function scoreCandidateRight(left: EntryRow, right: EntryRow, recentPairCount: number) {
  const ratingDiff = Math.abs((right.rating ?? 1000) - (left.rating ?? 1000));
  const ratingScore = Math.max(0, 1 - ratingDiff / 300);
  const exposureScore = 1 / (1 + Math.max(0, Number(right.exposures ?? 0)));
  const voteScore = 1 / (1 + Math.max(0, Number(right.votes_received ?? 0)));
  const pairPenalty = 1 / (1 + Math.max(0, recentPairCount));
  return ratingScore * 0.5 + exposureScore * 0.25 + voteScore * 0.15 + pairPenalty * 0.1;
}

async function hasDuplicateVote(
  admin: ReturnType<typeof createAdminClient>,
  seasonId: string,
  matchupKey: string,
  userId: string | null,
  viewerFingerprint: string
) {
  if (userId) {
    const { data, error } = await admin
      .from("bodybattle_votes")
      .select("id")
      .eq("season_id", seasonId)
      .eq("matchup_key", matchupKey)
      .eq("voter_user_id", userId)
      .limit(1)
      .maybeSingle();
    if (!error && data) return true;
  }

  const { data, error } = await admin
    .from("bodybattle_votes")
    .select("id")
    .eq("season_id", seasonId)
    .eq("matchup_key", matchupKey)
    .eq("viewer_fingerprint", viewerFingerprint)
    .limit(1)
    .maybeSingle();
  if (!error && data) return true;

  return false;
}

export async function GET(request: Request) {
  const admin = createAdminClient();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const viewerFingerprint = readViewerFingerprint(request);
  const nowIso = new Date().toISOString();
  const { searchParams } = new URL(request.url);
  const genderParam = searchParams.get("gender");
  const gender = genderParam === "male" || genderParam === "female" ? genderParam : null;

  let seasonRes = await admin
    .from("bodybattle_seasons")
    .select("id,week_id,theme_slug,theme_label,start_at,end_at,status")
    .eq("status", "active")
    .lte("start_at", nowIso)
    .gt("end_at", nowIso)
    .order("start_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (seasonRes.error) {
    return NextResponse.json({ ok: false, message: seasonRes.error.message }, { status: 500 });
  }
  if (!seasonRes.data) {
    await admin.rpc("bodybattle_ensure_current_season");
    seasonRes = await admin
      .from("bodybattle_seasons")
      .select("id,week_id,theme_slug,theme_label,start_at,end_at,status")
      .eq("status", "active")
      .lte("start_at", nowIso)
      .gt("end_at", nowIso)
      .order("start_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  }
  const season = (seasonRes.data ?? null) as SeasonRow | null;
  if (!season) {
    return withViewerCookie(NextResponse.json({ ok: true, season: null, matchup: null }), viewerFingerprint, request);
  }

  let entriesQuery = admin
    .from("bodybattle_entries")
    .select("id,user_id,nickname,gender,intro_text,image_url:image_urls->>0,rating,current_streak,best_streak,exposures,votes_received,created_at")
    .eq("season_id", season.id)
    .eq("moderation_status", "approved")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(MAX_ENTRY_POOL);
  if (gender) entriesQuery = entriesQuery.eq("gender", gender);

  const entriesRes = await entriesQuery;
  if (entriesRes.error) {
    return NextResponse.json({ ok: false, message: entriesRes.error.message }, { status: 500 });
  }

  const entries = (entriesRes.data ?? []) as EntryRow[];
  if (entries.length < 2) {
    return withViewerCookie(
      NextResponse.json({
        ok: true,
        season,
        matchup: null,
        message: "아직 대결을 만들 만큼 신청자가 모이지 않았습니다.",
      }),
      viewerFingerprint,
      request
    );
  }

  const left = weightedPick(entries);
  if (!left) {
    return withViewerCookie(NextResponse.json({ ok: true, season, matchup: null }), viewerFingerprint, request);
  }

  const recentWindowIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentPairsRes = await admin
    .from("bodybattle_votes")
    .select("matchup_key")
    .eq("season_id", season.id)
    .gte("created_at", recentWindowIso)
    .order("created_at", { ascending: false })
    .limit(MAX_RECENT_PAIR_VOTES);

  const recentPairCountMap = new Map<string, number>();
  if (!recentPairsRes.error) {
    for (const row of recentPairsRes.data ?? []) {
      const key = String(row.matchup_key ?? "");
      if (!key) continue;
      recentPairCountMap.set(key, (recentPairCountMap.get(key) ?? 0) + 1);
    }
  }

  const opposite = entries.filter((entry) => entry.id !== left.id);
  const rankedAll = opposite
    .map((entry) => {
      const pairKey = buildMatchupKey(left.id, entry.id);
      const pairCount = recentPairCountMap.get(pairKey) ?? 0;
      const ratingDiff = Math.abs((entry.rating ?? 1000) - (left.rating ?? 1000));
      return {
        entry,
        pairKey,
        pairCount,
        ratingDiff,
        score: scoreCandidateRight(left, entry, pairCount),
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.entry.exposures ?? 0) - (b.entry.exposures ?? 0);
    });

  const withinRatingGap = rankedAll.filter((candidate) => candidate.ratingDiff <= MAX_MATCH_RATING_DIFF);
  const noRecentPair = withinRatingGap.filter((candidate) => candidate.pairCount === 0);
  const rankedOpposite = noRecentPair.length > 0 ? noRecentPair : withinRatingGap.length > 0 ? withinRatingGap : rankedAll;

  const right = rankedOpposite[0]?.entry ?? null;
  if (!right) {
    return withViewerCookie(NextResponse.json({ ok: true, season, matchup: null }), viewerFingerprint, request);
  }

  let finalRight = right;
  let matchupKey = buildMatchupKey(left.id, right.id);
  const firstPairDup = await hasDuplicateVote(admin, season.id, matchupKey, user?.id ?? null, viewerFingerprint);

  if (firstPairDup) {
    for (const candidate of rankedOpposite) {
      if (candidate.entry.id === right.id) continue;
      const nextKey = candidate.pairKey;
      const isDup = await hasDuplicateVote(admin, season.id, nextKey, user?.id ?? null, viewerFingerprint);
      if (!isDup) {
        finalRight = candidate.entry;
        matchupKey = nextKey;
        break;
      }
    }
  }

  const prompt = resolvePrompt(season.theme_slug, left.nickname.length + finalRight.nickname.length);
  const exposureTargets = [left.id, finalRight.id];
  await Promise.all(
    exposureTargets.map(async (id) => {
      await admin.rpc("increment_bodybattle_exposures_safe", {
        p_entry_id: id,
      });
    })
  );

  return withViewerCookie(
    NextResponse.json({
      ok: true,
      season,
      matchup: {
        matchup_key: matchupKey,
        prompt,
        left,
        right: finalRight,
      },
      rules: {
        min_votes: BODY_BATTLE_MIN_VOTES,
      },
    }),
    viewerFingerprint,
    request
  );
}

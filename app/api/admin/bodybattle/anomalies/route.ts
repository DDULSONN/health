import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "../_auth";

type VoteRow = {
  id: string;
  season_id: string;
  left_entry_id: string;
  right_entry_id: string;
  winner_side: "left" | "right" | "draw";
  voter_user_id: string | null;
  viewer_fingerprint: string | null;
  created_at: string;
};

type SuspiciousActor = {
  actor_key: string;
  kind: "user" | "viewer";
  votes: number;
  distinct_matchups: number;
  left_ratio: number;
  right_ratio: number;
  draw_ratio: number;
  dominant_entry_id: string | null;
  dominant_entry_votes: number;
  score: number;
};

function pushCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  const hours = Math.max(1, Math.min(168, Number(searchParams.get("hours") ?? 24)));
  const fromIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();
  let query = admin
    .from("bodybattle_votes")
    .select("id,season_id,left_entry_id,right_entry_id,winner_side,voter_user_id,viewer_fingerprint,created_at")
    .gte("created_at", fromIso)
    .order("created_at", { ascending: false })
    .limit(20000);
  if (seasonId) query = query.eq("season_id", seasonId);

  const votesRes = await query;
  if (votesRes.error) {
    return NextResponse.json({ ok: false, message: votesRes.error.message }, { status: 500 });
  }

  const votes = (votesRes.data ?? []) as VoteRow[];
  const grouped = new Map<
    string,
    {
      kind: "user" | "viewer";
      votes: number;
      sides: { left: number; right: number; draw: number };
      matchupSet: Set<string>;
      entryCount: Map<string, number>;
    }
  >();

  for (const vote of votes) {
    const actorKey = vote.voter_user_id ? `user:${vote.voter_user_id}` : `viewer:${vote.viewer_fingerprint ?? "unknown"}`;
    const kind: "user" | "viewer" = vote.voter_user_id ? "user" : "viewer";
    if (!grouped.has(actorKey)) {
      grouped.set(actorKey, {
        kind,
        votes: 0,
        sides: { left: 0, right: 0, draw: 0 },
        matchupSet: new Set<string>(),
        entryCount: new Map<string, number>(),
      });
    }
    const bucket = grouped.get(actorKey)!;
    bucket.votes += 1;
    if (vote.winner_side === "left") bucket.sides.left += 1;
    else if (vote.winner_side === "right") bucket.sides.right += 1;
    else bucket.sides.draw += 1;
    bucket.matchupSet.add([vote.left_entry_id, vote.right_entry_id].sort().join(":"));

    if (vote.winner_side === "left") pushCount(bucket.entryCount, vote.left_entry_id);
    else if (vote.winner_side === "right") pushCount(bucket.entryCount, vote.right_entry_id);
  }

  const suspicious: SuspiciousActor[] = [];
  for (const [actorKey, bucket] of grouped) {
    const votesCount = bucket.votes;
    const distinctMatchups = bucket.matchupSet.size;
    const leftRatio = votesCount > 0 ? bucket.sides.left / votesCount : 0;
    const rightRatio = votesCount > 0 ? bucket.sides.right / votesCount : 0;
    const drawRatio = votesCount > 0 ? bucket.sides.draw / votesCount : 0;

    let dominantEntryId: string | null = null;
    let dominantVotes = 0;
    for (const [entryId, count] of bucket.entryCount) {
      if (count > dominantVotes) {
        dominantVotes = count;
        dominantEntryId = entryId;
      }
    }
    const dominantRatio = votesCount > 0 ? dominantVotes / votesCount : 0;

    const volumeThreshold = bucket.kind === "user" ? 120 : 60;
    let score = 0;
    if (votesCount >= volumeThreshold) score += 2;
    if (votesCount >= volumeThreshold * 2) score += 2;
    if (distinctMatchups <= 10 && votesCount >= 40) score += 1;
    if (leftRatio >= 0.97 || rightRatio >= 0.97) score += 1;
    if (dominantRatio >= 0.8 && votesCount >= 40) score += 2;
    if (dominantRatio >= 0.9 && votesCount >= 25) score += 2;

    if (score >= 3) {
      suspicious.push({
        actor_key: actorKey,
        kind: bucket.kind,
        votes: votesCount,
        distinct_matchups: distinctMatchups,
        left_ratio: Number((leftRatio * 100).toFixed(1)),
        right_ratio: Number((rightRatio * 100).toFixed(1)),
        draw_ratio: Number((drawRatio * 100).toFixed(1)),
        dominant_entry_id: dominantEntryId,
        dominant_entry_votes: dominantVotes,
        score,
      });
    }
  }

  suspicious.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.votes - a.votes;
  });

  return NextResponse.json({
    ok: true,
    from: fromIso,
    hours,
    season_id: seasonId,
    scanned_votes: votes.length,
    suspicious_actors: suspicious.slice(0, 200),
  });
}

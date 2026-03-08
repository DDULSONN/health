import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ScoreMode = "all" | "weekly";

type ProfileRow = {
  user_id: string | null;
  viewer_fingerprint: string | null;
  level: number;
  xp: number;
  total_votes: number;
  vote_streak_days: number;
  last_voted_at: string | null;
};

function clampTop(value: number) {
  if (!Number.isFinite(value)) return 20;
  return Math.max(5, Math.min(50, Math.floor(value)));
}

function readViewerFingerprint(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const parts = cookie.split(";").map((v) => v.trim());
  const target = parts.find((v) => v.startsWith("bb_vid="));
  const existing = target?.slice("bb_vid=".length).trim();
  return existing || null;
}

function guestLabel(fingerprint: string | null) {
  if (!fingerprint) return "Guest";
  return `Guest-${fingerprint.slice(0, 6)}`;
}

async function buildNicknameMap(admin: ReturnType<typeof createAdminClient>, rows: Array<{ user_id: string | null }>) {
  const userIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id)))];
  if (userIds.length === 0) return new Map<string, string>();
  const profilesRes = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
  if (profilesRes.error) throw new Error(profilesRes.error.message);
  const map = new Map<string, string>();
  for (const p of profilesRes.data ?? []) {
    if (p.user_id) map.set(p.user_id, p.nickname ?? "Unknown");
  }
  return map;
}

async function buildAllScoreboard(admin: ReturnType<typeof createAdminClient>, top: number) {
  const mvRes = await admin
    .from("bodybattle_scoreboard_all_mv")
    .select("user_id,viewer_fingerprint,level,xp,total_votes,vote_streak_days,last_voted_at")
    .order("rank_no", { ascending: true })
    .limit(top);
  if (!mvRes.error) {
    return (mvRes.data ?? []) as ProfileRow[];
  }

  const boardRes = await admin
    .from("bodybattle_voter_profiles")
    .select("user_id,viewer_fingerprint,level,xp,total_votes,vote_streak_days,last_voted_at")
    .order("xp", { ascending: false })
    .order("total_votes", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(top);
  if (boardRes.error) throw new Error(boardRes.error.message);
  return (boardRes.data ?? []) as ProfileRow[];
}

async function buildWeeklyScoreboard(admin: ReturnType<typeof createAdminClient>, top: number) {
  const nowIso = new Date().toISOString();
  const seasonRes = await admin
    .from("bodybattle_seasons")
    .select("id,start_at")
    .eq("status", "active")
    .lte("start_at", nowIso)
    .gt("end_at", nowIso)
    .order("start_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seasonRes.error) throw new Error(seasonRes.error.message);
  if (!seasonRes.data) return { rows: [] as ProfileRow[], weeklyVotes: new Map<string, number>() };

  const votesRes = await admin
    .from("bodybattle_votes")
    .select("voter_user_id,viewer_fingerprint,created_at")
    .eq("season_id", seasonRes.data.id)
    .gte("created_at", seasonRes.data.start_at)
    .order("created_at", { ascending: false })
    .limit(50000);
  if (votesRes.error) throw new Error(votesRes.error.message);

  const weeklyVotes = new Map<string, number>();
  for (const vote of votesRes.data ?? []) {
    const key = vote.voter_user_id ? `user:${vote.voter_user_id}` : `viewer:${vote.viewer_fingerprint ?? "unknown"}`;
    weeklyVotes.set(key, (weeklyVotes.get(key) ?? 0) + 1);
  }
  if (weeklyVotes.size === 0) return { rows: [] as ProfileRow[], weeklyVotes };

  const rows = await admin
    .from("bodybattle_voter_profiles")
    .select("user_id,viewer_fingerprint,level,xp,total_votes,vote_streak_days,last_voted_at")
    .or(
      [
        ...[...weeklyVotes.keys()]
          .filter((key) => key.startsWith("user:"))
          .map((key) => `user_id.eq.${key.replace("user:", "")}`),
        ...[...weeklyVotes.keys()]
          .filter((key) => key.startsWith("viewer:"))
          .map((key) => `viewer_fingerprint.eq.${key.replace("viewer:", "")}`),
      ].join(",")
    )
    .limit(1000);
  if (rows.error) throw new Error(rows.error.message);

  const sorted = ((rows.data ?? []) as ProfileRow[])
    .map((row) => {
      const key = row.user_id ? `user:${row.user_id}` : `viewer:${row.viewer_fingerprint ?? "unknown"}`;
      const votes = weeklyVotes.get(key) ?? 0;
      return { row, votes, weekly_xp: votes * 10 };
    })
    .sort((a, b) => {
      if (b.weekly_xp !== a.weekly_xp) return b.weekly_xp - a.weekly_xp;
      if (b.votes !== a.votes) return b.votes - a.votes;
      return (b.row.level ?? 1) - (a.row.level ?? 1);
    })
    .slice(0, top);

  return {
    rows: sorted.map((item) => item.row),
    weeklyVotes,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const top = clampTop(Number(searchParams.get("top") ?? 20));
  const mode = searchParams.get("mode") === "weekly" ? "weekly" : "all";

  const admin = createAdminClient();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerFingerprint = readViewerFingerprint(request);

  try {
    const { rows, weeklyVotes } =
      mode === "weekly" ? await buildWeeklyScoreboard(admin, top) : { rows: await buildAllScoreboard(admin, top), weeklyVotes: new Map<string, number>() };

    const profileMap = await buildNicknameMap(admin, rows);
    const items = rows.map((row, idx) => {
      const nickname = row.user_id ? profileMap.get(row.user_id) ?? "Unknown" : guestLabel(row.viewer_fingerprint);
      const actorKey = row.user_id ? `user:${row.user_id}` : `viewer:${row.viewer_fingerprint ?? "unknown"}`;
      const weeklyVotesCount = weeklyVotes.get(actorKey) ?? 0;
      return {
        rank: idx + 1,
        nickname,
        level: Number(row.level ?? 1),
        xp: Number(row.xp ?? 0),
        total_votes: Number(row.total_votes ?? 0),
        vote_streak_days: Number(row.vote_streak_days ?? 0),
        weekly_votes: weeklyVotesCount,
        weekly_xp: weeklyVotesCount * 10,
        streak_badge: Number(row.vote_streak_days ?? 0) >= 7 ? "7d+" : Number(row.vote_streak_days ?? 0) >= 3 ? "3d+" : null,
        is_me:
          (Boolean(user?.id) && row.user_id === user?.id) ||
          (!user?.id && Boolean(viewerFingerprint) && row.viewer_fingerprint === viewerFingerprint),
        last_voted_at: row.last_voted_at,
      };
    });

    return NextResponse.json({
      ok: true,
      mode: mode as ScoreMode,
      items,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

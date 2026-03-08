import { buildMatchupKey } from "@/lib/bodybattle";
import { extractClientIp, checkRouteRateLimit } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type VoteBody = {
  season_id?: string;
  left_entry_id?: string;
  right_entry_id?: string;
  winner_side?: "left" | "right" | "draw";
  matchup_key?: string;
};

type VoteSide = "left" | "right" | "draw";

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

function validateVoteBody(body: VoteBody) {
  if (!body.season_id || !body.left_entry_id || !body.right_entry_id || !body.winner_side) {
    return "Missing required fields.";
  }
  if (!["left", "right", "draw"].includes(body.winner_side)) {
    return "Invalid winner_side.";
  }
  if (body.left_entry_id === body.right_entry_id) {
    return "Entries must be different.";
  }
  const expectedMatchup = buildMatchupKey(body.left_entry_id, body.right_entry_id);
  if (body.matchup_key && body.matchup_key !== expectedMatchup) {
    return "Invalid matchup_key.";
  }
  return null;
}

function mapVoteError(message: string) {
  if (message.includes("DUPLICATE_VOTE")) return { status: 409, message: "Already voted for this matchup." };
  if (message.includes("SELF_VOTE_NOT_ALLOWED")) return { status: 403, message: "Self vote is not allowed." };
  if (message.includes("DAILY_VOTE_LIMIT_EXCEEDED")) return { status: 429, message: "Daily vote limit exceeded." };
  if (message.includes("SEASON_NOT_ACTIVE")) return { status: 400, message: "Season is not active." };
  if (message.includes("CROSS_GENDER_MATCH_NOT_ALLOWED")) return { status: 400, message: "Invalid matchup." };
  if (message.includes("INVALID_MATCHUP_KEY")) return { status: 400, message: "Invalid matchup key." };
  if (message.includes("ENTRY_NOT_VOTABLE")) return { status: 400, message: "This matchup is not votable now." };
  if (message.includes("LEFT_ENTRY_NOT_FOUND") || message.includes("RIGHT_ENTRY_NOT_FOUND")) {
    return { status: 404, message: "Entry not found." };
  }
  return { status: 500, message: "Failed to save vote." };
}

export async function POST(request: Request) {
  const ip = extractClientIp(request);
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "bodybattle_vote",
    userId: user?.id ?? null,
    ip,
    userLimitPerMin: 60,
    ipLimitPerMin: 30,
    path: "/api/bodybattle/vote",
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSec) } }
    );
  }

  const viewerFingerprint = readViewerFingerprint(request);
  const body = (await request.json().catch(() => ({}))) as VoteBody;
  const validationError = validateVoteBody(body);

  if (validationError) {
    return withViewerCookie(NextResponse.json({ ok: false, message: validationError }, { status: 400 }), viewerFingerprint, request);
  }

  const matchupKey = buildMatchupKey(body.left_entry_id!, body.right_entry_id!);
  const admin = createAdminClient();
  const voteRes = await admin.rpc("bodybattle_cast_vote", {
    p_season_id: body.season_id,
    p_left_entry_id: body.left_entry_id,
    p_right_entry_id: body.right_entry_id,
    p_winner_side: body.winner_side,
    p_matchup_key: matchupKey,
    p_voter_user_id: user?.id ?? null,
    p_viewer_fingerprint: viewerFingerprint,
  });

  if (voteRes.error) {
    const mapped = mapVoteError(voteRes.error.message);
    return withViewerCookie(
      NextResponse.json({ ok: false, message: mapped.message }, { status: mapped.status }),
      viewerFingerprint,
      request
    );
  }

  const result = Array.isArray(voteRes.data) ? voteRes.data[0] : voteRes.data;
  const seasonId = body.season_id!;
  const matchupVotesRes = await admin
    .from("bodybattle_votes")
    .select("winner_side")
    .eq("season_id", seasonId)
    .eq("matchup_key", matchupKey);

  let matchupStats = {
    total: 0,
    left: 0,
    right: 0,
    draw: 0,
    left_pct: 0,
    right_pct: 0,
    draw_pct: 0,
  };

  if (!matchupVotesRes.error) {
    const rows = matchupVotesRes.data ?? [];
    const total = rows.length;
    let left = 0;
    let right = 0;
    let draw = 0;
    for (const row of rows) {
      const side = row.winner_side as VoteSide;
      if (side === "left") left += 1;
      else if (side === "right") right += 1;
      else draw += 1;
    }
    matchupStats = {
      total,
      left,
      right,
      draw,
      left_pct: total > 0 ? Number(((left / total) * 100).toFixed(1)) : 0,
      right_pct: total > 0 ? Number(((right / total) * 100).toFixed(1)) : 0,
      draw_pct: total > 0 ? Number(((draw / total) * 100).toFixed(1)) : 0,
    };
  }

  const progress = {
    total_votes: Number(result?.voter_total_votes ?? 0),
    level: Number(result?.voter_level ?? 1),
    xp: Number(result?.voter_xp ?? 0),
    vote_streak_days: Number(result?.voter_vote_streak_days ?? 0),
    xp_next_level: Math.max(0, Number(result?.voter_level ?? 1) * 100 - Number(result?.voter_xp ?? 0)),
  };

  return withViewerCookie(
    NextResponse.json({
      ok: true,
      result,
      matchup_stats: matchupStats,
      progress,
      reward: {
        xp_gained: 10,
      },
    }),
    viewerFingerprint,
    request
  );
}

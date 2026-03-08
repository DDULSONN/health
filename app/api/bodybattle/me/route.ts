import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function readViewerFingerprint(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const parts = cookie.split(";").map((v) => v.trim());
  const target = parts.find((v) => v.startsWith("bb_vid="));
  const existing = target?.slice("bb_vid=".length).trim();
  return existing || null;
}

const REWARD_RULES = [
  { code: "level_3_credit", label: "레벨 3 보상", condition: "level", threshold: 3, amount: 1 },
  { code: "level_5_credit", label: "레벨 5 보상", condition: "level", threshold: 5, amount: 1 },
  { code: "level_10_credit_pack", label: "레벨 10 보상", condition: "level", threshold: 10, amount: 3 },
  { code: "votes_200_credit_pack", label: "200표 달성 보상", condition: "votes", threshold: 200, amount: 2 },
] as const;

export async function GET(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const viewerFingerprint = readViewerFingerprint(request);
  if (!user && !viewerFingerprint) {
    return NextResponse.json({
      ok: true,
      profile: {
        level: 1,
        xp: 0,
        total_votes: 0,
        daily_votes: 0,
        vote_streak_days: 0,
        xp_next_level: 100,
      },
      achievements: [],
      rewards: [],
      credits_remaining: 0,
      can_claim: false,
    });
  }

  let query = admin
    .from("bodybattle_voter_profiles")
    .select("xp,level,total_votes,daily_votes,vote_streak_days,last_voted_date,last_voted_at")
    .limit(1);
  query = user ? query.eq("user_id", user.id) : query.eq("viewer_fingerprint", viewerFingerprint);
  const profileRes = await query.maybeSingle();

  if (profileRes.error) {
    return NextResponse.json({ ok: false, message: profileRes.error.message }, { status: 500 });
  }

  const profile = profileRes.data ?? {
    xp: 0,
    level: 1,
    total_votes: 0,
    daily_votes: 0,
    vote_streak_days: 0,
    last_voted_date: null,
    last_voted_at: null,
  };

  const totalVotes = Number(profile.total_votes ?? 0);
  const level = Number(profile.level ?? 1);
  const streak = Number(profile.vote_streak_days ?? 0);
  const achievements: Array<{ key: string; label: string; earned: boolean }> = [
    { key: "voter_10", label: "첫 10표", earned: totalVotes >= 10 },
    { key: "voter_50", label: "50표 달성", earned: totalVotes >= 50 },
    { key: "voter_200", label: "200표 달성", earned: totalVotes >= 200 },
    { key: "streak_3", label: "3일 연속 투표", earned: streak >= 3 },
    { key: "streak_7", label: "7일 연속 투표", earned: streak >= 7 },
  ];

  const claimedSet = new Set<string>();
  let creditsRemaining = 0;
  if (user) {
    const [claimedRes, creditsRes] = await Promise.all([
      admin
        .from("bodybattle_reward_claims")
        .select("reward_code")
        .eq("user_id", user.id)
        .limit(100),
      admin.from("user_apply_credits").select("credits").eq("user_id", user.id).maybeSingle(),
    ]);
    if (claimedRes.error) {
      return NextResponse.json({ ok: false, message: claimedRes.error.message }, { status: 500 });
    }
    for (const row of claimedRes.data ?? []) {
      if (row.reward_code) claimedSet.add(String(row.reward_code));
    }
    if (!creditsRes.error) {
      creditsRemaining = Math.max(0, Number(creditsRes.data?.credits ?? 0));
    }
  }

  const rewards = REWARD_RULES.map((rule) => {
    const met = rule.condition === "level" ? level >= rule.threshold : totalVotes >= rule.threshold;
    const claimed = claimedSet.has(rule.code);
    return {
      code: rule.code,
      label: rule.label,
      amount: rule.amount,
      met,
      claimed,
      claimable: Boolean(user) && met && !claimed,
    };
  });

  return NextResponse.json({
    ok: true,
    profile: {
      ...profile,
      xp_next_level: Math.max(0, level * 100 - Number(profile.xp ?? 0)),
    },
    achievements,
    rewards,
    credits_remaining: creditsRemaining,
    can_claim: Boolean(user),
  });
}

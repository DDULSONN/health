import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { BodycheckGender } from "@/lib/community";

function getKstWeekRange(now = new Date()) {
  const kstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const day = kstNow.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const startKst = new Date(kstNow);
  startKst.setDate(kstNow.getDate() + diffToMonday);
  startKst.setHours(0, 0, 0, 0);

  const endKst = new Date(startKst);
  endKst.setDate(startKst.getDate() + 7);

  const startUtc = new Date(startKst.getTime() - 9 * 60 * 60 * 1000);
  const endUtc = new Date(endKst.getTime() - 9 * 60 * 60 * 1000);

  return {
    startUtcIso: startUtc.toISOString(),
    endUtcIso: endUtc.toISOString(),
  };
}

function isAhead(a: Record<string, unknown>, b: Record<string, unknown>) {
  const aScore = Number(a.score_sum ?? 0);
  const bScore = Number(b.score_sum ?? 0);
  if (aScore !== bScore) return aScore > bScore;

  const aVotes = Number(a.vote_count ?? 0);
  const bVotes = Number(b.vote_count ?? 0);
  if (aVotes !== bVotes) return aVotes > bVotes;

  return String(a.created_at ?? "") < String(b.created_at ?? "");
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("posts")
    .select("id, title, content, images, created_at, gender, score_sum, vote_count, great_count, good_count, normal_count, rookie_count, is_deleted")
    .eq("user_id", user.id)
    .eq("type", "photo_bodycheck")
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[GET /api/mypage/bodycheck]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const posts = (data ?? []).filter(
    (p) => !(p as Record<string, unknown>).is_deleted
  );

  const { startUtcIso, endUtcIso } = getKstWeekRange();
  const genders = [...new Set(posts.map((post) => post.gender).filter(Boolean))] as BodycheckGender[];
  const weekRankMap = new Map<string, number>();

  for (const gender of genders) {
    const { data: pool } = await supabase
      .from("posts")
      .select("id, score_sum, vote_count, created_at, gender")
      .eq("type", "photo_bodycheck")
      .eq("is_hidden", false)
      .eq("is_deleted", false)
      .eq("gender", gender)
      .gte("created_at", startUtcIso)
      .lt("created_at", endUtcIso);

    const sorted = (pool ?? []).sort((a, b) => {
      if (isAhead(a, b)) return -1;
      if (isAhead(b, a)) return 1;
      return 0;
    });

    sorted.forEach((post, index) => {
      weekRankMap.set(post.id, index + 1);
    });
  }

  return NextResponse.json({
    posts: posts.map((post) => ({
      ...post,
      average_score: post.vote_count ? Number((post.score_sum / post.vote_count).toFixed(2)) : 0,
      weekly_rank: weekRankMap.get(post.id) ?? null,
    })),
  });
}

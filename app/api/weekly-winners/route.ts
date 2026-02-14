import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") ?? 30)));

  const supabase = await createClient();

  const { data: winners, error } = await supabase
    .from("weekly_winners")
    .select("id, week_start, week_end, male_post_id, female_post_id, male_score, female_score, created_at")
    .order("week_start", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const postIds = [
    ...(winners ?? []).map((w) => w.male_post_id).filter(Boolean),
    ...(winners ?? []).map((w) => w.female_post_id).filter(Boolean),
  ] as string[];

  const postMap = new Map<string, { id: string; title: string; user_id: string }>();
  const profileMap = new Map<string, { nickname: string | null }>();

  if (postIds.length > 0) {
    const { data: posts } = await supabase
      .from("posts")
      .select("id, title, user_id")
      .in("id", postIds);

    for (const post of posts ?? []) {
      postMap.set(post.id, post);
    }

    const userIds = [...new Set((posts ?? []).map((p) => p.user_id))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, nickname")
        .in("user_id", userIds);
      for (const profile of profiles ?? []) {
        profileMap.set(profile.user_id, { nickname: profile.nickname });
      }
    }
  }

  const items = (winners ?? []).map((winner) => {
    const malePost = winner.male_post_id ? postMap.get(winner.male_post_id) : null;
    const femalePost = winner.female_post_id ? postMap.get(winner.female_post_id) : null;

    return {
      ...winner,
      male_post: malePost
        ? {
            ...malePost,
            nickname: profileMap.get(malePost.user_id)?.nickname ?? null,
          }
        : null,
      female_post: femalePost
        ? {
            ...femalePost,
            nickname: profileMap.get(femalePost.user_id)?.nickname ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ items });
}

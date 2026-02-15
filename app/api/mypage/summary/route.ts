import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [profileRes, bodycheckRes, winnersRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("nickname, nickname_changed_count, nickname_change_credits")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("posts")
      .select("id, title, created_at, score_sum, vote_count, images, is_deleted")
      .eq("user_id", user.id)
      .eq("type", "photo_bodycheck")
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("hall_of_fame")
      .select("id")
      .eq("user_id", user.id),
  ]);

  if (profileRes.error) {
    return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  }
  if (bodycheckRes.error) {
    return NextResponse.json({ error: bodycheckRes.error.message }, { status: 500 });
  }
  if (winnersRes.error) {
    return NextResponse.json({ error: winnersRes.error.message }, { status: 500 });
  }

  const posts = (bodycheckRes.data ?? []).filter(
    (post) => !(post as Record<string, unknown>).is_deleted,
  );

  const weeklyWinCount = winnersRes.data?.length ?? 0;

  return NextResponse.json({
    profile: {
      nickname: profileRes.data?.nickname ?? null,
      nickname_changed_count: Number(profileRes.data?.nickname_changed_count ?? 0),
      nickname_change_credits: Number(profileRes.data?.nickname_change_credits ?? 0),
      email: user.email ?? null,
    },
    weekly_win_count: weeklyWinCount,
    bodycheck_posts: posts.map((post) => ({
      ...post,
      average_score: post.vote_count
        ? Number((post.score_sum / post.vote_count).toFixed(2))
        : 0,
    })),
  });
}

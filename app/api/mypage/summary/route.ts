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

  let profileRes = await supabase
    .from("profiles")
    .select("nickname, nickname_changed_count, nickname_change_credits, phone_verified, phone_e164, phone_verified_at, swipe_profile_visible")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileRes.error && profileRes.error.message?.includes("swipe_profile_visible")) {
    profileRes = await supabase
      .from("profiles")
      .select("nickname, nickname_changed_count, nickname_change_credits, phone_verified, phone_e164, phone_verified_at")
      .eq("user_id", user.id)
      .maybeSingle();
  }

  const [bodycheckRes, winnersRes] = await Promise.all([
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
      phone_verified: profileRes.data?.phone_verified === true,
      phone_e164: profileRes.data?.phone_e164 ?? null,
      phone_verified_at: profileRes.data?.phone_verified_at ?? null,
      swipe_profile_visible: profileRes.data?.swipe_profile_visible !== false,
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

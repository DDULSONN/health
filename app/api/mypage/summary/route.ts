import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let profileRes = await admin
    .from("profiles")
    .select(
      "nickname, nickname_changed_count, nickname_change_credits, phone_verified, phone_verified_at, swipe_profile_visible, is_banned, banned_reason, banned_at"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileRes.error && profileRes.error.message?.includes("swipe_profile_visible")) {
    profileRes = await admin
      .from("profiles")
      .select(
        "nickname, nickname_changed_count, nickname_change_credits, phone_verified, phone_verified_at, is_banned, banned_reason, banned_at"
      )
      .eq("user_id", user.id)
      .maybeSingle();
  }

  if (profileRes.error) {
    return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  }

  const profile = {
    email: user.email ?? null,
    nickname: profileRes.data?.nickname ?? null,
    nickname_changed_count: Number(profileRes.data?.nickname_changed_count ?? 0),
    nickname_change_credits: Number(profileRes.data?.nickname_change_credits ?? 0),
    phone_verified: profileRes.data?.phone_verified === true,
    phone_verified_at: profileRes.data?.phone_verified_at ?? null,
    swipe_profile_visible: profileRes.data?.swipe_profile_visible !== false,
  };
  const account = {
    is_banned: profileRes.data?.is_banned === true,
    banned_reason: profileRes.data?.banned_reason ?? null,
    banned_at: profileRes.data?.banned_at ?? null,
  };
  const isAdmin = isAllowedAdminUser(user.id, user.email);

  if (new URL(req.url).searchParams.get("profileOnly") === "1") {
    return NextResponse.json({
      profile,
      account,
      isAdmin,
      weekly_win_count: 0,
      bodycheck_posts: [],
    });
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
    supabase.from("hall_of_fame").select("id").eq("user_id", user.id),
  ]);

  if (bodycheckRes.error) {
    return NextResponse.json({ error: bodycheckRes.error.message }, { status: 500 });
  }
  if (winnersRes.error) {
    return NextResponse.json({ error: winnersRes.error.message }, { status: 500 });
  }

  const posts = (bodycheckRes.data ?? []).filter(
    (post) => !(post as Record<string, unknown>).is_deleted
  );

  return NextResponse.json({
    profile,
    account,
    isAdmin,
    weekly_win_count: winnersRes.data?.length ?? 0,
    bodycheck_posts: posts.map((post) => ({
      ...post,
      average_score: post.vote_count
        ? Number((post.score_sum / post.vote_count).toFixed(2))
        : 0,
    })),
  });
}

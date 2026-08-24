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
    .select("nickname, nickname_changed_count, nickname_change_credits, phone_verified, phone_verified_at, swipe_profile_visible")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileRes.error && profileRes.error.message?.includes("swipe_profile_visible")) {
    profileRes = await supabase
      .from("profiles")
      .select("nickname, nickname_changed_count, nickname_change_credits, phone_verified, phone_verified_at")
      .eq("user_id", user.id)
      .maybeSingle();
  }

  if (profileRes.error) {
    return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    profile: {
      email: user.email ?? null,
      nickname: profileRes.data?.nickname ?? null,
      nickname_changed_count: Number(profileRes.data?.nickname_changed_count ?? 0),
      nickname_change_credits: Number(profileRes.data?.nickname_change_credits ?? 0),
      phone_verified: profileRes.data?.phone_verified === true,
      phone_verified_at: profileRes.data?.phone_verified_at ?? null,
      swipe_profile_visible: profileRes.data?.swipe_profile_visible !== false,
    },
  });
}

import { NextResponse } from "next/server";
import type { createClient } from "@/lib/supabase/server";
import { isEmailConfirmed } from "@/lib/auth-confirmed";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getConfirmedActiveUserOrResponse(supabase: ServerClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      response: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }),
      user: null,
    };
  }

  if (!isEmailConfirmed(user)) {
    return {
      response: NextResponse.json(
        {
          error: "메일 인증이 필요합니다. 인증 후 다시 시도해 주세요.",
          error_code: "email_not_confirmed",
        },
        { status: 403 }
      ),
      user: null,
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_banned, banned_reason")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return {
      response: NextResponse.json({ error: "사용자 상태를 확인하지 못했습니다." }, { status: 500 }),
      user: null,
    };
  }

  if (profile?.is_banned) {
    return {
      response: NextResponse.json(
        {
          error: profile.banned_reason?.trim() || "이 계정은 관리자에 의해 제한되었습니다.",
          error_code: "user_banned",
        },
        { status: 403 }
      ),
      user: null,
    };
  }

  return { response: null, user };
}

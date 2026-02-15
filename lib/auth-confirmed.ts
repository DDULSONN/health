import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type UserLike = {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
};

export function isEmailConfirmed(user: UserLike | null | undefined): boolean {
  if (!user) return false;
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

export async function getConfirmedUserOrResponse(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
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

  return { response: null, user };
}

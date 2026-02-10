import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/community";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        // 프로필이 없으면 닉네임 설정 페이지로
        const { data: profile } = await supabase
          .from("profiles")
          .select("nickname")
          .eq("user_id", user.id)
          .single();

        if (!profile) {
          return NextResponse.redirect(
            `${origin}/onboarding?next=${encodeURIComponent(next)}`
          );
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}

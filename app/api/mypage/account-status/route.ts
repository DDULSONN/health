import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const profileRes = await admin
    .from("profiles")
    .select("is_banned,banned_reason,banned_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileRes.error) {
    console.error("[GET /api/mypage/account-status] failed", profileRes.error);
    return NextResponse.json({ error: "계정 상태를 확인하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    account: {
      is_banned: profileRes.data?.is_banned === true,
      banned_reason: profileRes.data?.banned_reason ?? null,
      banned_at: profileRes.data?.banned_at ?? null,
    },
  });
}

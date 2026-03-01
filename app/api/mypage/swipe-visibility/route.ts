import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { enabled?: boolean } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "설정값이 올바르지 않습니다." }, { status: 400 });
  }

  const updateRes = await supabase
    .from("profiles")
    .update({ swipe_profile_visible: body.enabled })
    .eq("user_id", user.id)
    .select("swipe_profile_visible")
    .maybeSingle();

  if (updateRes.error) {
    console.error("[PATCH /api/mypage/swipe-visibility] failed", updateRes.error);
    if (updateRes.error.message?.includes("swipe_profile_visible")) {
      return NextResponse.json({ error: "DB 설정 업데이트가 필요합니다. profile_swipe_visibility.sql을 먼저 적용해주세요." }, { status: 503 });
    }
    return NextResponse.json({ error: "빠른매칭 노출 설정 변경에 실패했습니다." }, { status: 500 });
  }

  if (!updateRes.data) {
    return NextResponse.json({ error: "프로필 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    enabled: updateRes.data.swipe_profile_visible !== false,
  });
}

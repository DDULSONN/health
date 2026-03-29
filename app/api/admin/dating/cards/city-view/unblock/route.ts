import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { createAdminClient } from "@/lib/supabase/server";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type TargetProfile = {
  user_id: string;
  nickname: string | null;
};

async function resolveTargetProfile(
  admin: ReturnType<typeof createAdminClient>,
  identifier: string
): Promise<TargetProfile | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  if (isUuid(trimmed)) {
    const profileRes = await admin
      .from("profiles")
      .select("user_id,nickname")
      .eq("user_id", trimmed)
      .maybeSingle<TargetProfile>();
    if (profileRes.error || !profileRes.data) return null;
    return profileRes.data;
  }

  if (trimmed.includes("@")) {
    const authUserRes = await admin
      .schema("auth")
      .from("users")
      .select("id,email")
      .ilike("email", trimmed)
      .maybeSingle<{ id: string; email: string | null }>();

    if (authUserRes.error || !authUserRes.data) return null;

    const profileRes = await admin
      .from("profiles")
      .select("user_id,nickname")
      .eq("user_id", authUserRes.data.id)
      .maybeSingle<TargetProfile>();

    if (profileRes.error) return null;
    return {
      user_id: authUserRes.data.id,
      nickname: profileRes.data?.nickname ?? null,
    };
  }

  const profileRes = await admin
    .from("profiles")
    .select("user_id,nickname")
    .ilike("nickname", trimmed)
    .maybeSingle<TargetProfile>();

  if (profileRes.error || !profileRes.data) return null;
  return profileRes.data;
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    identifier?: string;
  };

  const identifier = body.identifier?.trim() ?? "";
  if (!identifier) {
    return NextResponse.json({ ok: false, message: "닉네임 또는 사용자 ID를 입력해주세요." }, { status: 400 });
  }

  const target = await resolveTargetProfile(auth.admin, identifier);
  if (!target) {
    return NextResponse.json({ ok: false, message: "해당 사용자를 찾지 못했습니다." }, { status: 404 });
  }

  const pendingRes = await auth.admin
    .from("dating_city_view_requests")
    .select("id")
    .eq("user_id", target.user_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(500);

  if (pendingRes.error) {
    console.error("[admin-city-view-unblock] pending fetch failed", pendingRes.error);
    return NextResponse.json({ ok: false, message: "승인대기 요청을 불러오지 못했습니다." }, { status: 500 });
  }

  const pendingIds = (pendingRes.data ?? []).map((row) => row.id);
  if (pendingIds.length === 0) {
    return NextResponse.json({
      ok: true,
      user_id: target.user_id,
      nickname: target.nickname,
      cleaned_count: 0,
      message: "정리할 승인대기 요청이 없습니다.",
    });
  }

  const updateRes = await auth.admin
    .from("dating_city_view_requests")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: auth.user.id,
      note: "admin full unblock cleanup",
      access_expires_at: null,
    })
    .in("id", pendingIds)
    .select("id");

  if (updateRes.error) {
    console.error("[admin-city-view-unblock] update failed", updateRes.error);
    return NextResponse.json({ ok: false, message: "전체 막힘 해제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user_id: target.user_id,
    nickname: target.nickname,
    cleaned_count: Array.isArray(updateRes.data) ? updateRes.data.length : pendingIds.length,
    message: `${target.nickname ?? target.user_id.slice(0, 8)} 사용자의 가까운 이상형 승인대기 ${pendingIds.length}건을 정리했습니다.`,
  });
}

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizeSex(value: string): "male" | "female" {
  const v = value.trim().toLowerCase();
  if (v === "male" || v === "남자" || v === "남성" || v === "m") return "male";
  return "female";
}

/** GET /api/dating/[id] — 공개 카드 상세 + 댓글 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const adminClient = createAdminClient();

  // 공개 카드만 조회
  const { data: app, error } = await adminClient
    .from("dating_applications")
    .select("id, sex, display_nickname, age, total_3lift, percent_all, training_years, height_cm, ideal_type, created_at")
    .eq("id", id)
    .eq("approved_for_public", true)
    .single();

  if (error || !app) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  // 댓글 조회
  const { data: comments } = await adminClient
    .from("dating_comments")
    .select("id, user_id, content, deleted_at, created_at")
    .eq("application_id", id)
    .order("created_at", { ascending: true });

  // 댓글 유저 닉네임 조회
  const userIds = [...new Set((comments ?? []).map((c) => c.user_id))];
  const nickMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await adminClient
      .from("profiles")
      .select("user_id, nickname")
      .in("user_id", userIds);
    for (const p of profiles ?? []) {
      nickMap[p.user_id] = p.nickname;
    }
  }

  const enrichedComments = (comments ?? []).map((c) => ({
    ...c,
    nickname: nickMap[c.user_id] ?? "익명",
    is_mine: c.user_id === user.id,
  }));

  // 성별에 따라 노출 정보 제한
  const card: Record<string, unknown> = {
    id: app.id,
    sex: normalizeSex(app.sex),
    display_nickname: app.display_nickname,
    age: app.age,
    height_cm: app.height_cm,
    training_years: app.training_years,
    ideal_type: app.ideal_type,
  };

  if (normalizeSex(app.sex) === "male") {
    card.total_3lift = app.total_3lift;
    card.percent_all = app.percent_all;
  } else {
    // 여자: 3대 입력 여부만
    card.has_sbd = app.total_3lift != null && app.total_3lift > 0;
  }

  return NextResponse.json({ card, comments: enrichedComments });
}

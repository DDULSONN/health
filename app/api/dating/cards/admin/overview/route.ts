import { isAdminEmail } from "@/lib/admin";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const adminClient = createAdminClient();

  const [cardsRes, appsRes] = await Promise.all([
    adminClient
      .from("dating_cards")
      .select(
        "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, instagram_id, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, status, published_at, expires_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(300),
    adminClient
      .from("dating_card_applications")
      .select(
        "id, card_id, applicant_user_id, applicant_display_nickname, age, height_cm, region, job, training_years, intro_text, instagram_id, photo_paths, status, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (cardsRes.error || appsRes.error) {
    console.error("[GET /api/dating/cards/admin/overview] failed", {
      cardsError: cardsRes.error,
      appsError: appsRes.error,
    });
    return NextResponse.json({ error: "관리자 데이터를 불러오지 못했습니다." }, { status: 500 });
  }

  const userIds = [
    ...new Set([
      ...(cardsRes.data ?? []).map((card) => card.owner_user_id),
      ...(appsRes.data ?? []).map((app) => app.applicant_user_id),
    ]),
  ];

  let nickMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const profilesRes = await adminClient.from("profiles").select("user_id, nickname").in("user_id", userIds);
    if (!profilesRes.error) {
      nickMap = Object.fromEntries((profilesRes.data ?? []).map((p) => [p.user_id, p.nickname]));
    }
  }

  const cards = (cardsRes.data ?? []).map((card) => ({
    ...card,
    owner_nickname: nickMap[card.owner_user_id] ?? null,
  }));

  const applications = (appsRes.data ?? []).map((app) => ({
    ...app,
    applicant_nickname: nickMap[app.applicant_user_id] ?? null,
  }));

  return NextResponse.json({ cards, applications });
}

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

  let cardsRes: any = await adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, instagram_id, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, status, published_at, expires_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (cardsRes.error && cardsRes.error.code === "42703") {
    cardsRes = await adminClient
      .from("dating_cards")
      .select(
        "id, owner_user_id, sex, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, status, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(2000);

    cardsRes = {
      ...cardsRes,
      data: (cardsRes.data ?? []).map((card: any) => ({
        ...card,
        display_nickname: null,
        instagram_id: null,
        photo_paths: [],
        blur_thumb_path: null,
        published_at: null,
        expires_at: null,
      })),
    };
  }

  let appsRes: any = await adminClient
    .from("dating_card_applications")
    .select(
      "id, card_id, applicant_user_id, applicant_display_nickname, age, height_cm, region, job, training_years, intro_text, instagram_id, photo_paths, status, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(5000);

  if (appsRes.error && appsRes.error.code === "42703") {
    appsRes = await adminClient
      .from("dating_card_applications")
      .select(
        "id, card_id, applicant_user_id, age, height_cm, region, job, training_years, intro_text, instagram_id, photo_urls, status, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(5000);

    appsRes = {
      ...appsRes,
      data: (appsRes.data ?? []).map((app: any) => ({
        ...app,
        applicant_display_nickname: null,
        photo_paths: app.photo_urls ?? [],
      })),
    };
  }

  if (cardsRes.error || appsRes.error) {
    console.error("[GET /api/dating/cards/admin/overview] failed", {
      cardsError: cardsRes.error,
      appsError: appsRes.error,
    });
    return NextResponse.json({ error: "관리자 데이터를 불러오지 못했습니다." }, { status: 500 });
  }

  const userIds = [
    ...new Set([
      ...(cardsRes.data ?? []).map((card: any) => card.owner_user_id),
      ...(appsRes.data ?? []).map((app: any) => app.applicant_user_id),
    ]),
  ];

  let nickMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const profilesRes = await adminClient.from("profiles").select("user_id, nickname").in("user_id", userIds);
    if (!profilesRes.error) {
      nickMap = Object.fromEntries((profilesRes.data ?? []).map((p: any) => [p.user_id, p.nickname]));
    }
  }

  const cards = (cardsRes.data ?? []).map((card: any) => ({
    ...card,
    owner_nickname: nickMap[card.owner_user_id] ?? null,
  }));

  const cardsById: Record<string, any> = Object.fromEntries((cards ?? cardsRes.data ?? []).map((c: any) => [c.id, c]));
  const applications = (appsRes.data ?? []).map((app: any) => {
    const card = cardsById[app.card_id];
    return {
      ...app,
      applicant_nickname: nickMap[app.applicant_user_id] ?? null,
      card_owner_user_id: card?.owner_user_id ?? null,
      card_owner_nickname: card?.owner_nickname ?? null,
      card_display_nickname: card?.display_nickname ?? null,
      card_sex: card?.sex ?? null,
      card_status: card?.status ?? null,
    };
  });

  return NextResponse.json({ cards, applications });
}

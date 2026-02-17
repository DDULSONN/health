import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  let { data: cards, error: cardsError } = await adminClient
    .from("dating_cards")
    .select("id, sex, display_nickname, age, region, expires_at, created_at, status")
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: false });

  // Compatibility fallback for environments where new columns are not migrated yet.
  if (cardsError && cardsError.code === "42703") {
    const fallback = await adminClient
      .from("dating_cards")
      .select("id, sex, age, region, created_at, status")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: false });

    cardsError = fallback.error;
    cards = (fallback.data ?? []).map((row) => ({
      ...row,
      display_nickname: null,
      expires_at: null,
    }));
  }

  if (cardsError) {
    console.error("[GET /api/dating/cards/my/received] cards failed", cardsError);
    return NextResponse.json({ error: "내 카드를 불러오지 못했습니다." }, { status: 500 });
  }

  const cardIds = (cards ?? []).map((c) => c.id);
  if (cardIds.length === 0) {
    return NextResponse.json({ cards: [], applications: [] });
  }

  let { data: applications, error: appsError } = await adminClient
    .from("dating_card_applications")
    .select("id, card_id, applicant_user_id, applicant_display_nickname, age, height_cm, region, job, training_years, intro_text, status, created_at, instagram_id, photo_paths")
    .in("card_id", cardIds)
    .order("created_at", { ascending: false });

  // Compatibility fallback for legacy schema (photo_urls / no applicant_display_nickname).
  if (appsError && appsError.code === "42703") {
    const fallback = await adminClient
      .from("dating_card_applications")
      .select("id, card_id, applicant_user_id, age, height_cm, region, job, training_years, intro_text, status, created_at, instagram_id, photo_urls")
      .in("card_id", cardIds)
      .order("created_at", { ascending: false });

    appsError = fallback.error;
    applications = (fallback.data ?? []).map((row) => ({
      ...row,
      applicant_display_nickname: null,
      photo_paths: row.photo_urls ?? [],
    }));
  }

  if (appsError) {
    console.error("[GET /api/dating/cards/my/received] apps failed", appsError);
    return NextResponse.json({ error: "지원자 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const safeApps = (applications ?? []).map((app) => ({
    ...app,
    instagram_id: app.status === "accepted" ? app.instagram_id : null,
  }));

  return NextResponse.json({ cards: cards ?? [], applications: safeApps });
}

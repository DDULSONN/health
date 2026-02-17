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
  const { data: cards, error: cardsError } = await adminClient
    .from("dating_cards")
    .select("id, sex, age, region, created_at, status")
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: false });

  if (cardsError) {
    console.error("[GET /api/dating/cards/my/received] cards failed", cardsError);
    return NextResponse.json({ error: "내 카드를 불러오지 못했습니다." }, { status: 500 });
  }

  const cardIds = (cards ?? []).map((c) => c.id);
  if (cardIds.length === 0) {
    return NextResponse.json({ cards: [], applications: [] });
  }

  const { data: applications, error: appsError } = await adminClient
    .from("dating_card_applications")
    .select("id, card_id, applicant_user_id, age, height_cm, region, job, training_years, intro_text, status, created_at, instagram_id, photo_urls")
    .in("card_id", cardIds)
    .order("created_at", { ascending: false });

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

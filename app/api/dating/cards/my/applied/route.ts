import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type CardRow = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  display_nickname: string | null;
  status: "pending" | "public" | "expired" | "hidden";
  expires_at: string | null;
  created_at: string;
};

type ProfileRow = {
  user_id: string;
  nickname: string | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  let appsRes: any = await adminClient
    .from("dating_card_applications")
    .select("id, card_id, applicant_display_nickname, age, height_cm, region, job, training_years, intro_text, status, created_at")
    .eq("applicant_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (appsRes.error && appsRes.error.code === "42703") {
    appsRes = await adminClient
      .from("dating_card_applications")
      .select("id, card_id, age, height_cm, region, job, training_years, intro_text, status, created_at")
      .eq("applicant_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(2000);

    appsRes = {
      ...appsRes,
      data: (appsRes.data ?? []).map((row: any) => ({
        ...row,
        applicant_display_nickname: null,
      })),
    };
  }

  if (appsRes.error) {
    console.error("[GET /api/dating/cards/my/applied] apps failed", appsRes.error);
    return NextResponse.json({ error: "내 지원 이력을 불러오지 못했습니다." }, { status: 500 });
  }

  const applications = appsRes.data ?? [];
  const cardIds = [...new Set(applications.map((app: any) => app.card_id).filter(Boolean))];

  if (cardIds.length === 0) {
    return NextResponse.json({ applications: [] });
  }

  const cardsRes = await adminClient
    .from("dating_cards")
    .select("id, owner_user_id, sex, display_nickname, status, expires_at, created_at")
    .in("id", cardIds);

  if (cardsRes.error) {
    console.error("[GET /api/dating/cards/my/applied] cards failed", cardsRes.error);
    return NextResponse.json({ error: "지원한 카드 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const cards = (cardsRes.data ?? []) as CardRow[];
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const ownerIds = [...new Set(cards.map((card) => card.owner_user_id).filter(Boolean))];

  let ownerNickById = new Map<string, string | null>();
  if (ownerIds.length > 0) {
    const profilesRes = await adminClient.from("profiles").select("user_id, nickname").in("user_id", ownerIds);
    if (!profilesRes.error) {
      for (const row of (profilesRes.data ?? []) as ProfileRow[]) {
        ownerNickById.set(row.user_id, row.nickname ?? null);
      }
    }
  }

  const result = applications.map((app: any) => {
    const card = cardsById.get(app.card_id) ?? null;
    return {
      ...app,
      card: card
        ? {
            id: card.id,
            sex: card.sex,
            display_nickname: card.display_nickname,
            status: card.status,
            expires_at: card.expires_at,
            created_at: card.created_at,
            owner_user_id: card.owner_user_id,
            owner_nickname: ownerNickById.get(card.owner_user_id) ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ applications: result });
}

import { createAdminClient } from "@/lib/supabase/server";
import { getDatingBlockedUserIds } from "@/lib/dating-blocks";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type CardRow = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  display_nickname: string | null;
  instagram_id: string | null;
  status: "pending" | "public" | "expired" | "hidden";
  expires_at: string | null;
  created_at: string;
};

type ProfileRow = {
  user_id: string;
  nickname: string | null;
};

type ApplicationRow = {
  id: string;
  card_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  status: string;
  created_at: string;
};

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const blockedUserIds = await getDatingBlockedUserIds(adminClient, user.id);
  const primaryAppsRes = await adminClient
    .from("dating_card_applications")
    .select("id, card_id, applicant_display_nickname, age, height_cm, region, job, training_years, intro_text, status, created_at")
    .eq("applicant_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(2000);

  let appsError = primaryAppsRes.error;
  let applications = (primaryAppsRes.data ?? []) as ApplicationRow[];

  if (appsError && appsError.code === "42703") {
    const fallbackAppsRes = await adminClient
      .from("dating_card_applications")
      .select("id, card_id, age, height_cm, region, job, training_years, intro_text, status, created_at")
      .eq("applicant_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(2000);

    appsError = fallbackAppsRes.error;
    applications = ((fallbackAppsRes.data ?? []) as Omit<ApplicationRow, "applicant_display_nickname">[]).map((row) => ({
      ...row,
      applicant_display_nickname: null,
    }));
  }

  if (appsError) {
    console.error("[GET /api/dating/cards/my/applied] apps failed", appsError);
    return NextResponse.json({ error: "지원 내역을 불러오지 못했습니다." }, { status: 500 });
  }

  const cardIds = [...new Set(applications.map((app) => app.card_id).filter(Boolean))];
  if (cardIds.length === 0) {
    return NextResponse.json({ applications: [] });
  }

  const cardsRes = await adminClient
    .from("dating_cards")
    .select("id, owner_user_id, sex, display_nickname, instagram_id, status, expires_at, created_at")
    .in("id", cardIds);

  if (cardsRes.error) {
    console.error("[GET /api/dating/cards/my/applied] cards failed", cardsRes.error);
    return NextResponse.json({ error: "지원한 카드 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const cards = (cardsRes.data ?? []) as CardRow[];
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const ownerIds = [...new Set(cards.map((card) => card.owner_user_id).filter(Boolean))];
  const ownerNickById = new Map<string, string | null>();

  if (ownerIds.length > 0) {
    const profilesRes = await adminClient.from("profiles").select("user_id, nickname").in("user_id", ownerIds);
    if (!profilesRes.error) {
      for (const row of (profilesRes.data ?? []) as ProfileRow[]) {
        ownerNickById.set(row.user_id, row.nickname ?? null);
      }
    }
  }

  const result = applications.map((app) => {
    const card = cardsById.get(app.card_id) ?? null;
    if (card && blockedUserIds.has(card.owner_user_id)) return null;
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
            instagram_id: card.instagram_id,
            owner_user_id: card.owner_user_id,
            owner_nickname: ownerNickById.get(card.owner_user_id) ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ applications: result.filter(Boolean) });
}



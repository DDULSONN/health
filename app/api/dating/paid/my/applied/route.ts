import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type PaidCardRow = {
  id: string;
  user_id: string;
  gender: "M" | "F";
  nickname: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const appsRes = await adminClient
    .from("dating_paid_card_applications")
    .select("id,paid_card_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,status,created_at")
    .eq("applicant_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (appsRes.error) {
    console.error("[GET /api/dating/paid/my/applied] apps failed", appsRes.error);
    return NextResponse.json({ error: "Failed to load paid applications." }, { status: 500 });
  }

  const applications = appsRes.data ?? [];
  const cardIds = [
    ...new Set(
      applications
        .map((app) => app.paid_card_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    ),
  ];

  if (cardIds.length === 0) {
    return NextResponse.json({ applications: [] });
  }

  const cardsRes = await adminClient
    .from("dating_paid_cards")
    .select("id,user_id,gender,nickname,status,expires_at,created_at")
    .in("id", cardIds);

  if (cardsRes.error) {
    console.error("[GET /api/dating/paid/my/applied] cards failed", cardsRes.error);
    return NextResponse.json({ error: "Failed to load paid cards." }, { status: 500 });
  }

  const cards = (cardsRes.data ?? []) as PaidCardRow[];
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const ownerIds = [
    ...new Set(
      cards
        .map((card) => card.user_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    ),
  ];

  const ownerNickById = new Map<string, string | null>();
  if (ownerIds.length > 0) {
    const profilesRes = await adminClient.from("profiles").select("user_id,nickname").in("user_id", ownerIds);
    if (!profilesRes.error) {
      for (const row of (profilesRes.data ?? []) as ProfileRow[]) {
        ownerNickById.set(row.user_id, row.nickname ?? null);
      }
    }
  }

  const result = applications.map((app) => {
    const card = cardsById.get(app.paid_card_id) ?? null;
    return {
      id: app.id,
      card_id: app.paid_card_id,
      applicant_display_nickname: app.applicant_display_nickname,
      age: app.age,
      height_cm: app.height_cm,
      region: app.region,
      job: app.job,
      training_years: app.training_years,
      intro_text: app.intro_text,
      status: app.status,
      created_at: app.created_at,
      card: card
        ? {
            id: card.id,
            gender: card.gender,
            nickname: card.nickname,
            status: card.status,
            expires_at: card.expires_at,
            created_at: card.created_at,
            owner_user_id: card.user_id,
            owner_nickname: ownerNickById.get(card.user_id) ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ applications: result });
}


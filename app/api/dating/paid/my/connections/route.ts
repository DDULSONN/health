import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const admin = createAdminClient();

  const [ownedCardsRes, myAppliedRes] = await Promise.all([
    admin.from("dating_paid_cards").select("id,user_id").eq("user_id", user.id),
    admin
      .from("dating_paid_card_applications")
      .select("id,paid_card_id,applicant_user_id,instagram_id,status,created_at")
      .eq("applicant_user_id", user.id)
      .eq("status", "accepted")
      .order("created_at", { ascending: false }),
  ]);

  if (ownedCardsRes.error || myAppliedRes.error) {
    console.error("[GET /api/dating/paid/my/connections] load failed", {
      ownedCardsError: ownedCardsRes.error,
      myAppliedError: myAppliedRes.error,
    });
    return NextResponse.json({ error: "연결 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const ownedCardIds = (ownedCardsRes.data ?? []).map((c) => c.id);
  const ownerAcceptedRes =
    ownedCardIds.length > 0
      ? await admin
          .from("dating_paid_card_applications")
          .select("id,paid_card_id,applicant_user_id,instagram_id,status,created_at")
          .in("paid_card_id", ownedCardIds)
          .eq("status", "accepted")
          .order("created_at", { ascending: false })
      : { data: [], error: null };

  if (ownerAcceptedRes.error) {
    console.error("[GET /api/dating/paid/my/connections] owner accepted failed", ownerAcceptedRes.error);
    return NextResponse.json({ error: "연결 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const acceptedApps = [...(myAppliedRes.data ?? []), ...(ownerAcceptedRes.data ?? [])];
  if (acceptedApps.length === 0) return NextResponse.json({ items: [] });

  const cardIds = [...new Set(acceptedApps.map((a) => a.paid_card_id))];
  const cardsRes = await admin
    .from("dating_paid_cards")
    .select("id,user_id,instagram_id")
    .in("id", cardIds);
  if (cardsRes.error) {
    console.error("[GET /api/dating/paid/my/connections] cards failed", cardsRes.error);
    return NextResponse.json({ error: "연결 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const cardsById = new Map((cardsRes.data ?? []).map((c) => [c.id, c]));
  const profileIds = [
    ...new Set([
      ...(cardsRes.data ?? []).map((c) => c.user_id),
      ...acceptedApps.map((a) => a.applicant_user_id),
    ]),
  ];
  const profilesRes = await admin.from("profiles").select("user_id,nickname").in("user_id", profileIds);
  const profileMap = new Map((profilesRes.data ?? []).map((p) => [p.user_id, p.nickname]));

  const items = acceptedApps
    .map((app) => {
      const card = cardsById.get(app.paid_card_id);
      if (!card) return null;
      const isOwnerView = card.user_id === user.id;
      const otherUserId = isOwnerView ? app.applicant_user_id : card.user_id;
      const otherNickname = profileMap.get(otherUserId) ?? "익명";
      return {
        application_id: app.id,
        card_id: app.paid_card_id,
        created_at: app.created_at,
        role: isOwnerView ? "owner" : "applicant",
        other_user_id: otherUserId,
        other_nickname: otherNickname,
        my_instagram_id: isOwnerView ? card.instagram_id ?? null : app.instagram_id,
        other_instagram_id: isOwnerView ? app.instagram_id : card.instagram_id ?? null,
        source: "paid",
      };
    })
    .filter(Boolean);

  return NextResponse.json({ items });
}

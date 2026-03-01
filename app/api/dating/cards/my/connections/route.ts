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

  const [ownedCardsRes, myAppliedRes] = await Promise.all([
    adminClient.from("dating_cards").select("id, owner_user_id").eq("owner_user_id", user.id),
    adminClient
      .from("dating_card_applications")
      .select("id, card_id, applicant_user_id, instagram_id, status, created_at")
      .eq("applicant_user_id", user.id)
      .eq("status", "accepted")
      .order("created_at", { ascending: false }),
  ]);

  if (ownedCardsRes.error || myAppliedRes.error) {
    console.error("[GET /api/dating/cards/my/connections] load failed", {
      ownedCardsError: ownedCardsRes.error,
      myAppliedError: myAppliedRes.error,
    });
    return NextResponse.json({ error: "연결 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const ownedCardIds = (ownedCardsRes.data ?? []).map((card) => card.id);
  const ownerAcceptedRes =
    ownedCardIds.length > 0
      ? await adminClient
          .from("dating_card_applications")
          .select("id, card_id, applicant_user_id, instagram_id, status, created_at")
          .in("card_id", ownedCardIds)
          .eq("status", "accepted")
          .order("created_at", { ascending: false })
      : { data: [], error: null };

  if (ownerAcceptedRes.error) {
    console.error("[GET /api/dating/cards/my/connections] owner accepted failed", ownerAcceptedRes.error);
    return NextResponse.json({ error: "연결 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const swipeMatchesRes = await adminClient
    .from("dating_card_swipe_matches")
    .select(
      "id, user_a_id, user_b_id, user_a_card_id, user_b_card_id, user_a_instagram_id, user_b_instagram_id, created_at"
    )
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  if (swipeMatchesRes.error) {
    console.error("[GET /api/dating/cards/my/connections] swipe matches failed", swipeMatchesRes.error);
    return NextResponse.json({ error: "?곌껐 ?뺣낫瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??" }, { status: 500 });
  }

  const acceptedApps = [...(myAppliedRes.data ?? []), ...(ownerAcceptedRes.data ?? [])];
  const swipeMatches = swipeMatchesRes.data ?? [];
  if (acceptedApps.length === 0 && swipeMatches.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const cardIds = [
    ...new Set([
      ...acceptedApps.map((app) => app.card_id),
      ...swipeMatches.map((match) => match.user_a_card_id),
      ...swipeMatches.map((match) => match.user_b_card_id),
    ]),
  ];
  const cardsRes = await adminClient.from("dating_cards").select("id, owner_user_id, instagram_id").in("id", cardIds);
  if (cardsRes.error) {
    console.error("[GET /api/dating/cards/my/connections] cards failed", cardsRes.error);
    return NextResponse.json({ error: "연결 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const cardsById = new Map((cardsRes.data ?? []).map((card) => [card.id, card]));
  const ownerIds = [...new Set((cardsRes.data ?? []).map((card) => card.owner_user_id))];
  const swipeUserIds = swipeMatches.flatMap((match) => [match.user_a_id, match.user_b_id]);
  const profileIds = [...new Set([...ownerIds, ...acceptedApps.map((app) => app.applicant_user_id), ...swipeUserIds])];
  const profilesRes = await adminClient.from("profiles").select("user_id, nickname").in("user_id", profileIds);
  const profileMap = new Map((profilesRes.data ?? []).map((p) => [p.user_id, p.nickname]));

  const acceptedItems = acceptedApps
    .map((app) => {
      const card = cardsById.get(app.card_id);
      if (!card) return null;
      const isOwnerView = card.owner_user_id === user.id;
      const otherUserId = isOwnerView ? app.applicant_user_id : card.owner_user_id;
      const otherNickname = profileMap.get(otherUserId) ?? "익명";
      const myInstagram = isOwnerView ? card.instagram_id ?? null : app.instagram_id;
      const otherInstagram = isOwnerView ? app.instagram_id : card.instagram_id ?? null;
      return {
        application_id: app.id,
        card_id: app.card_id,
        created_at: app.created_at,
        role: isOwnerView ? "owner" : "applicant",
        other_user_id: otherUserId,
        other_nickname: otherNickname,
        my_instagram_id: myInstagram,
        other_instagram_id: otherInstagram,
      };
    })
    .filter(Boolean);

  const swipeItems = swipeMatches
    .map((match) => {
      const isUserA = match.user_a_id === user.id;
      const otherUserId = isUserA ? match.user_b_id : match.user_a_id;
      const otherCardId = isUserA ? match.user_b_card_id : match.user_a_card_id;
      const otherNickname = profileMap.get(otherUserId) ?? "?듬챸";
      const myInstagram = isUserA ? match.user_a_instagram_id : match.user_b_instagram_id;
      const otherInstagram = isUserA ? match.user_b_instagram_id : match.user_a_instagram_id;
      return {
        application_id: match.id,
        card_id: otherCardId,
        created_at: match.created_at,
        role: "swipe_match",
        other_user_id: otherUserId,
        other_nickname: otherNickname,
        my_instagram_id: myInstagram ?? null,
        other_instagram_id: otherInstagram ?? null,
        source: "open",
      };
    })
    .filter(Boolean);

  return NextResponse.json({ items: [...acceptedItems, ...swipeItems] });
}

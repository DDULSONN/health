import { getDatingBlockedUserIds } from "@/lib/dating-blocks";
import { pickPreviewImage } from "@/lib/dating-swipe";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type SwipeRow = {
  id: string;
  actor_user_id: string;
  actor_card_id: string;
  target_user_id: string;
  target_card_id: string;
  action: "like" | "pass";
  created_at: string;
};

type SwipeMatchRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  user_a_card_id: string;
  user_b_card_id: string;
  created_at: string;
};

type CardRow = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female" | null;
  display_nickname: string | null;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  intro_text: string | null;
  photo_visibility?: "blur" | "public" | null;
  photo_paths?: string[] | null;
  blur_paths?: string[] | null;
  blur_thumb_path?: string | null;
};

type ProfileRow = {
  user_id: string;
  nickname: string | null;
};

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("could not find the table")
  );
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const blockedUserIds = await getDatingBlockedUserIds(admin, user.id);

  const [outgoingRes, incomingRes, matchesRes] = await Promise.all([
    admin
      .from("dating_card_swipes")
      .select("id, actor_user_id, actor_card_id, target_user_id, target_card_id, action, created_at")
      .eq("actor_user_id", user.id)
      .eq("action", "like")
      .order("created_at", { ascending: false }),
    admin
      .from("dating_card_swipes")
      .select("id, actor_user_id, actor_card_id, target_user_id, target_card_id, action, created_at")
      .eq("target_user_id", user.id)
      .eq("action", "like")
      .order("created_at", { ascending: false }),
    admin
      .from("dating_card_swipe_matches")
      .select("id, user_a_id, user_b_id, user_a_card_id, user_b_card_id, created_at")
      .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
      .order("created_at", { ascending: false }),
  ]);

  if (outgoingRes.error || incomingRes.error) {
    console.error("[GET /api/dating/cards/my/swipe-status] swipes failed", {
      outgoingError: outgoingRes.error,
      incomingError: incomingRes.error,
    });
    return NextResponse.json({ error: "빠른매칭 상태를 불러오지 못했습니다." }, { status: 500 });
  }

  let swipeMatches: SwipeMatchRow[] = [];
  if (matchesRes.error) {
    if (isMissingRelationError(matchesRes.error)) {
      console.warn("[GET /api/dating/cards/my/swipe-status] swipe matches table missing, skipping");
    } else {
      console.error("[GET /api/dating/cards/my/swipe-status] matches failed", matchesRes.error);
      return NextResponse.json({ error: "빠른매칭 상태를 불러오지 못했습니다." }, { status: 500 });
    }
  } else {
    swipeMatches = (matchesRes.data ?? []) as SwipeMatchRow[];
  }

  const outgoingLikes = ((outgoingRes.data ?? []) as SwipeRow[]).filter((row) => !blockedUserIds.has(row.target_user_id));
  const incomingLikesRaw = ((incomingRes.data ?? []) as SwipeRow[]).filter((row) => !blockedUserIds.has(row.actor_user_id));

  const matchedUserIds = new Set<string>();
  const pairCreatedAt = new Map<string, string>();
  for (const row of swipeMatches) {
    const otherUserId = row.user_a_id === user.id ? row.user_b_id : row.user_a_id;
    matchedUserIds.add(otherUserId);
    pairCreatedAt.set(otherUserId, row.created_at);
  }

  const incomingLikes = incomingLikesRaw.filter((row) => !matchedUserIds.has(row.actor_user_id));

  const cardIds = [
    ...new Set([
      ...outgoingLikes.map((row) => row.target_card_id),
      ...incomingLikes.map((row) => row.actor_card_id),
    ]),
  ];

  const cardsRes =
    cardIds.length > 0
      ? await admin
          .from("dating_cards")
          .select(
            "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, intro_text, photo_visibility, photo_paths, blur_paths, blur_thumb_path"
          )
          .in("id", cardIds)
      : { data: [], error: null };

  if (cardsRes.error) {
    console.error("[GET /api/dating/cards/my/swipe-status] cards failed", cardsRes.error);
    return NextResponse.json({ error: "빠른매칭 상태를 불러오지 못했습니다." }, { status: 500 });
  }

  const cardsById = new Map(((cardsRes.data ?? []) as CardRow[]).map((card) => [card.id, card]));
  const profileIds = [
    ...new Set([
      ...outgoingLikes.map((row) => row.target_user_id),
      ...incomingLikes.map((row) => row.actor_user_id),
    ]),
  ];

  const profilesRes =
    profileIds.length > 0
      ? await admin.from("profiles").select("user_id, nickname").in("user_id", profileIds)
      : { data: [], error: null };

  if (profilesRes.error) {
    console.error("[GET /api/dating/cards/my/swipe-status] profiles failed", profilesRes.error);
    return NextResponse.json({ error: "빠른매칭 상태를 불러오지 못했습니다." }, { status: 500 });
  }

  const profileMap = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((row) => [row.user_id, row.nickname]));

  return NextResponse.json({
    summary: {
      outgoing_pending: outgoingLikes.filter((row) => !matchedUserIds.has(row.target_user_id)).length,
      incoming_pending: incomingLikes.length,
      mutual_matches: swipeMatches.filter((row) => !blockedUserIds.has(row.user_a_id === user.id ? row.user_b_id : row.user_a_id)).length,
    },
    outgoing_likes: outgoingLikes.map((row) => {
      const card = cardsById.get(row.target_card_id) ?? null;
      const otherNickname = String(profileMap.get(row.target_user_id) ?? card?.display_nickname ?? "익명").trim() || "익명";
      const matchedAt = pairCreatedAt.get(row.target_user_id) ?? null;
      return {
        swipe_id: row.id,
        created_at: row.created_at,
        other_user_id: row.target_user_id,
        matched: Boolean(matchedAt),
        matched_at: matchedAt,
        card: card
          ? {
              id: card.id,
              sex: card.sex,
              display_nickname: String(card.display_nickname ?? otherNickname).trim() || otherNickname,
              age: card.age ?? null,
              region: card.region ?? null,
              height_cm: card.height_cm ?? null,
              job: card.job ?? null,
              training_years: card.training_years ?? null,
              ideal_type: card.ideal_type ?? null,
              strengths_text: card.strengths_text ?? null,
              intro_text: card.intro_text ?? null,
              image_url: pickPreviewImage(card),
            }
          : null,
      };
    }),
    incoming_likes: incomingLikes.map((row) => {
      const card = cardsById.get(row.actor_card_id) ?? null;
      const otherNickname = String(profileMap.get(row.actor_user_id) ?? card?.display_nickname ?? "익명").trim() || "익명";
      return {
        swipe_id: row.id,
        created_at: row.created_at,
        other_user_id: row.actor_user_id,
        card: card
          ? {
              id: card.id,
              sex: card.sex,
              display_nickname: String(card.display_nickname ?? otherNickname).trim() || otherNickname,
              age: card.age ?? null,
              region: card.region ?? null,
              height_cm: card.height_cm ?? null,
              job: card.job ?? null,
              training_years: card.training_years ?? null,
              ideal_type: card.ideal_type ?? null,
              strengths_text: card.strengths_text ?? null,
              intro_text: card.intro_text ?? null,
              image_url: pickPreviewImage(card),
            }
          : null,
      };
    }),
  });
}

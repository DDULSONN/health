import { isAllowedAdminUser } from "@/lib/admin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const PAGE_SIZE = 1000;

type DatingCardRow = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  display_nickname: string | null;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  strengths_text: string | null;
  ideal_type: string | null;
  instagram_id: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  is_3lift_verified: boolean;
  photo_paths: string[] | null;
  blur_thumb_path: string | null;
  status: "pending" | "public" | "expired" | "hidden";
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type DatingCardFallbackRow = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  is_3lift_verified: boolean;
  status: "pending" | "public" | "expired" | "hidden";
  created_at: string;
};

type DatingCardApplicationRow = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  instagram_id: string | null;
  photo_paths: string[] | null;
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
};

type DatingCardApplicationFallbackRow = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  instagram_id: string | null;
  photo_urls: string[] | null;
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
};

type ProfileRow = {
  user_id: string;
  nickname: string | null;
};

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
) {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const page = await fetchPage(from, to);
    if (page.error) {
      return { data: null as T[] | null, error: page.error };
    }
    const rows = page.data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: all, error: null as unknown };
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  return String((error as { code?: unknown }).code ?? "");
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user || !isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "沅뚰븳???놁뒿?덈떎." }, { status: 403 });
  }

  const adminClient = createAdminClient();

  let cardsRes = await fetchAllRows<DatingCardRow>((from, to) =>
    adminClient
      .from("dating_cards")
      .select(
        "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, strengths_text, ideal_type, instagram_id, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, status, published_at, expires_at, created_at"
      )
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  if (cardsRes.error && getErrorCode(cardsRes.error) === "42703") {
    const fallbackCardsRes = await fetchAllRows<DatingCardFallbackRow>((from, to) =>
      adminClient
        .from("dating_cards")
        .select(
          "id, owner_user_id, sex, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, status, created_at"
        )
        .order("created_at", { ascending: false })
        .range(from, to)
    );

    cardsRes = {
      ...fallbackCardsRes,
      data: (fallbackCardsRes.data ?? []).map((card) => ({
        ...card,
        display_nickname: null,
        strengths_text: null,
        instagram_id: null,
        photo_paths: [],
        blur_thumb_path: null,
        published_at: null,
        expires_at: null,
      })),
    };
  }

  let appsRes = await fetchAllRows<DatingCardApplicationRow>((from, to) =>
    adminClient
      .from("dating_card_applications")
      .select(
        "id, card_id, applicant_user_id, applicant_display_nickname, age, height_cm, region, job, training_years, intro_text, instagram_id, photo_paths, status, created_at"
      )
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  if (appsRes.error && getErrorCode(appsRes.error) === "42703") {
    const fallbackAppsRes = await fetchAllRows<DatingCardApplicationFallbackRow>((from, to) =>
      adminClient
        .from("dating_card_applications")
        .select(
          "id, card_id, applicant_user_id, age, height_cm, region, job, training_years, intro_text, instagram_id, photo_urls, status, created_at"
        )
        .order("created_at", { ascending: false })
        .range(from, to)
    );

    appsRes = {
      ...fallbackAppsRes,
      data: (fallbackAppsRes.data ?? []).map((app) => ({
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
    return NextResponse.json({ error: "愿由ъ옄 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲??" }, { status: 500 });
  }

  const userIds = [
    ...new Set([
      ...(cardsRes.data ?? []).map((card) => card.owner_user_id),
      ...(appsRes.data ?? []).map((app) => app.applicant_user_id),
    ]),
  ];

  let nickMap: Record<string, string | null> = {};
  if (userIds.length > 0) {
    const profilesRes = await adminClient.from("profiles").select("user_id, nickname").in("user_id", userIds);
    if (!profilesRes.error) {
      nickMap = Object.fromEntries(((profilesRes.data ?? []) as ProfileRow[]).map((p) => [p.user_id, p.nickname]));
    }
  }

  const cards = (cardsRes.data ?? []).map((card) => ({
    ...card,
    owner_nickname: nickMap[card.owner_user_id] ?? null,
  }));

  const cardsById = Object.fromEntries(cards.map((card) => [card.id, card])) as Record<string, (typeof cards)[number]>;
  const applications = (appsRes.data ?? []).map((app) => {
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


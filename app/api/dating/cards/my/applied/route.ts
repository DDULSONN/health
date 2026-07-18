import { createAdminClient } from "@/lib/supabase/server";
import { getDatingBlockedUserIds } from "@/lib/dating-blocks";
import { buildSignedImageUrl, buildSignedImageUrlAllowRaw, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type CardRow = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  display_nickname: string | null;
  instagram_id: string | null;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  intro_text: string | null;
  photo_visibility: "public" | "blur" | null;
  photo_paths: string[] | null;
  blur_paths: string[] | null;
  blur_thumb_path: string | null;
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

function normalizeCardPhotoPath(value: unknown): string {
  return extractStorageObjectPathFromBuckets(value, ["dating-card-photos", "dating-photos"]) ?? "";
}

function cardPhotoUrls(card: CardRow): string[] {
  const rawPaths = Array.isArray(card.photo_paths) ? card.photo_paths.map(normalizeCardPhotoPath).filter(Boolean) : [];
  if (card.photo_visibility === "public") {
    return rawPaths.map((path) => buildSignedImageUrlAllowRaw("dating-card-photos", path)).filter(Boolean);
  }

  const blurPaths = Array.isArray(card.blur_paths) ? card.blur_paths.map(normalizeCardPhotoPath).filter(Boolean) : [];
  const blurred = blurPaths.map((path) => buildSignedImageUrl("dating-card-photos", path)).filter(Boolean);
  if (blurred.length > 0) return blurred;

  const thumbPath = normalizeCardPhotoPath(card.blur_thumb_path);
  const thumbUrl = thumbPath ? buildSignedImageUrl("dating-card-photos", thumbPath) : "";
  return thumbUrl ? [thumbUrl, thumbUrl] : [];
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || (message.includes("column") && message.includes(columnName.toLowerCase()));
}

async function loadAppliedCards(
  adminClient: ReturnType<typeof createAdminClient>,
  cardIds: string[]
): Promise<{ data: CardRow[]; error: unknown }> {
  const withIntroRes = await adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, display_nickname, instagram_id, age, region, height_cm, job, training_years, ideal_type, strengths_text, intro_text, photo_visibility, photo_paths, blur_paths, blur_thumb_path, status, expires_at, created_at"
    )
    .in("id", cardIds);

  if (!withIntroRes.error) {
    return { data: (withIntroRes.data ?? []) as CardRow[], error: null };
  }
  if (!isMissingColumnError(withIntroRes.error, "intro_text")) {
    return { data: [], error: withIntroRes.error };
  }

  const fallbackRes = await adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, display_nickname, instagram_id, age, region, height_cm, job, training_years, ideal_type, strengths_text, photo_visibility, photo_paths, blur_paths, blur_thumb_path, status, expires_at, created_at"
    )
    .in("id", cardIds);

  return {
    data: ((fallbackRes.data ?? []) as Omit<CardRow, "intro_text">[]).map((card) => ({ ...card, intro_text: null })),
    error: fallbackRes.error,
  };
}

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

  const cardsRes = await loadAppliedCards(adminClient, cardIds);

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
            age: card.age,
            region: card.region,
            height_cm: card.height_cm,
            job: card.job,
            training_years: card.training_years,
            ideal_type: card.ideal_type,
            strengths_text: card.strengths_text,
            intro_text: card.intro_text,
            photo_signed_urls: app.status === "accepted" ? cardPhotoUrls(card) : [],
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



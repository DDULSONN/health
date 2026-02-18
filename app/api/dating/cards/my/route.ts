import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizeInstagramId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

function validInstagramId(value: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(value);
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function toText(value: unknown, max = 2000): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, photo_visibility, total_3lift, percent_all, is_3lift_verified, status, published_at, expires_at, created_at"
    )
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/dating/cards/my] failed", error);
    return NextResponse.json({ error: "내 카드를 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "서버 설정 오류입니다. 관리자에게 문의해주세요. (SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 }
    );
  }

  const sex = (body as { sex?: unknown }).sex;
  if (sex !== "male" && sex !== "female") {
    return NextResponse.json({ error: "성별을 확인해주세요." }, { status: 400 });
  }

  const age = toInt((body as { age?: unknown }).age);
  const heightCm = toInt((body as { height_cm?: unknown }).height_cm);
  const trainingYears = toInt((body as { training_years?: unknown }).training_years);
  const total3Lift = toInt((body as { total_3lift?: unknown }).total_3lift);
  const percentAllRaw = (body as { percent_all?: unknown }).percent_all;
  const percentAll =
    typeof percentAllRaw === "number"
      ? percentAllRaw
      : typeof percentAllRaw === "string" && percentAllRaw.trim()
      ? Number(percentAllRaw)
      : null;

  const region = toText((body as { region?: unknown }).region, 30);
  const job = toText((body as { job?: unknown }).job, 50);
  const idealType = toText((body as { ideal_type?: unknown }).ideal_type, 1000);
  const strengthsText = toText((body as { strengths_text?: unknown }).strengths_text, 150);
  const photoVisibilityRaw = (body as { photo_visibility?: unknown }).photo_visibility;
  const photoVisibility = photoVisibilityRaw === "public" ? "public" : "blur";

  const instagramId = normalizeInstagramId((body as { instagram_id?: unknown }).instagram_id);
  const photoPathsRaw = (body as { photo_paths?: unknown }).photo_paths;
  const blurThumbPath = toText((body as { blur_thumb_path?: unknown }).blur_thumb_path, 400);

  const photoPaths = Array.isArray(photoPathsRaw)
    ? photoPathsRaw.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];

  if (!instagramId || !validInstagramId(instagramId)) {
    return NextResponse.json(
      { error: "인스타그램 아이디 형식이 올바르지 않습니다. (@ 제외, 영문/숫자/._, 최대 30자)" },
      { status: 400 }
    );
  }
  if (age != null && (age < 19 || age > 99)) return NextResponse.json({ error: "나이를 확인해주세요." }, { status: 400 });
  if (heightCm != null && (heightCm < 120 || heightCm > 230)) return NextResponse.json({ error: "키를 확인해주세요." }, { status: 400 });
  if (trainingYears != null && (trainingYears < 0 || trainingYears > 50)) {
    return NextResponse.json({ error: "운동경력을 확인해주세요." }, { status: 400 });
  }
  if (photoPaths.length < 1) {
    return NextResponse.json({ error: "오픈카드 사진은 최소 1장 필요합니다." }, { status: 400 });
  }
  if (!blurThumbPath) {
    return NextResponse.json({ error: "블러 썸네일 생성에 실패했습니다. 다시 시도해주세요." }, { status: 400 });
  }
  if (!photoPaths.every((path) => path.startsWith(`cards/${user.id}/raw/`))) {
    return NextResponse.json({ error: "사진 경로가 올바르지 않습니다." }, { status: 400 });
  }
  if (!blurThumbPath.startsWith(`cards/${user.id}/blur/`)) {
    return NextResponse.json({ error: "블러 썸네일 경로가 올바르지 않습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const profileRes = await adminClient
    .from("profiles")
    .select("nickname")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileRes.error) {
    console.error("[POST /api/dating/cards/my] profile fetch failed", profileRes.error);
    return NextResponse.json({ error: "닉네임 정보를 불러오지 못했습니다." }, { status: 500 });
  }
  const metadataNickname = toText((user.user_metadata as { nickname?: unknown } | null)?.nickname, 20);
  const displayNickname = toText(profileRes.data?.nickname ?? metadataNickname, 20);
  if (!displayNickname) {
    return NextResponse.json({ error: "프로필 닉네임이 없습니다. 닉네임 설정 후 다시 시도해주세요." }, { status: 400 });
  }

  const publishedAt = null;
  const expiresAt = null;

  const payload = {
    owner_user_id: user.id,
    sex,
    display_nickname: displayNickname,
    age,
    region: region || null,
    height_cm: heightCm,
    job: job || null,
    training_years: trainingYears,
    ideal_type: idealType || null,
    strengths_text: strengthsText || null,
    photo_visibility: photoVisibility,
    instagram_id: instagramId,
    photo_paths: photoPaths,
    blur_thumb_path: blurThumbPath,
    total_3lift: sex === "male" ? total3Lift : null,
    percent_all: sex === "male" && Number.isFinite(percentAll) ? percentAll : null,
    is_3lift_verified: Boolean((body as { is_3lift_verified?: unknown }).is_3lift_verified),
    status: "pending" as const,
    published_at: publishedAt,
    expires_at: expiresAt,
  };

  const payloadCommon = {
    owner_user_id: user.id,
    sex,
    age,
    region: region || null,
    height_cm: heightCm,
    job: job || null,
    training_years: trainingYears,
    ideal_type: idealType || null,
    strengths_text: strengthsText || null,
    photo_visibility: photoVisibility,
    total_3lift: sex === "male" ? total3Lift : null,
    percent_all: sex === "male" && Number.isFinite(percentAll) ? percentAll : null,
    is_3lift_verified: Boolean((body as { is_3lift_verified?: unknown }).is_3lift_verified),
    status: "pending" as const,
    published_at: publishedAt,
    expires_at: expiresAt,
  };

  const legacyBase = {
    owner_user_id: user.id,
    sex,
    age,
    region: region || null,
    height_cm: heightCm,
    job: job || null,
    training_years: trainingYears,
    ideal_type: idealType || null,
    status: "pending" as const,
  };

  const insertCandidates: Record<string, unknown>[] = [
    payload,
    // Hybrid fallback: new instagram + old photo column
    {
      ...payloadCommon,
      instagram_id: instagramId,
      photo_urls: photoPaths,
      display_nickname: displayNickname,
      strengths_text: strengthsText || null,
      photo_visibility: photoVisibility,
    },
    // Legacy-safe candidate: new instagram + old photo column, no display/published/expires
    {
      ...legacyBase,
      instagram_id: instagramId,
      photo_urls: photoPaths,
      strengths_text: strengthsText || null,
      photo_visibility: photoVisibility,
      total_3lift: sex === "male" ? total3Lift : null,
      percent_all: sex === "male" && Number.isFinite(percentAll) ? percentAll : null,
      is_3lift_verified: Boolean((body as { is_3lift_verified?: unknown }).is_3lift_verified),
    },
    // Alternate minimal candidate (new instagram/photo names, no display/published/expires)
    {
      ...legacyBase,
      instagram_id: instagramId,
      photo_paths: photoPaths,
    },
  ];

  let insertRes: any = null;
  for (const candidate of insertCandidates) {
    insertRes = await adminClient.from("dating_cards").insert(candidate).select("id,status").single();
    if (!insertRes.error) break;
    if (!isMissingColumnError(insertRes.error)) break;
  }

  const { data, error } = insertRes;
  if (error) {
    console.error("[POST /api/dating/cards/my] failed", error);
    if (error.code === "23514") {
      return NextResponse.json({ error: "입력값이 조건에 맞지 않습니다. 입력 항목을 다시 확인해주세요." }, { status: 400 });
    }
    if (error.code === "23502") {
      return NextResponse.json({ error: "필수 항목 누락으로 카드 생성에 실패했습니다. DB 마이그레이션 상태를 확인해주세요." }, { status: 500 });
    }
    return NextResponse.json({ error: `카드 생성에 실패했습니다. ${error.message ?? ""}`.trim() }, { status: 500 });
  }

  return NextResponse.json(
    {
      id: data.id,
      status: data.status,
      message: "오픈카드가 대기열에 등록되었습니다.",
    },
    { status: 201 }
  );
}


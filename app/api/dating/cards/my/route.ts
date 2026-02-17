import { OPEN_CARD_EXPIRE_HOURS, OPEN_CARD_LIMIT_PER_SEX } from "@/lib/dating-open";
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

async function hasPublicSlot(adminClient: ReturnType<typeof createAdminClient>, sex: "male" | "female") {
  let { count, error } = await adminClient
    .from("dating_cards")
    .select("id", { count: "exact", head: true })
    .eq("sex", sex)
    .eq("status", "public")
    .gt("expires_at", new Date().toISOString());

  // Legacy fallback when expires_at column is not available yet.
  if (error && error.code === "42703") {
    const legacy = await adminClient
      .from("dating_cards")
      .select("id", { count: "exact", head: true })
      .eq("sex", sex)
      .eq("status", "public");
    count = legacy.count;
    error = legacy.error;
  }

  // Do not hard-fail card creation when slot query is unstable.
  // Fallback policy: treat as no available public slot -> create pending card.
  if (error) {
    console.error("[hasPublicSlot] failed; fallback to pending", error);
    return false;
  }
  return (count ?? 0) < OPEN_CARD_LIMIT_PER_SEX;
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
      "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, status, published_at, expires_at, created_at"
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

  const displayNickname = toText((body as { display_nickname?: unknown }).display_nickname, 20);
  const region = toText((body as { region?: unknown }).region, 30);
  const job = toText((body as { job?: unknown }).job, 50);
  const idealType = toText((body as { ideal_type?: unknown }).ideal_type, 1000);

  const instagramId = normalizeInstagramId((body as { instagram_id?: unknown }).instagram_id);
  const photoPathsRaw = (body as { photo_paths?: unknown }).photo_paths;
  const blurThumbPath = toText((body as { blur_thumb_path?: unknown }).blur_thumb_path, 400);

  const photoPaths = Array.isArray(photoPathsRaw)
    ? photoPathsRaw.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];

  if (!displayNickname) return NextResponse.json({ error: "닉네임(표시용)을 입력해주세요." }, { status: 400 });
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
  const available = await hasPublicSlot(adminClient, sex);

  const now = new Date();
  const publishedAt = available ? now.toISOString() : null;
  const expiresAt = available ? new Date(now.getTime() + OPEN_CARD_EXPIRE_HOURS * 60 * 60 * 1000).toISOString() : null;

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
    instagram_id: instagramId,
    photo_paths: photoPaths,
    blur_thumb_path: blurThumbPath,
    total_3lift: sex === "male" ? total3Lift : null,
    percent_all: sex === "male" && Number.isFinite(percentAll) ? percentAll : null,
    is_3lift_verified: Boolean((body as { is_3lift_verified?: unknown }).is_3lift_verified),
    status: available ? ("public" as const) : ("pending" as const),
    published_at: publishedAt,
    expires_at: expiresAt,
  };

  let insertRes: any = await adminClient.from("dating_cards").insert(payload).select("id,status").single();

  // Legacy fallback for environments that still use owner_instagram_id/photo_urls and may not have new columns.
  if (insertRes.error && insertRes.error.code === "42703") {
    const legacyPayload = {
      owner_user_id: user.id,
      sex,
      age,
      region: region || null,
      height_cm: heightCm,
      job: job || null,
      training_years: trainingYears,
      ideal_type: idealType || null,
      owner_instagram_id: instagramId,
      photo_urls: photoPaths,
      total_3lift: sex === "male" ? total3Lift : null,
      percent_all: sex === "male" && Number.isFinite(percentAll) ? percentAll : null,
      is_3lift_verified: Boolean((body as { is_3lift_verified?: unknown }).is_3lift_verified),
      status: available ? ("public" as const) : ("pending" as const),
    };
    insertRes = await adminClient.from("dating_cards").insert(legacyPayload).select("id,status").single();
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
      message:
        data.status === "public"
          ? "오픈카드가 공개되었습니다."
          : "현재 공개 슬롯이 가득 찼어요. 대기열에 등록되었습니다.",
    },
    { status: 201 }
  );
}

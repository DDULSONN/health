import { getKstDayRangeUtc } from "@/lib/dating-open";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function normalizeInstagramId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

function validInstagramId(value: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(value);
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const cardId = sanitizeText((body as { card_id?: unknown }).card_id, 100);
  const age = toInt((body as { age?: unknown }).age);
  const heightCm = toInt((body as { height_cm?: unknown }).height_cm);
  const trainingYears = toInt((body as { training_years?: unknown }).training_years);
  const region = sanitizeText((body as { region?: unknown }).region, 30);
  const job = sanitizeText((body as { job?: unknown }).job, 50);
  const introText = sanitizeText((body as { intro_text?: unknown }).intro_text, 1000);
  const instagramId = normalizeInstagramId((body as { instagram_id?: unknown }).instagram_id);
  const photoPathsRaw = (body as { photo_paths?: unknown }).photo_paths;
  const consent = Boolean((body as { consent?: unknown }).consent);

  const photoPaths = Array.isArray(photoPathsRaw)
    ? photoPathsRaw.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];

  if (!cardId) return NextResponse.json({ error: "card_id가 필요합니다." }, { status: 400 });
  if (!instagramId || !validInstagramId(instagramId)) {
    return NextResponse.json(
      { error: "인스타그램 아이디 형식이 올바르지 않습니다. (@ 제외, 영문/숫자/._, 최대 30자)" },
      { status: 400 }
    );
  }
  if (!consent) return NextResponse.json({ error: "동의가 필요합니다." }, { status: 400 });
  if (photoPaths.length !== 2) return NextResponse.json({ error: "지원 사진은 2장이 필요합니다." }, { status: 400 });
  if (!photoPaths.every((path) => path.startsWith(`card-applications/${user.id}/`))) {
    return NextResponse.json({ error: "업로드 경로가 올바르지 않습니다." }, { status: 400 });
  }
  if (age == null || age < 19 || age > 99) {
    return NextResponse.json({ error: "나이를 확인해주세요." }, { status: 400 });
  }
  if (heightCm == null || heightCm < 120 || heightCm > 230) {
    return NextResponse.json({ error: "키를 확인해주세요." }, { status: 400 });
  }
  if (trainingYears == null || trainingYears < 0 || trainingYears > 50) {
    return NextResponse.json({ error: "운동경력을 확인해주세요." }, { status: 400 });
  }
  if (!introText) {
    return NextResponse.json({ error: "자기소개를 입력해주세요." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const profileRes = await adminClient
    .from("profiles")
    .select("nickname")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileRes.error) {
    console.error("[POST /api/dating/cards/apply] profile fetch failed", profileRes.error);
    return NextResponse.json({ error: "닉네임 정보를 불러오지 못했습니다." }, { status: 500 });
  }
  const applicantDisplayNickname = sanitizeText(profileRes.data?.nickname, 20);
  if (!applicantDisplayNickname) {
    return NextResponse.json(
      { error: "닉네임 설정 후 이용 가능", profile_edit_url: "/mypage" },
      { status: 400 }
    );
  }

  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select("id, owner_user_id, status, expires_at")
    .eq("id", cardId)
    .single();
  if (cardError || !card) return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  if (card.status !== "public" || !card.expires_at || new Date(card.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "지원 가능한 카드가 아닙니다." }, { status: 400 });
  }
  if (card.owner_user_id === user.id) return NextResponse.json({ error: "본인 카드에는 지원할 수 없습니다." }, { status: 400 });

  const { startUtcIso, endUtcIso } = getKstDayRangeUtc();
  const { count: todayCount, error: countError } = await adminClient
    .from("dating_card_applications")
    .select("id", { head: true, count: "exact" })
    .eq("applicant_user_id", user.id)
    .in("status", ["submitted", "accepted", "rejected"])
    .gte("created_at", startUtcIso)
    .lt("created_at", endUtcIso);

  if (countError) {
    console.error("[POST /api/dating/cards/apply] count failed", countError);
    return NextResponse.json({ error: "지원 횟수 확인에 실패했습니다." }, { status: 500 });
  }
  if ((todayCount ?? 0) >= 2) {
    return NextResponse.json(
      {
        code: "DAILY_APPLY_LIMIT",
        error: "하루 지원 가능 횟수(2회)를 모두 사용했어요. 내일 다시 지원할 수 있어요.",
      },
      { status: 429 }
    );
  }

  const payload = {
    card_id: cardId,
    applicant_user_id: user.id,
    applicant_display_nickname: applicantDisplayNickname,
    age,
    height_cm: heightCm,
    region,
    job,
    training_years: trainingYears,
    intro_text: introText,
    instagram_id: instagramId,
    photo_paths: photoPaths,
    status: "submitted" as const,
  };

  const { data, error } = await adminClient
    .from("dating_card_applications")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "이미 해당 카드에 지원하셨어요." }, { status: 409 });
    }
    console.error("[POST /api/dating/cards/apply] failed", error);
    return NextResponse.json({ error: "지원 처리에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}

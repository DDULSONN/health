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

function toText(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
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
      "id, owner_user_id, sex, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, status, created_at"
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
  const ownerInstagramId = normalizeInstagramId((body as { owner_instagram_id?: unknown }).owner_instagram_id);
  if (!ownerInstagramId || !validInstagramId(ownerInstagramId)) {
    return NextResponse.json(
      { error: "인스타그램 아이디 형식이 올바르지 않습니다. (@ 제외, 영문/숫자/._, 최대 30자)" },
      { status: 400 }
    );
  }

  const payload = {
    owner_user_id: user.id,
    sex,
    age,
    region: toText((body as { region?: unknown }).region, 30),
    height_cm: heightCm,
    job: toText((body as { job?: unknown }).job, 50),
    training_years: trainingYears,
    ideal_type: toText((body as { ideal_type?: unknown }).ideal_type, 1000),
    owner_instagram_id: ownerInstagramId,
    total_3lift: sex === "male" ? total3Lift : null,
    percent_all: sex === "male" && Number.isFinite(percentAll) ? percentAll : null,
    is_3lift_verified: Boolean((body as { is_3lift_verified?: unknown }).is_3lift_verified),
    status: "pending" as const,
  };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.from("dating_cards").insert(payload).select("id").single();
  if (error) {
    console.error("[POST /api/dating/cards/my] failed", error);
    return NextResponse.json({ error: "카드 생성에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}

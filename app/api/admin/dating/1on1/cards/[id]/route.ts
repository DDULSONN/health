import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import { NextResponse } from "next/server";

const CARD_STATUSES = new Set(["submitted", "reviewing", "approved", "rejected"]);
const SEX_VALUES = new Set(["male", "female"]);
const SMOKING_VALUES = new Set(["non_smoker", "occasional", "smoker"]);
const WORKOUT_VALUES = new Set(["none", "1_2", "3_4", "5_plus"]);

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function nullableInt(value: unknown, min: number, max: number) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const cardId = id.trim();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const expectedUserId = text(body?.expected_user_id, 100);
  if (!cardId || !body || !expectedUserId) {
    return NextResponse.json({ ok: false, error: "회원과 카드 정보를 확인해 주세요." }, { status: 400 });
  }

  const cardRes = await guard.admin
    .from("dating_1on1_cards")
    .select("id,user_id,status")
    .eq("id", cardId)
    .eq("user_id", expectedUserId)
    .maybeSingle();
  if (cardRes.error) {
    return NextResponse.json({ ok: false, error: "1:1 신청서를 불러오지 못했습니다." }, { status: 500 });
  }
  if (!cardRes.data) {
    return NextResponse.json({ ok: false, error: "해당 회원의 1:1 신청서를 찾지 못했습니다." }, { status: 404 });
  }

  const name = text(body.name, 30);
  const sex = text(body.sex, 10);
  const birthYear = nullableInt(body.birth_year, 1960, new Date().getFullYear() - 19);
  const heightCm = nullableInt(body.height_cm, 120, 230);
  const job = text(body.job, 80);
  const region = text(body.region, 80);
  const phone = text(body.phone, 15);
  const introText = text(body.intro_text, 2000);
  const strengthsText = text(body.strengths_text, 1000);
  const preferredPartnerText = text(body.preferred_partner_text, 1000);
  const smoking = text(body.smoking, 30);
  const workoutFrequency = text(body.workout_frequency, 30);
  const status = text(body.status, 30);

  if (!name || !job || !region || !phone || !introText || !strengthsText || !preferredPartnerText) {
    return NextResponse.json({ ok: false, error: "필수 입력 내용을 모두 확인해 주세요." }, { status: 400 });
  }
  if (phone.length < 9) {
    return NextResponse.json({ ok: false, error: "연락처를 확인해 주세요." }, { status: 400 });
  }
  if (!SEX_VALUES.has(sex) || !CARD_STATUSES.has(status)) {
    return NextResponse.json({ ok: false, error: "성별 또는 상태 값이 올바르지 않습니다." }, { status: 400 });
  }
  if (birthYear == null || heightCm == null) {
    return NextResponse.json({ ok: false, error: "출생연도 또는 키를 확인해 주세요." }, { status: 400 });
  }
  if (!SMOKING_VALUES.has(smoking) || !WORKOUT_VALUES.has(workoutFrequency)) {
    return NextResponse.json({ ok: false, error: "흡연 또는 운동 빈도를 확인해 주세요." }, { status: 400 });
  }

  const payload = {
    name,
    sex,
    birth_year: birthYear,
    height_cm: heightCm,
    job,
    region,
    phone,
    intro_text: introText,
    strengths_text: strengthsText,
    preferred_partner_text: preferredPartnerText,
    smoking,
    workout_frequency: workoutFrequency,
    status,
    updated_at: new Date().toISOString(),
  };

  const updateRes = await guard.admin
    .from("dating_1on1_cards")
    .update(payload)
    .eq("id", cardId)
    .eq("user_id", expectedUserId)
    .select(
      "id,user_id,sex,name,birth_year,height_cm,job,region,phone,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,photo_paths,admin_note,admin_tags,reviewed_at,created_at,updated_at"
    )
    .maybeSingle();
  if (updateRes.error) {
    console.error("[PATCH /api/admin/dating/1on1/cards/[id]] failed", updateRes.error);
    return NextResponse.json({ ok: false, error: "1:1 신청서 수정에 실패했습니다." }, { status: 500 });
  }
  if (!updateRes.data) {
    return NextResponse.json({ ok: false, error: "수정할 신청서를 찾지 못했습니다." }, { status: 404 });
  }

  await recordAdminAuditEvent({
    admin: guard.admin,
    adminUser: guard.user,
    request: req,
    action: "dating_1on1_card_update_from_user_management",
    targetType: "dating_1on1_card",
    targetId: cardId,
    metadata: {
      owner_user_id: expectedUserId,
      previous_status: cardRes.data.status,
      next_status: status,
    },
  });

  return NextResponse.json({ ok: true, item: updateRes.data });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const cardId = id.trim();
  const expectedUserId = text(new URL(req.url).searchParams.get("userId"), 100);
  if (!cardId || !expectedUserId) {
    return NextResponse.json({ ok: false, error: "회원과 카드 정보를 확인해 주세요." }, { status: 400 });
  }

  const cardRes = await guard.admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,name")
    .eq("id", cardId)
    .eq("user_id", expectedUserId)
    .maybeSingle();
  if (cardRes.error) {
    return NextResponse.json({ ok: false, error: "1:1 신청서를 불러오지 못했습니다." }, { status: 500 });
  }
  if (!cardRes.data) {
    return NextResponse.json({ ok: false, error: "해당 회원의 1:1 신청서를 찾지 못했습니다." }, { status: 404 });
  }

  const deleteRes = await guard.admin
    .from("dating_1on1_cards")
    .delete()
    .eq("id", cardId)
    .eq("user_id", expectedUserId);
  if (deleteRes.error) {
    console.error("[DELETE /api/admin/dating/1on1/cards/[id]] failed", deleteRes.error);
    return NextResponse.json({ ok: false, error: "1:1 신청서 삭제에 실패했습니다." }, { status: 500 });
  }

  await recordAdminAuditEvent({
    admin: guard.admin,
    adminUser: guard.user,
    request: req,
    action: "dating_1on1_card_delete_from_user_management",
    targetType: "dating_1on1_card",
    targetId: cardId,
    metadata: {
      owner_user_id: expectedUserId,
      status: cardRes.data.status,
      name: cardRes.data.name,
    },
  });

  return NextResponse.json({ ok: true, deleted: true, id: cardId });
}

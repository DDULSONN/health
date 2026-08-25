import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import { normalizeDatingContactPhone } from "@/lib/dating-contact-blocks";
import { NextResponse } from "next/server";

const CARD_STATUSES = new Set(["submitted", "reviewing", "approved", "rejected"]);
const SEX_VALUES = new Set(["male", "female"]);
const SMOKING_VALUES = new Set(["non_smoker", "occasional", "smoker"]);
const WORKOUT_VALUES = new Set(["none", "1_2", "3_4", "5_plus"]);
const ONE_ON_ONE_EDIT_LOCK_TAG = "one_on_one_edit_locked";
const ONE_ON_ONE_USER_EDIT_USED_TAG = "one_on_one_user_edit_used";
const ONE_ON_ONE_USER_DELETED_TAG = "one_on_one_user_deleted";

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function nullableInt(value: unknown, min: number, max: number) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}

function normalizeAdminTags(value: unknown) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((item) => String(item ?? "").trim())
            .filter((item) => item.length > 0)
        )
      ).slice(0, 20)
    : [];
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
    .select("id,user_id,status,admin_tags,phone")
    .eq("id", cardId)
    .eq("user_id", expectedUserId)
    .maybeSingle();
  if (cardRes.error) {
    return NextResponse.json({ ok: false, error: "1:1 신청서를 불러오지 못했습니다." }, { status: 500 });
  }
  if (!cardRes.data) {
    return NextResponse.json({ ok: false, error: "해당 회원의 1:1 신청서를 찾지 못했습니다." }, { status: 404 });
  }

  if (body.action === "grant_user_edit") {
    const currentTags = normalizeAdminTags(cardRes.data.admin_tags);
    const isUserArchived =
      cardRes.data.status === "rejected" && currentTags.includes(ONE_ON_ONE_USER_DELETED_TAG);
    if (cardRes.data.status !== "submitted" && !isUserArchived) {
      return NextResponse.json(
        { ok: false, error: "접수 중이거나 회원이 직접 내린 1:1 신청서만 수정 기회를 열 수 있습니다." },
        { status: 409 }
      );
    }

    if (currentTags.includes(ONE_ON_ONE_EDIT_LOCK_TAG)) {
      return NextResponse.json(
        { ok: false, error: "관리자 검수에서 수정 잠금된 신청서입니다. 먼저 수정 잠금을 해제해주세요." },
        { status: 409 }
      );
    }
    if (!currentTags.includes(ONE_ON_ONE_USER_EDIT_USED_TAG)) {
      return NextResponse.json(
        { ok: false, error: "이 신청서는 이미 회원이 수정할 수 있는 상태입니다." },
        { status: 409 }
      );
    }

    const nextTags = currentTags.filter((tag) => tag !== ONE_ON_ONE_USER_EDIT_USED_TAG);
    const updateRes = await guard.admin
      .from("dating_1on1_cards")
      .update({
        admin_tags: nextTags,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cardId)
      .eq("user_id", expectedUserId)
      .eq("status", cardRes.data.status)
      .contains("admin_tags", [ONE_ON_ONE_USER_EDIT_USED_TAG])
      .select("id,user_id,status,admin_tags,updated_at")
      .maybeSingle();

    if (updateRes.error) {
      console.error("[PATCH /api/admin/dating/1on1/cards/[id]] grant user edit failed", updateRes.error);
      return NextResponse.json({ ok: false, error: "1:1 신청서 수정 기회를 열지 못했습니다." }, { status: 500 });
    }
    if (!updateRes.data) {
      return NextResponse.json(
        { ok: false, error: "신청서 상태가 변경되었습니다. 회원 정보를 다시 조회해주세요." },
        { status: 409 }
      );
    }

    await recordAdminAuditEvent({
      admin: guard.admin,
      adminUser: guard.user,
      request: req,
      action: "dating_1on1_user_edit_granted",
      targetType: "dating_1on1_card",
      targetId: cardId,
      metadata: {
        owner_user_id: expectedUserId,
        previous_tags: currentTags,
        next_tags: nextTags,
      },
    });

    return NextResponse.json({ ok: true, item: updateRes.data, edit_granted: true });
  }

  const name = text(body.name, 30);
  const sex = text(body.sex, 10);
  const birthYear = nullableInt(body.birth_year, 1960, new Date().getFullYear() - 19);
  const heightCm = nullableInt(body.height_cm, 120, 230);
  const job = text(body.job, 80);
  const region = text(body.region, 80);
  const introText = text(body.intro_text, 2000);
  const strengthsText = text(body.strengths_text, 1000);
  const preferredPartnerText = text(body.preferred_partner_text, 1000);
  const smoking = text(body.smoking, 30);
  const workoutFrequency = text(body.workout_frequency, 30);
  const status = text(body.status, 30);

  if (!name || !job || !region || !introText || !strengthsText || !preferredPartnerText) {
    return NextResponse.json({ ok: false, error: "필수 입력 내용을 모두 확인해 주세요." }, { status: 400 });
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

  const profilePhoneRes = await guard.admin
    .from("profiles")
    .select("phone_verified,phone_e164")
    .eq("user_id", expectedUserId)
    .maybeSingle();
  if (profilePhoneRes.error) {
    console.error("[PATCH /api/admin/dating/1on1/cards/[id]] profile phone lookup failed", profilePhoneRes.error);
    return NextResponse.json({ ok: false, error: "회원의 인증 연락처를 확인하지 못했습니다." }, { status: 500 });
  }
  const verifiedProfilePhone =
    profilePhoneRes.data?.phone_verified === true
      ? normalizeDatingContactPhone(String(profilePhoneRes.data.phone_e164 ?? ""))
      : "";
  const currentCardPhone = normalizeDatingContactPhone(String(cardRes.data.phone ?? ""));
  const phone = verifiedProfilePhone || currentCardPhone;
  if (!phone) {
    return NextResponse.json(
      { ok: false, error: "정상적인 인증 연락처가 없어 1:1 신청서를 수정할 수 없습니다. 먼저 휴대폰 인증 상태를 확인해주세요." },
      { status: 409 }
    );
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
      phone_repaired_from_verified_profile: Boolean(verifiedProfilePhone && verifiedProfilePhone !== cardRes.data.phone),
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

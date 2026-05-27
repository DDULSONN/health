import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import { getPhoneValidationMessage, hashForOperationalLog, normalizePhoneToE164 } from "@/lib/phone-verification";

const ATTEMPT_LOG_TABLE = "profile_phone_verification_attempts";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    identifier?: string;
    phone?: string;
  };

  const identifier = body.identifier?.trim() ?? "";
  const phoneE164 = normalizePhoneToE164(body.phone ?? "");

  if (!identifier) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "phone_verification_manual",
      targetType: "profile",
      requestId,
      status: "failure",
      metadata: { reason: "missing_identifier" },
    });
    return NextResponse.json({ error: "닉네임 또는 사용자 ID를 입력해주세요." }, { status: 400 });
  }

  const validationMessage = getPhoneValidationMessage(phoneE164);
  if (validationMessage) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "phone_verification_manual",
      targetType: "profile",
      targetId: identifier,
      requestId,
      status: "failure",
      metadata: { reason: "invalid_phone", phone_hash: hashForOperationalLog(phoneE164) },
    });
    return NextResponse.json({ error: validationMessage }, { status: 400 });
  }

  const profileRes = isUuid(identifier)
    ? await auth.admin.from("profiles").select("user_id,nickname").eq("user_id", identifier).maybeSingle()
    : await auth.admin.from("profiles").select("user_id,nickname").ilike("nickname", identifier).maybeSingle();

  if (profileRes.error) {
    return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  }

  const profile = profileRes.data;
  if (!profile) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "phone_verification_manual",
      targetType: "profile",
      targetId: identifier,
      requestId,
      status: "failure",
      metadata: { reason: "profile_not_found", phone_hash: hashForOperationalLog(phoneE164) },
    });
    return NextResponse.json({ error: "해당 닉네임 또는 사용자 계정을 찾지 못했습니다." }, { status: 404 });
  }

  const userId = profile.user_id;
  const userRes = await auth.admin.auth.admin.getUserById(userId).catch(() => null);
  if (!userRes?.data?.user) {
    return NextResponse.json({ error: "대상 사용자 계정을 찾지 못했습니다." }, { status: 404 });
  }

  const phoneVerifiedAt = new Date().toISOString();
  const { error: updateError } = await auth.admin
    .from("profiles")
    .update({
      phone_verified: true,
      phone_e164: phoneE164,
      phone_verified_at: phoneVerifiedAt,
    })
    .eq("user_id", userId);

  if (updateError) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "phone_verification_manual",
      targetType: "profile",
      targetId: userId,
      requestId,
      status: "failure",
      metadata: { reason: "update_failed", phone_hash: hashForOperationalLog(phoneE164), message: updateError.message },
    });
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await auth.admin
    .from(ATTEMPT_LOG_TABLE)
    .insert({
      user_id: userId,
      phone_e164: phoneE164,
      phone_hash: hashForOperationalLog(phoneE164),
      action: "manual",
      status: "success",
      provider: "admin_manual",
      provider_error: null,
      request_id: null,
      ip_hash: null,
      meta: {
        admin_user_id: auth.user.id,
        identifier,
      },
    })
    .then((res) => {
      if (res.error && res.error.code !== "42P01") {
        console.warn("[admin-phone-verification] failed_to_insert_attempt_log", res.error.message);
      }
    });

  await recordAdminAuditEvent({
    admin: auth.admin,
    adminUser: auth.user,
    request,
    action: "phone_verification_manual",
    targetType: "profile",
    targetId: userId,
    requestId,
    metadata: { identifier, phone_hash: hashForOperationalLog(phoneE164) },
  });

  return NextResponse.json({
    ok: true,
    user_id: userId,
    nickname: profile.nickname ?? null,
    phone_e164: phoneE164,
    phone_verified: true,
    phone_verified_at: phoneVerifiedAt,
  });
}

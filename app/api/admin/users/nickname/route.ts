import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import { normalizeNickname, validateNickname } from "@/lib/nickname";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isDuplicateNicknameError(error: { code?: string; message?: string } | null | undefined) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return code === "23505" || message.includes("duplicate") || message.includes("unique");
}

async function findAuthUserIdByEmail(auth: Awaited<ReturnType<typeof requireAdminRoute>>, email: string) {
  if (!auth.ok) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await auth.admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => (user.email ?? "").toLowerCase() === normalized);
    if (found?.id) return found.id;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function findAuthUserIdById(auth: Awaited<ReturnType<typeof requireAdminRoute>>, userId: string) {
  if (!auth.ok) return null;
  const trimmed = userId.trim();
  if (!trimmed || trimmed.length < 8) return null;
  const res = await auth.admin.auth.admin.getUserById(trimmed).catch(() => null);
  return res?.data?.user?.id ?? null;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    identifier?: string;
    nickname?: string;
  };

  const identifier = String(body.identifier ?? "").trim();
  const nickname = normalizeNickname(String(body.nickname ?? ""));
  const validationMessage = validateNickname(nickname);

  if (!identifier) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "user_nickname_admin_update",
      targetType: "profile",
      requestId,
      status: "failure",
      metadata: { reason: "missing_identifier" },
    });
    return NextResponse.json({ error: "닉네임, 이메일 또는 사용자 ID를 입력해주세요." }, { status: 400 });
  }

  if (validationMessage) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "user_nickname_admin_update",
      targetType: "profile",
      targetId: identifier,
      requestId,
      status: "failure",
      metadata: { reason: "invalid_nickname", nickname },
    });
    return NextResponse.json({ error: validationMessage }, { status: 400 });
  }

  let lookupUserId = isUuid(identifier) ? identifier : "";
  if (!lookupUserId && !identifier.includes("@")) {
    lookupUserId = (await findAuthUserIdById(auth, identifier)) ?? "";
  }
  if (!lookupUserId && identifier.includes("@")) {
    lookupUserId = (await findAuthUserIdByEmail(auth, identifier)) ?? "";
  }

  const profileRes = lookupUserId
    ? await auth.admin.from("profiles").select("user_id,nickname").eq("user_id", lookupUserId).maybeSingle()
    : await auth.admin.from("profiles").select("user_id,nickname").ilike("nickname", identifier).maybeSingle();

  if (profileRes.error) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "user_nickname_admin_update",
      targetType: "profile",
      targetId: identifier,
      requestId,
      status: "failure",
      metadata: { reason: "profile_lookup_failed", message: profileRes.error.message },
    });
    return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  }

  let profile = profileRes.data;
  const profileExists = Boolean(profile?.user_id);
  if (!profile?.user_id && lookupUserId) {
    const authUserRes = await auth.admin.auth.admin.getUserById(lookupUserId).catch(() => null);
    if (authUserRes?.data?.user?.id) {
      profile = {
        user_id: lookupUserId,
        nickname: null,
      };
    }
  }

  if (!profile?.user_id) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "user_nickname_admin_update",
      targetType: "profile",
      targetId: identifier,
      requestId,
      status: "failure",
      metadata: { reason: "profile_not_found" },
    });
    return NextResponse.json({ error: "해당 회원을 찾지 못했습니다." }, { status: 404 });
  }

  const userId = String(profile.user_id);
  const currentNickname = String(profile.nickname ?? "").trim();
  if (currentNickname.toLowerCase() === nickname.toLowerCase()) {
    return NextResponse.json({
      ok: true,
      user_id: userId,
      nickname,
      previous_nickname: currentNickname || null,
      unchanged: true,
    });
  }

  const duplicateRes = await auth.admin
    .from("profiles")
    .select("user_id")
    .ilike("nickname", nickname)
    .neq("user_id", userId)
    .limit(1);

  if (duplicateRes.error) {
    return NextResponse.json({ error: duplicateRes.error.message }, { status: 500 });
  }
  if ((duplicateRes.data ?? []).length > 0) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "user_nickname_admin_update",
      targetType: "profile",
      targetId: userId,
      requestId,
      status: "failure",
      metadata: { reason: "duplicate_nickname", previous_nickname: currentNickname, nickname },
    });
    return NextResponse.json({ error: "이미 사용 중인 닉네임입니다." }, { status: 409 });
  }

  const updateResult = profileExists
    ? await auth.admin.from("profiles").update({ nickname }).eq("user_id", userId)
    : await auth.admin.from("profiles").upsert({ user_id: userId, nickname }, { onConflict: "user_id" });
  const updateError = updateResult.error;
  if (updateError) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "user_nickname_admin_update",
      targetType: "profile",
      targetId: userId,
      requestId,
      status: "failure",
      metadata: {
        reason: "update_failed",
        previous_nickname: currentNickname,
        nickname,
        message: updateError.message,
      },
    });
    return NextResponse.json(
      { error: isDuplicateNicknameError(updateError) ? "이미 사용 중인 닉네임입니다." : updateError.message },
      { status: isDuplicateNicknameError(updateError) ? 409 : 500 }
    );
  }

  const authUserRes = await auth.admin.auth.admin.getUserById(userId).catch(() => null);
  const existingMetadata =
    authUserRes?.data?.user?.user_metadata && typeof authUserRes.data.user.user_metadata === "object"
      ? authUserRes.data.user.user_metadata
      : {};
  await auth.admin.auth.admin
    .updateUserById(userId, {
      user_metadata: {
        ...existingMetadata,
        nickname,
        name: nickname,
      },
    })
    .catch((error) => {
      console.warn("[admin-users-nickname] auth metadata update failed", error);
    });

  await recordAdminAuditEvent({
    admin: auth.admin,
    adminUser: auth.user,
    request,
    action: "user_nickname_admin_update",
    targetType: "profile",
    targetId: userId,
    requestId,
    metadata: { identifier, previous_nickname: currentNickname, nickname },
  });

  return NextResponse.json({
    ok: true,
    user_id: userId,
    nickname,
    previous_nickname: currentNickname || null,
  });
}

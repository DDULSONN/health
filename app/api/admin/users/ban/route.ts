import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";

function normalizeReason(value: unknown) {
  const reason = typeof value === "string" ? value.trim().replace(/\s{2,}/g, " ").slice(0, 300) : "";
  return reason || "관리자에 의해 이용이 제한되었습니다.";
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    userId?: unknown;
    banned?: unknown;
    reason?: unknown;
  };
  const userId = String(body.userId ?? "").trim();
  const banned = body.banned === true;
  const reason = normalizeReason(body.reason);

  if (!userId) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "user_ban_update",
      targetType: "profile",
      requestId,
      status: "failure",
      metadata: { reason: "missing_user_id", banned },
    });
    return NextResponse.json({ error: "사용자 ID가 필요합니다." }, { status: 400 });
  }

  const profileRes = await auth.admin
    .from("profiles")
    .select("user_id,nickname,role,is_banned,banned_reason")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileRes.error) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "user_ban_update",
      targetType: "profile",
      targetId: userId,
      requestId,
      status: "failure",
      metadata: { reason: "profile_lookup_failed", message: profileRes.error.message, banned },
    });
    return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  }

  if (!profileRes.data?.user_id) {
    return NextResponse.json({ error: "해당 회원을 찾지 못했습니다." }, { status: 404 });
  }

  const targetAuthUser = await auth.admin.auth.admin.getUserById(userId).catch(() => null);
  if (banned && (userId === auth.user.id || profileRes.data.role === "admin" || isAllowedAdminUser(userId, targetAuthUser?.data?.user?.email))) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "user_ban_update",
      targetType: "profile",
      targetId: userId,
      requestId,
      status: "failure",
      metadata: { reason: "admin_target_blocked", banned },
    });
    return NextResponse.json({ error: "관리자 계정은 벤 처리할 수 없습니다." }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const profileUpdate = banned
    ? {
        is_banned: true,
        banned_reason: reason,
        banned_at: nowIso,
      }
    : {
        is_banned: false,
        banned_reason: null,
        banned_at: null,
      };

  const updateRes = await auth.admin
    .from("profiles")
    .update(profileUpdate)
    .eq("user_id", userId)
    .select("user_id,nickname,role,is_banned,banned_reason,banned_at")
    .maybeSingle();

  if (updateRes.error) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "user_ban_update",
      targetType: "profile",
      targetId: userId,
      requestId,
      status: "failure",
      metadata: { reason: "profile_update_failed", message: updateRes.error.message, banned },
    });
    return NextResponse.json({ error: "벤 상태 저장에 실패했습니다." }, { status: 500 });
  }

  let hiddenOpenCards = 0;
  let hiddenPaidCards = 0;
  if (banned) {
    const [openCardsRes, paidCardsRes] = await Promise.all([
      auth.admin
        .from("dating_cards")
        .update({ status: "hidden", expires_at: nowIso })
        .eq("owner_user_id", userId)
        .in("status", ["pending", "public"])
        .select("id"),
      auth.admin
        .from("dating_paid_cards")
        .update({ status: "expired", expires_at: nowIso })
        .eq("user_id", userId)
        .in("status", ["pending", "approved"])
        .select("id"),
    ]);

    if (openCardsRes.error || paidCardsRes.error) {
      console.error("[POST /api/admin/users/ban] hide visible cards failed", openCardsRes.error ?? paidCardsRes.error);
    }
    hiddenOpenCards = openCardsRes.data?.length ?? 0;
    hiddenPaidCards = paidCardsRes.data?.length ?? 0;
  }

  await recordAdminAuditEvent({
    admin: auth.admin,
    adminUser: auth.user,
    request,
    action: "user_ban_update",
    targetType: "profile",
    targetId: userId,
    requestId,
    metadata: {
      banned,
      reason: banned ? reason : null,
      previous_banned: profileRes.data.is_banned === true,
      previous_reason: profileRes.data.banned_reason ?? null,
      hidden_open_cards: hiddenOpenCards,
      hidden_paid_cards: hiddenPaidCards,
    },
  });

  return NextResponse.json({
    ok: true,
    user_id: userId,
    profile: updateRes.data,
    hiddenOpenCards,
    hiddenPaidCards,
  });
}

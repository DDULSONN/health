import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import { getActiveOneOnOnePlus } from "@/lib/dating-1on1-plus";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    userId?: unknown;
    expectedExpiresAt?: unknown;
  };
  const userId = String(body.userId ?? "").trim();
  const expectedExpiresAt = String(body.expectedExpiresAt ?? "").trim();
  if (!userId || !expectedExpiresAt || !Number.isFinite(new Date(expectedExpiresAt).getTime())) {
    return NextResponse.json(
      { error: "회원과 현재 1:1 매칭 플러스 만료 정보가 필요합니다." },
      { status: 400 }
    );
  }

  let subscription;
  try {
    subscription = await getActiveOneOnOnePlus(auth.admin, userId);
  } catch (error) {
    console.error("[POST /api/admin/dating/1on1/priority-boost/revoke] lookup failed", error);
    return NextResponse.json({ error: "1:1 매칭 플러스 상태를 확인하지 못했습니다." }, { status: 500 });
  }
  if (!subscription) {
    return NextResponse.json({ error: "현재 이용 중인 1:1 매칭 플러스가 없습니다." }, { status: 409 });
  }

  const actualExpiresAt = new Date(subscription.expires_at).toISOString();
  const normalizedExpectedExpiresAt = new Date(expectedExpiresAt).toISOString();
  if (actualExpiresAt !== normalizedExpectedExpiresAt) {
    return NextResponse.json(
      { error: "플러스 이용 기간이 방금 변경되었습니다. 회원을 다시 조회한 뒤 확인해 주세요." },
      { status: 409 }
    );
  }

  const deleteRes = await auth.admin
    .from("dating_1on1_plus_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("expires_at", subscription.expires_at)
    .select("user_id")
    .maybeSingle();
  if (deleteRes.error) {
    console.error("[POST /api/admin/dating/1on1/priority-boost/revoke] delete failed", deleteRes.error);
    return NextResponse.json({ error: "1:1 매칭 플러스 이용권을 회수하지 못했습니다." }, { status: 500 });
  }
  if (!deleteRes.data) {
    return NextResponse.json(
      { error: "플러스 이용 기간이 방금 변경되었습니다. 회원을 다시 조회한 뒤 확인해 주세요." },
      { status: 409 }
    );
  }

  const revokedAt = new Date().toISOString();
  await recordAdminAuditEvent({
    admin: auth.admin,
    adminUser: auth.user,
    request,
    action: "one_on_one_plus_admin_revoke",
    targetType: "user",
    targetId: userId,
    requestId,
    metadata: {
      starts_at: subscription.starts_at,
      previous_expires_at: subscription.expires_at,
      contact_exchange_included: subscription.contact_exchange_included,
      revoked_at: revokedAt,
    },
  });

  return NextResponse.json({
    ok: true,
    userId,
    previousExpiresAt: subscription.expires_at,
    revokedAt,
  });
}

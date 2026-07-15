import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import { ONE_ON_ONE_PLUS_DURATION_DAYS, grantOneOnOnePlus } from "@/lib/dating-1on1-plus";

const ACTIVE_ONE_ON_ONE_STATUSES = ["submitted", "reviewing", "approved"];

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { userId?: unknown; cardId?: unknown };
  const requestedUserId = String(body.userId ?? "").trim();
  const cardId = String(body.cardId ?? "").trim();
  if (!requestedUserId && !cardId) {
    return NextResponse.json({ error: "사용자 ID 또는 1:1 카드 ID가 필요합니다." }, { status: 400 });
  }

  let query = auth.admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,name,created_at")
    .in("status", ACTIVE_ONE_ON_ONE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);
  query = cardId ? query.eq("id", cardId) : query.eq("user_id", requestedUserId);
  const cardRes = await query.maybeSingle();
  if (cardRes.error) {
    console.error("[POST /api/admin/dating/1on1/priority-boost/grant] card lookup failed", cardRes.error);
    return NextResponse.json({ error: "1:1 신청 정보를 찾지 못했습니다." }, { status: 500 });
  }
  if (!cardRes.data?.id) {
    return NextResponse.json({ error: "플러스를 지급할 활성 1:1 신청서가 없습니다." }, { status: 404 });
  }
  if (requestedUserId && cardRes.data.user_id !== requestedUserId) {
    return NextResponse.json({ error: "회원과 1:1 신청 정보가 일치하지 않습니다." }, { status: 400 });
  }

  let subscription;
  try {
    subscription = await grantOneOnOnePlus(auth.admin, {
      userId: cardRes.data.user_id,
      grantKey: `admin:${requestId}`,
      durationDays: ONE_ON_ONE_PLUS_DURATION_DAYS,
    });
  } catch (error) {
    console.error("[POST /api/admin/dating/1on1/priority-boost/grant] grant failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "1:1 매칭 플러스 지급에 실패했습니다." },
      { status: 500 }
    );
  }

  await recordAdminAuditEvent({
    admin: auth.admin,
    adminUser: auth.user,
    request,
    action: "one_on_one_plus_admin_grant",
    targetType: "user",
    targetId: cardRes.data.user_id,
    requestId,
    metadata: {
      card_id: cardRes.data.id,
      duration_days: ONE_ON_ONE_PLUS_DURATION_DAYS,
      expires_at: subscription.expires_at,
    },
  });

  return NextResponse.json({
    ok: true,
    card: { ...cardRes.data, plus_expires_at: subscription.expires_at },
    durationDays: ONE_ON_ONE_PLUS_DURATION_DAYS,
    expiresAt: subscription.expires_at,
  });
}

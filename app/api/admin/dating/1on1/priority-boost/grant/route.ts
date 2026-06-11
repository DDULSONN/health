import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";

const ACTIVE_ONE_ON_ONE_STATUSES = ["submitted", "reviewing", "approved"];
const DEFAULT_DURATION_DAYS = 3;

function normalizeDurationDays(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : DEFAULT_DURATION_DAYS;
  if (!Number.isFinite(parsed)) return DEFAULT_DURATION_DAYS;
  return Math.min(30, Math.max(1, Math.round(parsed)));
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    userId?: unknown;
    cardId?: unknown;
    durationDays?: unknown;
  };
  const userId = String(body.userId ?? "").trim();
  const cardId = String(body.cardId ?? "").trim();
  const durationDays = normalizeDurationDays(body.durationDays);

  if (!userId && !cardId) {
    return NextResponse.json({ error: "사용자 ID 또는 1:1 카드 ID가 필요합니다." }, { status: 400 });
  }

  const cardQuery = auth.admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,name,priority_boost_expires_at,created_at")
    .in("status", ACTIVE_ONE_ON_ONE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);

  const cardRes = cardId ? await cardQuery.eq("id", cardId).maybeSingle() : await cardQuery.eq("user_id", userId).maybeSingle();

  if (cardRes.error) {
    const message = String(cardRes.error.message ?? "");
    if (message.includes("priority_boost_expires_at")) {
      return NextResponse.json(
        { error: "1:1 우선 추천권 SQL이 아직 적용되지 않았습니다. dating_1on1_priority_boost.sql을 적용해주세요." },
        { status: 500 }
      );
    }
    console.error("[POST /api/admin/dating/1on1/priority-boost/grant] card lookup failed", cardRes.error);
    return NextResponse.json({ error: "1:1 신청 정보를 찾지 못했습니다." }, { status: 500 });
  }

  if (!cardRes.data?.id) {
    return NextResponse.json({ error: "우선 추천권을 지급할 활성 1:1 신청이 없습니다." }, { status: 404 });
  }

  if (userId && cardRes.data.user_id !== userId) {
    return NextResponse.json({ error: "회원과 1:1 신청 정보가 일치하지 않습니다." }, { status: 400 });
  }

  const now = Date.now();
  const currentExpiresAt = cardRes.data.priority_boost_expires_at
    ? new Date(cardRes.data.priority_boost_expires_at).getTime()
    : Number.NaN;
  const baseMs = Number.isFinite(currentExpiresAt) && currentExpiresAt > now ? currentExpiresAt : now;
  const expiresAt = new Date(baseMs + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const updateRes = await auth.admin
    .from("dating_1on1_cards")
    .update({ priority_boost_expires_at: expiresAt })
    .eq("id", cardRes.data.id)
    .eq("user_id", cardRes.data.user_id)
    .in("status", ACTIVE_ONE_ON_ONE_STATUSES)
    .select("id,user_id,status,name,priority_boost_expires_at")
    .maybeSingle();

  if (updateRes.error || !updateRes.data?.id) {
    console.error("[POST /api/admin/dating/1on1/priority-boost/grant] update failed", updateRes.error);
    return NextResponse.json({ error: "1:1 우선 추천권 지급에 실패했습니다." }, { status: 500 });
  }

  await recordAdminAuditEvent({
    admin: auth.admin,
    adminUser: auth.user,
    request,
    action: "one_on_one_priority_boost_admin_grant",
    targetType: "dating_1on1_card",
    targetId: updateRes.data.id,
    requestId,
    metadata: {
      user_id: updateRes.data.user_id,
      duration_days: durationDays,
      previous_expires_at: cardRes.data.priority_boost_expires_at ?? null,
      expires_at: updateRes.data.priority_boost_expires_at,
    },
  });

  return NextResponse.json({
    ok: true,
    card: updateRes.data,
    durationDays,
    expiresAt: updateRes.data.priority_boost_expires_at,
  });
}

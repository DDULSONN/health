import { isAllowedAdminUser } from "@/lib/admin";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { isReportUuid } from "@/lib/dating-report-safety";
import { requireAdminRoute } from "@/lib/admin-route";
import { NextResponse } from "next/server";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const originError = ensureAllowedMutationOrigin(request);
  if (originError) return originError;
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const reportId = String(id ?? "").trim();
  if (!isReportUuid(reportId)) {
    return NextResponse.json({ error: "신고 ID가 필요합니다." }, { status: 400 });
  }

  const reportRes = await auth.admin
    .from("dating_card_reports")
    .select("id, card_id, reason, status")
    .eq("id", reportId)
    .maybeSingle();

  if (reportRes.error) {
    console.error("[POST /api/admin/dating/reports/[id]/ban] report fetch failed", reportRes.error);
    return NextResponse.json({ error: "신고 정보를 찾지 못했습니다." }, { status: 500 });
  }
  if (!reportRes.data) {
    return NextResponse.json({ error: "신고가 존재하지 않습니다." }, { status: 404 });
  }

  const cardRes = await auth.admin
    .from("dating_cards")
    .select("id, owner_user_id")
    .eq("id", reportRes.data.card_id)
    .maybeSingle();

  if (cardRes.error) {
    console.error("[POST /api/admin/dating/reports/[id]/ban] card fetch failed", cardRes.error);
    return NextResponse.json({ error: "카드 정보를 찾지 못했습니다." }, { status: 500 });
  }
  if (!cardRes.data?.owner_user_id) {
    return NextResponse.json({ error: "카드 주인을 찾지 못했습니다." }, { status: 404 });
  }

  const ownerUserId = String(cardRes.data.owner_user_id);
  const targetUser = await auth.admin.auth.admin.getUserById(ownerUserId);
  if (targetUser.error) return NextResponse.json({ error: "대상 계정을 확인하지 못했습니다." }, { status: 500 });
  if (ownerUserId === auth.user.id || isAllowedAdminUser(ownerUserId, targetUser.data.user?.email)) {
    return NextResponse.json({ error: "관리자 계정은 정지할 수 없습니다." }, { status: 400 });
  }
  const bannedReason = `오픈카드 신고 접수 후 운영자 제재: ${String(reportRes.data.reason ?? "").trim() || "운영 정책 위반"}`;
  const nowIso = new Date().toISOString();

  const banProfileRes = await auth.admin
      .from("profiles")
      .update({
        is_banned: true,
        banned_reason: bannedReason,
        banned_at: nowIso,
      })
      .eq("user_id", ownerUserId).select("user_id").maybeSingle();
  if (banProfileRes.error || !banProfileRes.data) {
    return NextResponse.json({ error: "계정 정지에 실패했습니다. 신고는 미처리 상태로 유지됩니다." }, { status: 500 });
  }
  const hideCardsRes = await auth.admin
      .from("dating_cards")
      .update({
        status: "hidden",
        expires_at: nowIso,
      })
      .eq("owner_user_id", ownerUserId)
      .in("status", ["public", "pending"]);
  if (hideCardsRes.error) {
    return NextResponse.json({ error: "계정은 정지됐지만 카드 숨김에 실패했습니다. 신고는 미처리 상태로 유지됩니다." }, { status: 500 });
  }
  const resolveReportsRes = await auth.admin
      .from("dating_card_reports")
      .update({ status: "resolved" })
      .eq("card_id", cardRes.data.id)
      .eq("status", "open");

  if (resolveReportsRes.error) {
    console.error("[POST /api/admin/dating/reports/[id]/ban] resolve reports failed", resolveReportsRes.error);
    return NextResponse.json({ error: "계정은 밴됐지만 신고 정리 처리에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    banned_user_id: ownerUserId,
    banned_reason: bannedReason,
  });
}

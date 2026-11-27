import { isAllowedAdminUser } from "@/lib/admin";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { isReportUuid } from "@/lib/dating-report-safety";
import { requireAdminRoute } from "@/lib/admin-route";
import { hideBannedMemberDatingCards } from "@/lib/admin-ban-visibility";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
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
  if (reportRes.data.status !== "open") {
    return NextResponse.json({ error: "이미 처리된 신고입니다. 목록을 다시 확인해 주세요." }, { status: 409 });
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
  const [targetUser, profile] = await Promise.all([
    auth.admin.auth.admin.getUserById(ownerUserId),
    auth.admin.from("profiles").select("role").eq("user_id", ownerUserId).maybeSingle(),
  ]);
  if (targetUser.error || profile.error || !profile.data) return NextResponse.json({ error: "대상 계정을 확인하지 못했습니다." }, { status: 500 });
  if (ownerUserId === auth.user.id || profile.data.role === "admin" || isAllowedAdminUser(ownerUserId, targetUser.data.user?.email)) {
    return NextResponse.json({ error: "관리자 계정은 정지할 수 없습니다." }, { status: 400 });
  }
  const bannedReason = `오픈카드 신고 접수 후 운영자 제재: ${String(reportRes.data.reason ?? "").trim() || "운영 정책 위반"}`.slice(0, 300);
  const nowIso = new Date().toISOString();

  const banProfileRes = await auth.admin
      .from("profiles")
      .update({
        is_banned: true,
        banned_reason: bannedReason,
        banned_at: nowIso,
        swipe_profile_visible: false,
      })
      .eq("user_id", ownerUserId).select("user_id").maybeSingle();
  if (banProfileRes.error || !banProfileRes.data) {
    return NextResponse.json({ error: "계정 정지에 실패했습니다. 신고는 미처리 상태로 유지됩니다." }, { status: 500 });
  }
  const cleanup = await hideBannedMemberDatingCards(auth.admin, ownerUserId, nowIso);
  if (cleanup.cardCleanupFailed) {
    await recordAdminAuditEvent({ admin: auth.admin, adminUser: auth.user, request,
      action: "user_ban_from_dating_report", targetType: "profile", targetId: ownerUserId,
      status: "failure", metadata: { reportId, ...cleanup } });
    return NextResponse.json({ error: "계정은 정지됐지만 일부 카드 숨김을 확인하지 못했습니다. 신고는 미처리 상태로 유지됩니다." }, { status: 500 });
  }
  const resolveReportsRes = await auth.admin
      .from("dating_card_reports")
      .update({ status: "resolved" })
      .eq("card_id", cardRes.data.id)
      .eq("status", "open");

  if (resolveReportsRes.error) {
    console.error("[POST /api/admin/dating/reports/[id]/ban] resolve reports failed", resolveReportsRes.error);
    await recordAdminAuditEvent({ admin: auth.admin, adminUser: auth.user, request,
      action: "user_ban_from_dating_report", targetType: "profile", targetId: ownerUserId,
      status: "failure", metadata: { reportId, resolutionFailed: true, ...cleanup } });
    return NextResponse.json({ error: "계정은 밴됐지만 신고 정리 처리에 실패했습니다." }, { status: 500 });
  }

  await recordAdminAuditEvent({ admin: auth.admin, adminUser: auth.user, request,
    action: "user_ban_from_dating_report", targetType: "profile", targetId: ownerUserId,
    metadata: { reportId, ...cleanup } });
  return NextResponse.json({
    ok: true,
    banned_user_id: ownerUserId,
    banned_reason: bannedReason,
  });
}

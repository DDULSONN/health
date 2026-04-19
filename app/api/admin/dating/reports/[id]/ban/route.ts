import { requireAdminRoute } from "@/lib/admin-route";
import { NextResponse } from "next/server";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteCtx) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const reportId = String(id ?? "").trim();
  if (!reportId) {
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
  const bannedReason = `오픈카드 신고 접수 후 운영자 제재: ${String(reportRes.data.reason ?? "").trim() || "운영 정책 위반"}`;
  const nowIso = new Date().toISOString();

  const [banProfileRes, hideCardsRes, resolveReportsRes] = await Promise.all([
    auth.admin
      .from("profiles")
      .update({
        is_banned: true,
        banned_reason: bannedReason,
        banned_at: nowIso,
      })
      .eq("user_id", ownerUserId),
    auth.admin
      .from("dating_cards")
      .update({
        status: "hidden",
        expires_at: nowIso,
      })
      .eq("owner_user_id", ownerUserId)
      .in("status", ["public", "pending"]),
    auth.admin
      .from("dating_card_reports")
      .update({ status: "resolved" })
      .eq("card_id", cardRes.data.id)
      .eq("status", "open"),
  ]);

  if (banProfileRes.error) {
    console.error("[POST /api/admin/dating/reports/[id]/ban] ban failed", banProfileRes.error);
    return NextResponse.json({ error: "계정 밴 처리에 실패했습니다." }, { status: 500 });
  }
  if (hideCardsRes.error) {
    console.error("[POST /api/admin/dating/reports/[id]/ban] hide cards failed", hideCardsRes.error);
    return NextResponse.json({ error: "계정은 밴됐지만 카드 비노출 처리에 실패했습니다." }, { status: 500 });
  }
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

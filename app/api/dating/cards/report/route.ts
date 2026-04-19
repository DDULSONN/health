import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { buildDatingCardReportReasonText, isDatingCardReportReasonCode } from "@/lib/dating-report-reasons";
import { NextResponse } from "next/server";

function sanitize(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const cardId = sanitize((body as { card_id?: unknown }).card_id, 100);
  const reasonCode = sanitize((body as { reason_code?: unknown }).reason_code, 50);
  const detail = sanitize((body as { detail?: unknown }).detail, 500);
  if (!cardId || !reasonCode) {
    return NextResponse.json({ error: "card_id와 신고 사유가 필요합니다." }, { status: 400 });
  }
  if (!isDatingCardReportReasonCode(reasonCode)) {
    return NextResponse.json({ error: "허용되지 않은 신고 사유입니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: card } = await adminClient
    .from("dating_cards")
    .select("id, status, owner_user_id")
    .eq("id", cardId)
    .maybeSingle();

  if (!card || card.status !== "public") {
    return NextResponse.json({ error: "신고 가능한 카드가 아닙니다." }, { status: 404 });
  }
  if (card.owner_user_id === user.id) {
    return NextResponse.json({ error: "본인 카드는 신고할 수 없습니다." }, { status: 400 });
  }

  const { error } = await adminClient.from("dating_card_reports").upsert(
    {
      card_id: cardId,
      reporter_user_id: user.id,
      reason: buildDatingCardReportReasonText(reasonCode, detail),
    },
    { onConflict: "card_id,reporter_user_id" }
  );

  if (error) {
    console.error("[POST /api/dating/cards/report] failed", error);
    return NextResponse.json({ error: "신고 접수에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

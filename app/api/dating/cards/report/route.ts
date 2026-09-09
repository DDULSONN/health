import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { buildDatingCardReportReasonText, isDatingCardReportReasonCode } from "@/lib/dating-report-reasons";
import { applyReportBlock, reportResultMessage, isReportUuid } from "@/lib/dating-report-safety";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { hasCityViewCardAccess } from "@/lib/dating-city-view";
import { hasMoreViewAccess } from "@/lib/dating-more-view";
import { NextResponse } from "next/server";

function sanitize(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

async function submitReport(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
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
  if (!isReportUuid(cardId) || !reasonCode) {
    return NextResponse.json({ error: "card_id와 신고 사유가 필요합니다." }, { status: 400 });
  }
  if (!isDatingCardReportReasonCode(reasonCode)) {
    return NextResponse.json({ error: "허용되지 않은 신고 사유입니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select("id, status, owner_user_id, sex, region, expires_at")
    .eq("id", cardId)
    .maybeSingle();

  if (cardError) {
    console.error("[POST /api/dating/cards/report] card load failed", cardError);
    return NextResponse.json({ error: "신고 대상을 확인하지 못했습니다." }, { status: 500 });
  }
  if (!card) {
    return NextResponse.json({ error: "신고 가능한 카드가 아닙니다." }, { status: 404 });
  }
  if (card.owner_user_id === user.id) {
    return NextResponse.json({ error: "본인 카드는 신고할 수 없습니다." }, { status: 400 });
  }

  const isPublicAvailable =
    card.status === "public" &&
    typeof card.expires_at === "string" &&
    new Date(card.expires_at).getTime() > Date.now();
  let canReportPending = false;
  if (!isPublicAvailable && card.status === "pending") {
    const [byMoreView, byCityView] = await Promise.all([
      hasMoreViewAccess(adminClient, user.id, card.sex),
      hasCityViewCardAccess(adminClient, user.id, card.id, card.region ?? null),
    ]);
    canReportPending = byMoreView || byCityView;
  }

  if (!isPublicAvailable && !canReportPending) {
    return NextResponse.json({ error: "현재 열람할 수 없는 카드는 신고할 수 없습니다." }, { status: 403 });
  }

  const { error } = await adminClient.from("dating_card_reports").insert(
    {
      card_id: cardId,
      reporter_user_id: user.id,
      reason: buildDatingCardReportReasonText(reasonCode, detail),
    }
  );

  let alreadyReported = false;
  if (error?.code === "23505") {
    const existing = await adminClient.from("dating_card_reports").select("id")
      .eq("card_id", cardId).eq("reporter_user_id", user.id).maybeSingle();
    if (existing.error) throw existing.error;
    alreadyReported = Boolean(existing.data);
  }
  if (error && !alreadyReported) {
    console.error("[POST /api/dating/cards/report] failed", error);
    return NextResponse.json({ ok: false, error: "신고 접수에 실패했습니다." }, { status: 500 });
  }
  const followUp = await applyReportBlock(adminClient, user.id, card.owner_user_id);
  return NextResponse.json({
    ok: true,
    ...followUp,
    already_reported: alreadyReported,
    message: reportResultMessage(alreadyReported, followUp.blocked, followUp.pending_matches_canceled),
  }, { status: alreadyReported ? 200 : 201 });
}

export async function POST(req: Request) {
  try {
    return await submitReport(req);
  } catch (error) {
    console.error("[dating card report] request failed", error);
    return NextResponse.json({ ok: false, error: "신고 처리 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}

import {
  getDatingOneOnOneCardsByIds,
  isDatingOneOnOneLegacyPhoneShareMatch,
  type DatingOneOnOneMatchRow,
} from "@/lib/dating-1on1";
import {
  buildOneOnOneAcceptedNotification,
  buildOneOnOneSelectionReceivedNotification,
} from "@/lib/dating-email-templates";
import { recordOneOnOneMetricEvent } from "@/lib/dating-1on1-metrics";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactPhoneBlockBetween } from "@/lib/dating-contact-blocks";
import { notifyDatingUser } from "@/lib/dating-notifications";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { sendDatingEmailNotification } from "@/lib/dating-swipe";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type MatchAction =
  | "select_candidate"
  | "source_cancel"
  | "candidate_accept"
  | "candidate_reject"
  | "source_accept"
  | "source_reject"
  | "cancel_mutual";

type ActionPayload = {
  action?: MatchAction;
};

const ACTIONS = new Set<MatchAction>([
  "select_candidate",
  "source_cancel",
  "candidate_accept",
  "candidate_reject",
  "source_accept",
  "source_reject",
  "cancel_mutual",
]);
const CONTACT_EXCHANGE_CANCEL_DELAY_MS = 48 * 60 * 60 * 1000;

function canCancelApprovedContactExchange(row: DatingOneOnOneMatchRow, nowMs: number) {
  if (row.contact_exchange_status !== "approved") return true;
  const approvedMs = Date.parse(row.contact_exchange_approved_at ?? "");
  return Number.isFinite(approvedMs) && nowMs - approvedMs >= CONTACT_EXCHANGE_CANCEL_DELAY_MS;
}

async function getMatchRow(admin: ReturnType<typeof createAdminClient>, matchId: string) {
  const res = await admin
    .from("dating_1on1_match_proposals")
    .select(
      "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,contact_exchange_status,contact_exchange_requested_at,contact_exchange_paid_at,contact_exchange_paid_by_user_id,contact_exchange_approved_at,contact_exchange_approved_by_user_id,contact_exchange_note,source_phone_share_consented_at,candidate_phone_share_consented_at,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at"
    )
    .eq("id", matchId)
    .maybeSingle();

  if (res.error) {
    throw res.error;
  }
  return (res.data ?? null) as DatingOneOnOneMatchRow | null;
}

async function sendOneOnOneReminderEmail(
  admin: ReturnType<typeof createAdminClient>,
  targetUserId: string,
  buildNotification: () => { emailSubject: string; emailText: string }
) {
  const notification = buildNotification();
  await sendDatingEmailNotification(
    admin,
    targetUserId,
    notification.emailSubject,
    notification.emailText
  ).catch((error) => {
    console.error("[POST /api/dating/1on1/matches/[id]] reminder email failed", error);
    return false;
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as ActionPayload | null;
  if (!body || !body.action || !ACTIONS.has(body.action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const { id } = await params;
  const matchId = id?.trim();
  if (!matchId) {
    return NextResponse.json({ error: "Match id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  let row: DatingOneOnOneMatchRow | null;
  try {
    row = await getMatchRow(admin, matchId);
  } catch (error) {
    console.error("[POST /api/dating/1on1/matches/[id]] fetch failed", error);
    return NextResponse.json({ error: "Failed to load match." }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  if (["select_candidate", "candidate_accept", "source_accept"].includes(body.action)) {
    try {
      const [memberBlocked, phoneBlocked] = await Promise.all([
        hasDatingBlockBetween(admin, row.source_user_id, row.candidate_user_id),
        hasDatingContactPhoneBlockBetween(admin, row.source_user_id, row.candidate_user_id),
      ]);
      if (memberBlocked || phoneBlocked) {
        return NextResponse.json({ error: "차단된 상대와는 1:1 매칭을 진행할 수 없습니다." }, { status: 409 });
      }
    } catch (blockError) {
      console.error("[POST /api/dating/1on1/matches/[id]] block check failed", blockError);
      return NextResponse.json({ error: "지인 차단 설정을 확인하지 못했습니다." }, { status: 500 });
    }
  }

  if (body.action === "select_candidate") {
    if (row.source_user_id !== user.id) {
      return NextResponse.json({ error: "Only the source user can choose a candidate." }, { status: 403 });
    }
    if (row.state !== "proposed") {
      return NextResponse.json({ error: "Only proposed candidates can be selected." }, { status: 409 });
    }

    const updateRes = await admin
      .from("dating_1on1_match_proposals")
      .update({
        state: "source_selected",
        source_selected_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", matchId)
      .eq("state", "proposed")
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      console.error("[POST /api/dating/1on1/matches/[id]] select failed", updateRes.error);
      return NextResponse.json({ error: "Failed to select candidate." }, { status: 500 });
    }
    if (!updateRes.data) {
      return NextResponse.json({ error: "Candidate was already handled." }, { status: 409 });
    }

    try {
      const cards = await getDatingOneOnOneCardsByIds(admin, [row.source_card_id, row.candidate_card_id]);
      const sourceCard = cards.get(row.source_card_id);
      const candidateCard = cards.get(row.candidate_card_id);
      const notification = buildOneOnOneSelectionReceivedNotification(
        sourceCard?.name ?? "상대",
        candidateCard?.name ?? "내 카드"
      );

      await Promise.all([
        sendOneOnOneReminderEmail(admin, row.candidate_user_id, () => notification),
        notifyDatingUser(admin, {
          userId: row.candidate_user_id,
          actorId: row.source_user_id,
          type: "dating_1on1_selection_received",
          title: notification.pushTitle,
          body: notification.pushBody,
          route: "/dating/1on1",
          meta: { match_id: matchId },
        }),
      ]);
    } catch (emailError) {
      console.error("[POST /api/dating/1on1/matches/[id]] select reminder failed", emailError);
    }
  }

  if (body.action === "source_cancel") {
    if (row.source_user_id !== user.id) {
      return NextResponse.json({ error: "Only the applicant can cancel this request." }, { status: 403 });
    }
    if (row.state !== "source_selected") {
      return NextResponse.json(
        { error: "상대가 이미 응답했거나 지원 상태가 변경되었습니다. 목록을 다시 확인해주세요.", code: "MATCH_ALREADY_HANDLED" },
        { status: 409 }
      );
    }
    if (row.contact_exchange_status !== "none") {
      return NextResponse.json(
        { error: "번호 교환 절차가 시작된 지원은 이 단계에서 취소할 수 없습니다.", code: "MATCH_CANCEL_NOT_READY" },
        { status: 409 }
      );
    }

    const updateRes = await admin
      .from("dating_1on1_match_proposals")
      .update({
        state: "source_skipped",
        updated_at: nowIso,
      })
      .eq("id", matchId)
      .eq("source_user_id", user.id)
      .eq("state", "source_selected")
      .eq("contact_exchange_status", "none")
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      console.error("[POST /api/dating/1on1/matches/[id]] source cancel failed", updateRes.error);
      return NextResponse.json({ error: "1:1 지원 취소에 실패했습니다." }, { status: 500 });
    }
    if (!updateRes.data) {
      return NextResponse.json(
        { error: "상대가 이미 응답했거나 지원 상태가 변경되었습니다. 목록을 다시 확인해주세요.", code: "MATCH_ALREADY_HANDLED" },
        { status: 409 }
      );
    }

    const notificationDeleteRes = await admin
      .from("notifications")
      .delete()
      .eq("user_id", row.candidate_user_id)
      .eq("actor_id", row.source_user_id)
      .eq("meta_json->>match_id", matchId)
      .eq("meta_json->>notification_type", "dating_1on1_selection_received");
    if (notificationDeleteRes.error) {
      console.error(
        "[POST /api/dating/1on1/matches/[id]] source cancel notification cleanup failed",
        notificationDeleteRes.error
      );
    }
  }

  if (body.action === "candidate_accept") {
    if (row.candidate_user_id !== user.id) {
      return NextResponse.json({ error: "Only the candidate user can accept." }, { status: 403 });
    }
    if (row.state !== "source_selected") {
      return NextResponse.json({ error: "Only selected candidates can accept." }, { status: 409 });
    }

    const updateRes = await admin
      .from("dating_1on1_match_proposals")
      .update({
        state: "mutual_accepted",
        contact_exchange_status: "awaiting_applicant_payment",
        contact_exchange_requested_at: null,
        contact_exchange_paid_at: null,
        contact_exchange_paid_by_user_id: null,
        contact_exchange_approved_at: null,
        contact_exchange_approved_by_user_id: null,
        contact_exchange_note: null,
        source_phone_share_consented_at: null,
        candidate_phone_share_consented_at: null,
        candidate_responded_at: nowIso,
        source_final_responded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", matchId)
      .eq("state", "source_selected")
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      console.error("[POST /api/dating/1on1/matches/[id]] candidate accept failed", updateRes.error);
      return NextResponse.json({ error: "Failed to complete mutual accept." }, { status: 500 });
    }
    if (!updateRes.data) {
      return NextResponse.json({ error: "This request was already handled." }, { status: 409 });
    }
    try {
      await recordOneOnOneMetricEvent(admin, {
        eventKind: "mutual_match_created",
        matchId,
        sourceCardId: row.source_card_id,
        sourceUserId: row.source_user_id,
        occurredAt: nowIso,
      });
    } catch (metricError) {
      console.error("[POST /api/dating/1on1/matches/[id]] mutual metric event failed", metricError);
    }

    try {
      const cards = await getDatingOneOnOneCardsByIds(admin, [row.source_card_id, row.candidate_card_id]);
      const candidateCard = cards.get(row.candidate_card_id);
      const sourceCard = cards.get(row.source_card_id);
      const sourceNotification = buildOneOnOneAcceptedNotification(candidateCard?.name ?? "상대");
      const candidateNotification = buildOneOnOneAcceptedNotification(sourceCard?.name ?? "상대");

      await Promise.all([
        sendOneOnOneReminderEmail(admin, row.source_user_id, () => sourceNotification),
        notifyDatingUser(admin, {
          userId: row.source_user_id,
          actorId: row.candidate_user_id,
          type: "dating_1on1_match_accepted",
          title: sourceNotification.pushTitle,
          body: sourceNotification.pushBody,
          route: "/dating/1on1",
          meta: { match_id: matchId },
        }),
        notifyDatingUser(admin, {
          userId: row.candidate_user_id,
          actorId: row.source_user_id,
          type: "dating_1on1_match_accepted",
          title: candidateNotification.pushTitle,
          body: candidateNotification.pushBody,
          route: "/dating/1on1",
          meta: { match_id: matchId },
        }),
      ]);
    } catch (emailError) {
      console.error("[POST /api/dating/1on1/matches/[id]] accept reminder failed", emailError);
    }
  }

  if (body.action === "cancel_mutual") {
    const isParticipant = row.source_user_id === user.id || row.candidate_user_id === user.id;
    if (!isParticipant) {
      return NextResponse.json({ error: "매칭 당사자만 취소할 수 있습니다.", code: "NOT_MATCH_PARTICIPANT" }, { status: 403 });
    }
    if (!["mutual_accepted", "candidate_accepted"].includes(row.state)) {
      return NextResponse.json({ error: "이미 처리된 매칭입니다.", code: "MATCH_ALREADY_HANDLED" }, { status: 409 });
    }
    if (!canCancelApprovedContactExchange(row, nowMs)) {
      return NextResponse.json({ error: "아직 매칭을 취소할 수 없습니다.", code: "MATCH_CANCEL_NOT_READY" }, { status: 409 });
    }

    const updateRes = await admin
      .from("dating_1on1_match_proposals")
      .update({
        state: "admin_canceled",
        contact_exchange_status: "canceled",
        updated_at: nowIso,
      })
      .eq("id", matchId)
      .in("state", ["mutual_accepted", "candidate_accepted"])
      .eq("contact_exchange_status", row.contact_exchange_status)
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      console.error("[POST /api/dating/1on1/matches/[id]] cancel mutual failed", updateRes.error);
      return NextResponse.json({ error: "매칭 취소 처리에 실패했습니다." }, { status: 500 });
    }
    if (!updateRes.data) {
      return NextResponse.json({ error: "이미 처리된 매칭입니다.", code: "MATCH_ALREADY_HANDLED" }, { status: 409 });
    }

    const otherUserId =
      row.source_user_id === user.id ? row.candidate_user_id : row.source_user_id;
    try {
      await notifyDatingUser(admin, {
        userId: otherUserId,
        actorId: user.id,
        type: "dating_1on1_match_canceled",
        title: "1:1 매칭이 취소됐어요",
        body: "진행 중이던 1:1 매칭이 취소됐습니다.",
        route: "/dating/1on1",
        meta: { match_id: matchId },
      });
    } catch (notificationError) {
      console.error("[POST /api/dating/1on1/matches/[id]] cancel notification failed", notificationError);
    }
  }

  if (body.action === "candidate_reject") {
    if (row.candidate_user_id !== user.id) {
      return NextResponse.json({ error: "Only the candidate user can reject." }, { status: 403 });
    }
    if (row.state !== "source_selected") {
      return NextResponse.json({ error: "Only selected candidates can reject." }, { status: 409 });
    }

    const updateRes = await admin
      .from("dating_1on1_match_proposals")
      .update({
        state: "candidate_rejected",
        candidate_responded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", matchId)
      .eq("state", "source_selected")
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      console.error("[POST /api/dating/1on1/matches/[id]] candidate reject failed", updateRes.error);
      return NextResponse.json({ error: "Failed to reject candidate request." }, { status: 500 });
    }
    if (!updateRes.data) {
      return NextResponse.json({ error: "This request was already handled." }, { status: 409 });
    }

    try {
      await notifyDatingUser(admin, {
        userId: row.source_user_id,
        actorId: row.candidate_user_id,
        type: "dating_1on1_match_canceled",
        title: "1:1 요청 결과가 도착했어요",
        body: "선택한 후보가 이번 요청을 진행하지 않기로 했습니다.",
        route: "/dating/1on1",
        meta: { match_id: matchId },
      });
    } catch (notificationError) {
      console.error("[POST /api/dating/1on1/matches/[id]] candidate reject notification failed", notificationError);
    }
  }

  if (body.action === "source_accept") {
    if (row.source_user_id !== user.id) {
      return NextResponse.json({ error: "Only the source user can do the final accept." }, { status: 403 });
    }
    if (row.state !== "candidate_accepted") {
      return NextResponse.json({ error: "Final accept is only available after the candidate accepts." }, { status: 409 });
    }

    const isLegacyMatch = isDatingOneOnOneLegacyPhoneShareMatch({
      state: "mutual_accepted",
      source_final_responded_at: nowIso,
      created_at: row.created_at,
    });

    const updateRes = await admin
      .from("dating_1on1_match_proposals")
      .update({
        state: "mutual_accepted",
        contact_exchange_status: isLegacyMatch ? "none" : "awaiting_applicant_payment",
        contact_exchange_requested_at: isLegacyMatch ? null : nowIso,
        contact_exchange_paid_at: null,
        contact_exchange_paid_by_user_id: null,
        contact_exchange_approved_at: null,
        contact_exchange_approved_by_user_id: null,
        contact_exchange_note: null,
        source_phone_share_consented_at: null,
        candidate_phone_share_consented_at: null,
        source_final_responded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", matchId)
      .eq("state", "candidate_accepted")
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      console.error("[POST /api/dating/1on1/matches/[id]] source accept failed", updateRes.error);
      return NextResponse.json({ error: "Failed to finalize mutual accept." }, { status: 500 });
    }
    if (!updateRes.data) {
      return NextResponse.json({ error: "This request was already handled." }, { status: 409 });
    }

    try {
      await notifyDatingUser(admin, {
        userId: row.candidate_user_id,
        actorId: row.source_user_id,
        type: "dating_1on1_match_accepted",
        title: "1:1 매칭이 성사됐어요",
        body: "서로 수락해 번호 교환 단계가 열렸습니다.",
        route: "/dating/1on1",
        meta: { match_id: matchId },
      });
    } catch (notificationError) {
      console.error("[POST /api/dating/1on1/matches/[id]] source accept notification failed", notificationError);
    }

  }

  if (body.action === "source_reject") {
    if (row.source_user_id !== user.id) {
      return NextResponse.json({ error: "Only the source user can decline after candidate accept." }, { status: 403 });
    }
    if (row.state !== "candidate_accepted") {
      return NextResponse.json({ error: "Source decline is only available after the candidate accepts." }, { status: 409 });
    }

    const updateRes = await admin
      .from("dating_1on1_match_proposals")
      .update({
        state: "source_declined",
        source_final_responded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", matchId)
      .eq("state", "candidate_accepted")
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      console.error("[POST /api/dating/1on1/matches/[id]] source reject failed", updateRes.error);
      return NextResponse.json({ error: "Failed to decline after candidate accept." }, { status: 500 });
    }
    if (!updateRes.data) {
      return NextResponse.json({ error: "This request was already handled." }, { status: 409 });
    }

    try {
      await notifyDatingUser(admin, {
        userId: row.candidate_user_id,
        actorId: row.source_user_id,
        type: "dating_1on1_match_canceled",
        title: "1:1 요청 결과가 도착했어요",
        body: "진행 중이던 1:1 요청이 종료됐습니다.",
        route: "/dating/1on1",
        meta: { match_id: matchId },
      });
    } catch (notificationError) {
      console.error("[POST /api/dating/1on1/matches/[id]] source reject notification failed", notificationError);
    }
  }

  try {
    row = await getMatchRow(admin, matchId);
  } catch (error) {
    console.error("[POST /api/dating/1on1/matches/[id]] reload failed", error);
    return NextResponse.json({ ok: true, item: null, warning: "MATCH_RELOAD_FAILED" });
  }

  return NextResponse.json({ ok: true, item: row });
}

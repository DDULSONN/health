import {
  isDatingOneOnOneLegacyPhoneShareMatch,
  type DatingOneOnOneMatchRow,
} from "@/lib/dating-1on1";
import { recordOneOnOneMetricEvent } from "@/lib/dating-1on1-metrics";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type MatchAction =
  | "select_candidate"
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
  "candidate_accept",
  "candidate_reject",
  "source_accept",
  "source_reject",
  "cancel_mutual",
]);

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  }

  if (body.action === "cancel_mutual") {
    const isParticipant = row.source_user_id === user.id || row.candidate_user_id === user.id;
    if (!isParticipant) {
      return NextResponse.json({ error: "Only matched participants can cancel this match." }, { status: 403 });
    }
    if (!["mutual_accepted", "candidate_accepted"].includes(row.state)) {
      return NextResponse.json({ error: "Only accepted matches can be canceled." }, { status: 409 });
    }
    if (row.contact_exchange_status === "approved") {
      return NextResponse.json({ error: "Phone exchange is already approved. Please contact admin if you need more help." }, { status: 409 });
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
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      console.error("[POST /api/dating/1on1/matches/[id]] cancel mutual failed", updateRes.error);
      return NextResponse.json({ error: "Failed to cancel this match." }, { status: 500 });
    }
    if (!updateRes.data) {
      return NextResponse.json({ error: "This match was already handled." }, { status: 409 });
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
  }

  try {
    row = await getMatchRow(admin, matchId);
  } catch (error) {
    console.error("[POST /api/dating/1on1/matches/[id]] reload failed", error);
    return NextResponse.json({ error: "Action saved, but reload failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: row });
}

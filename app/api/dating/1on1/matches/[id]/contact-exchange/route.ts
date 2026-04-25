import {
  isDatingOneOnOneLegacyPhoneShareMatch,
  type DatingOneOnOneMatchRow,
} from "@/lib/dating-1on1";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

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
    console.error("[POST /api/dating/1on1/matches/[id]/contact-exchange] fetch failed", error);
    return NextResponse.json({ error: "Failed to load match." }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }
  if (row.state !== "mutual_accepted") {
    return NextResponse.json({ error: "Phone exchange is only available after mutual acceptance." }, { status: 409 });
  }
  if (row.contact_exchange_status === "approved") {
    return NextResponse.json({ error: "Phone exchange is already approved." }, { status: 409 });
  }

  const isLegacyMatch = isDatingOneOnOneLegacyPhoneShareMatch(row);
  const nowIso = new Date().toISOString();

  if (isLegacyMatch) {
    const isSource = row.source_user_id === user.id;
    const isCandidate = row.candidate_user_id === user.id;
    if (!isSource && !isCandidate) {
      return NextResponse.json({ error: "Only matched users can consent to phone sharing." }, { status: 403 });
    }
    if (isSource && !row.candidate_phone_share_consented_at) {
      return NextResponse.json(
        { error: "The other person needs to agree to phone sharing first." },
        { status: 409 }
      );
    }

    const consentPatch = isSource
      ? { source_phone_share_consented_at: row.source_phone_share_consented_at ?? nowIso, updated_at: nowIso }
      : { candidate_phone_share_consented_at: row.candidate_phone_share_consented_at ?? nowIso, updated_at: nowIso };

    const consentRes = await admin
      .from("dating_1on1_match_proposals")
      .update(consentPatch)
      .eq("id", matchId)
      .eq("state", "mutual_accepted")
      .select("id")
      .maybeSingle();

    if (consentRes.error) {
      console.error("[POST /api/dating/1on1/matches/[id]/contact-exchange] legacy consent update failed", consentRes.error);
      return NextResponse.json({ error: "Failed to save phone sharing consent." }, { status: 500 });
    }
    if (!consentRes.data) {
      return NextResponse.json({ error: "This match was already handled." }, { status: 409 });
    }

    try {
      row = await getMatchRow(admin, matchId);
    } catch (error) {
      console.error("[POST /api/dating/1on1/matches/[id]/contact-exchange] legacy consent reload failed", error);
      return NextResponse.json({ error: "Consent saved, but reload failed." }, { status: 500 });
    }

    const bothConsented =
      Boolean(row?.source_phone_share_consented_at) && Boolean(row?.candidate_phone_share_consented_at);

    if (row && bothConsented && row.contact_exchange_status !== "approved") {
      const approveRes = await admin
        .from("dating_1on1_match_proposals")
        .update({
          contact_exchange_status: "approved",
          contact_exchange_approved_at: nowIso,
          contact_exchange_approved_by_user_id: null,
          updated_at: nowIso,
        })
        .eq("id", matchId)
        .eq("state", "mutual_accepted")
        .neq("contact_exchange_status", "approved")
        .select("id")
        .maybeSingle();

      if (approveRes.error) {
        console.error("[POST /api/dating/1on1/matches/[id]/contact-exchange] legacy auto-approve failed", approveRes.error);
        return NextResponse.json({ error: "Consent saved, but phone sharing approval failed." }, { status: 500 });
      }

      try {
        row = await getMatchRow(admin, matchId);
      } catch (error) {
        console.error("[POST /api/dating/1on1/matches/[id]/contact-exchange] legacy approve reload failed", error);
        return NextResponse.json({ error: "Consent saved, but reload failed." }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, item: row, mode: "legacy_consent" });
  }

  if (row.source_user_id !== user.id) {
    return NextResponse.json({ error: "Only the applicant can request phone exchange approval." }, { status: 403 });
  }
  if (row.contact_exchange_status === "payment_pending_admin") {
    return NextResponse.json({ error: "Payment confirmation is already pending admin review." }, { status: 409 });
  }
  if (row.contact_exchange_status !== "awaiting_applicant_payment") {
    return NextResponse.json({ error: "Phone exchange cannot be requested right now." }, { status: 409 });
  }
  const updateRes = await admin
    .from("dating_1on1_match_proposals")
    .update({
      contact_exchange_status: "payment_pending_admin",
      contact_exchange_paid_at: nowIso,
      contact_exchange_paid_by_user_id: user.id,
      updated_at: nowIso,
    })
    .eq("id", matchId)
    .eq("source_user_id", user.id)
    .eq("state", "mutual_accepted")
    .eq("contact_exchange_status", "awaiting_applicant_payment")
    .select("id")
    .maybeSingle();

  if (updateRes.error) {
    console.error("[POST /api/dating/1on1/matches/[id]/contact-exchange] update failed", updateRes.error);
    return NextResponse.json({ error: "Failed to request phone exchange approval." }, { status: 500 });
  }
  if (!updateRes.data) {
    return NextResponse.json({ error: "This phone exchange request was already handled." }, { status: 409 });
  }

  try {
    row = await getMatchRow(admin, matchId);
  } catch (error) {
    console.error("[POST /api/dating/1on1/matches/[id]/contact-exchange] reload failed", error);
    return NextResponse.json({ error: "Request saved, but reload failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: row });
}

import { isAllowedAdminUser } from "@/lib/admin";
import type { DatingOneOnOneMatchRow } from "@/lib/dating-1on1";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type AdminContactExchangeAction = "approve" | "reset";

type Payload = {
  action?: AdminContactExchangeAction;
};

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
  if (!isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Payload | null;
  const action = body?.action;
  if (action !== "approve" && action !== "reset") {
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
    console.error("[POST /api/admin/dating/1on1/matches/[id]/contact-exchange] fetch failed", error);
    return NextResponse.json({ error: "Failed to load match." }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }
  if (row.state !== "mutual_accepted") {
    return NextResponse.json({ error: "Phone exchange approval is only available for mutual matches." }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const nextPatch =
    action === "approve"
      ? {
          contact_exchange_status: "approved",
          contact_exchange_approved_at: nowIso,
          contact_exchange_approved_by_user_id: user.id,
          updated_at: nowIso,
        }
      : {
          contact_exchange_status: "awaiting_applicant_payment",
          contact_exchange_paid_at: null,
          contact_exchange_paid_by_user_id: null,
          contact_exchange_approved_at: null,
          contact_exchange_approved_by_user_id: null,
          updated_at: nowIso,
        };

  if (action === "approve" && row.contact_exchange_status !== "payment_pending_admin") {
    return NextResponse.json({ error: "Only payment-pending matches can be approved." }, { status: 409 });
  }
  if (action === "reset" && row.contact_exchange_status === "approved") {
    return NextResponse.json({ error: "Approved exchanges should not be reset here." }, { status: 409 });
  }

  const updateRes = await admin
    .from("dating_1on1_match_proposals")
    .update(nextPatch)
    .eq("id", matchId)
    .eq("state", "mutual_accepted")
    .select("id")
    .maybeSingle();

  if (updateRes.error) {
    console.error("[POST /api/admin/dating/1on1/matches/[id]/contact-exchange] update failed", updateRes.error);
    return NextResponse.json({ error: "Failed to update phone exchange status." }, { status: 500 });
  }
  if (!updateRes.data) {
    return NextResponse.json({ error: "This phone exchange state was already changed." }, { status: 409 });
  }

  try {
    row = await getMatchRow(admin, matchId);
  } catch (error) {
    console.error("[POST /api/admin/dating/1on1/matches/[id]/contact-exchange] reload failed", error);
    return NextResponse.json({ error: "Action saved, but reload failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: row });
}

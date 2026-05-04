import { isAllowedAdminUser } from "@/lib/admin";
import {
  DATING_ONE_ON_ONE_MATCH_ACTIVE_PAIR_STATES,
  DATING_ONE_ON_ONE_MATCH_CANDIDATE_SINGLE_TRACK_STATES,
  type DatingOneOnOneMatchRow,
  getDatingOneOnOneCardsByIds,
} from "@/lib/dating-1on1";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type AdminCreatePayload = {
  source_card_id?: string;
  candidate_card_ids?: string[];
};

type AdminCreateResponse = {
  ok?: boolean;
  error?: string;
  requested_count?: number;
  inserted_count?: number;
  skipped_count?: number;
  skipped_candidate_card_ids?: string[];
};

const MATCH_STATES = new Set([
  "proposed",
  "source_selected",
  "source_skipped",
  "candidate_accepted",
  "candidate_rejected",
  "source_declined",
  "admin_canceled",
  "mutual_accepted",
]);

const MATCH_BATCH_SIZE = 1000;
const FULL_MATCH_SELECT =
  "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,contact_exchange_status,contact_exchange_requested_at,contact_exchange_paid_at,contact_exchange_paid_by_user_id,contact_exchange_approved_at,contact_exchange_approved_by_user_id,contact_exchange_note,source_phone_share_consented_at,candidate_phone_share_consented_at,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at";
const LEGACY_MATCH_SELECT =
  "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at";

type LegacyAdminMatchRow = Omit<
  DatingOneOnOneMatchRow,
  | "contact_exchange_status"
  | "contact_exchange_requested_at"
  | "contact_exchange_paid_at"
  | "contact_exchange_paid_by_user_id"
  | "contact_exchange_approved_at"
  | "contact_exchange_approved_by_user_id"
  | "contact_exchange_note"
  | "source_phone_share_consented_at"
  | "candidate_phone_share_consented_at"
> & {
  contact_exchange_status?: never;
};

function isMissingContactExchangeColumnsError(error: { message?: string } | null | undefined) {
  const message = String(error?.message ?? "");
  return (
    message.includes("contact_exchange_status") ||
    message.includes("contact_exchange_requested_at") ||
    message.includes("contact_exchange_paid_at") ||
    message.includes("contact_exchange_paid_by_user_id") ||
    message.includes("contact_exchange_approved_at") ||
    message.includes("contact_exchange_approved_by_user_id") ||
    message.includes("contact_exchange_note") ||
    message.includes("source_phone_share_consented_at") ||
    message.includes("candidate_phone_share_consented_at")
  );
}

function toLegacyCompatibleMatchRow(row: LegacyAdminMatchRow): DatingOneOnOneMatchRow {
  return {
    ...row,
    contact_exchange_status: "none",
    contact_exchange_requested_at: null,
    contact_exchange_paid_at: null,
    contact_exchange_paid_by_user_id: null,
    contact_exchange_approved_at: null,
    contact_exchange_approved_by_user_id: null,
    contact_exchange_note: null,
    source_phone_share_consented_at: null,
    candidate_phone_share_consented_at: null,
  };
}

async function fetchAllAdminMatches(
  admin: ReturnType<typeof createAdminClient>,
  {
    state,
    sourceCardId,
    candidateCardId,
  }: {
    state: string;
    sourceCardId: string;
    candidateCardId: string;
  }
) {
  const rows: DatingOneOnOneMatchRow[] = [];
  let from = 0;
  let useLegacySelect = false;

  while (true) {
    const buildQuery = (selectColumns: string) => {
      let query = admin
        .from("dating_1on1_match_proposals")
        .select(selectColumns)
        .order("created_at", { ascending: false })
        .range(from, from + MATCH_BATCH_SIZE - 1);

      if (state && MATCH_STATES.has(state)) {
        query = query.eq("state", state);
      }
      if (sourceCardId) {
        query = query.eq("source_card_id", sourceCardId);
      }
      if (candidateCardId) {
        query = query.eq("candidate_card_id", candidateCardId);
      }

      return query;
    };

    let { data, error } = await buildQuery(useLegacySelect ? LEGACY_MATCH_SELECT : FULL_MATCH_SELECT);
    if (error && !useLegacySelect && isMissingContactExchangeColumnsError(error)) {
      useLegacySelect = true;
      ({ data, error } = await buildQuery(LEGACY_MATCH_SELECT));
    }
    if (error) throw error;

    const batch = useLegacySelect
      ? ((data ?? []) as unknown as LegacyAdminMatchRow[]).map(toLegacyCompatibleMatchRow)
      : ((data ?? []) as unknown as DatingOneOnOneMatchRow[]);
    rows.push(...batch);
    if (batch.length < MATCH_BATCH_SIZE) break;
    from += MATCH_BATCH_SIZE;
  }

  return rows;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const state = (searchParams.get("state") ?? "").trim();
  const sourceCardId = (searchParams.get("source_card_id") ?? "").trim();
  const candidateCardId = (searchParams.get("candidate_card_id") ?? "").trim();

  const admin = createAdminClient();
  let rows: DatingOneOnOneMatchRow[];
  try {
    rows = await fetchAllAdminMatches(admin, { state, sourceCardId, candidateCardId });
  } catch (error) {
    console.error("[GET /api/dating/1on1/matches/admin] failed", error);
    return NextResponse.json({ error: "Failed to load matches." }, { status: 500 });
  }
  const cardMap = await getDatingOneOnOneCardsByIds(
    admin,
    rows.flatMap((row) => [row.source_card_id, row.candidate_card_id])
  ).catch((cardError) => {
    console.error("[GET /api/dating/1on1/matches/admin] cards failed", cardError);
    return new Map();
  });

  return NextResponse.json({
    items: rows.map((row) => ({
      ...row,
      source_card: cardMap.get(row.source_card_id) ?? null,
      candidate_card: cardMap.get(row.candidate_card_id) ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as AdminCreatePayload | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sourceCardId = typeof body.source_card_id === "string" ? body.source_card_id.trim() : "";
  const candidateCardIds = Array.isArray(body.candidate_card_ids)
    ? [...new Set(body.candidate_card_ids.map((id) => String(id).trim()).filter((id) => id.length > 0))]
    : [];

  if (!sourceCardId) {
    return NextResponse.json({ error: "Source card id is required." }, { status: 400 });
  }
  if (candidateCardIds.length === 0) {
    return NextResponse.json({ error: "At least one candidate card is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const sourceRes = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,sex,status")
    .eq("id", sourceCardId)
    .maybeSingle();

  if (sourceRes.error) {
    console.error("[POST /api/dating/1on1/matches/admin] source fetch failed", sourceRes.error);
    return NextResponse.json({ error: "Failed to load source card." }, { status: 500 });
  }
  if (!sourceRes.data) {
    return NextResponse.json({ error: "Source card not found." }, { status: 404 });
  }

  const candidatesRes = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,sex,status")
    .in("id", candidateCardIds);

  if (candidatesRes.error) {
    console.error("[POST /api/dating/1on1/matches/admin] candidate fetch failed", candidatesRes.error);
    return NextResponse.json({ error: "Failed to load candidate cards." }, { status: 500 });
  }

  const candidateRows = (candidatesRes.data ?? []).filter(
    (row) => row.user_id !== sourceRes.data?.user_id && row.sex !== sourceRes.data?.sex
  );

  if (candidateRows.length === 0) {
    return NextResponse.json(
      { error: "선택 가능한 후보 카드가 없습니다. 본인 카드 제외, 다른 성별 카드만 보낼 수 있습니다." },
      { status: 409 }
    );
  }

  const candidateTrackRes = await admin
    .from("dating_1on1_match_proposals")
    .select("candidate_card_id")
    .in(
      "candidate_card_id",
      candidateRows.map((row) => row.id)
    )
    .in("state", [...DATING_ONE_ON_ONE_MATCH_CANDIDATE_SINGLE_TRACK_STATES]);

  if (candidateTrackRes.error) {
    console.error("[POST /api/dating/1on1/matches/admin] candidate track check failed", candidateTrackRes.error);
    return NextResponse.json({ error: "Failed to validate candidate state." }, { status: 500 });
  }

  const blockedCandidateIds = new Set((candidateTrackRes.data ?? []).map((row) => row.candidate_card_id));

  const existingPairRes = await admin
    .from("dating_1on1_match_proposals")
    .select("candidate_card_id")
    .eq("source_card_id", sourceCardId)
    .in(
      "candidate_card_id",
      candidateRows.map((row) => row.id)
    )
    .in("state", [...DATING_ONE_ON_ONE_MATCH_ACTIVE_PAIR_STATES]);

  if (existingPairRes.error) {
    console.error("[POST /api/dating/1on1/matches/admin] pair check failed", existingPairRes.error);
    return NextResponse.json({ error: "Failed to validate existing candidate pairs." }, { status: 500 });
  }

  const existingPairIds = new Set((existingPairRes.data ?? []).map((row) => row.candidate_card_id));
  const skippedCandidateCardIds = candidateRows
    .map((row) => row.id)
    .filter((id) => blockedCandidateIds.has(id) || existingPairIds.has(id));

  const insertRows = candidateRows
    .filter((row) => !blockedCandidateIds.has(row.id) && !existingPairIds.has(row.id))
    .map((row) => ({
      source_card_id: sourceRes.data!.id,
      source_user_id: sourceRes.data!.user_id,
      candidate_card_id: row.id,
      candidate_user_id: row.user_id,
      admin_sent_by_user_id: user.id,
      state: "proposed",
      updated_at: new Date().toISOString(),
    }));

  if (insertRows.length === 0) {
    const response: AdminCreateResponse = {
      error: "새로 보낼 수 있는 후보가 없습니다. 이미 진행 중이거나, 같은 기준 카드로 이미 보낸 후보일 수 있습니다.",
      requested_count: candidateCardIds.length,
      inserted_count: 0,
      skipped_count: skippedCandidateCardIds.length,
      skipped_candidate_card_ids: skippedCandidateCardIds,
    };
    return NextResponse.json(response, { status: 409 });
  }

  const insertRes = await admin.from("dating_1on1_match_proposals").insert(insertRows).select("id");
  if (insertRes.error) {
    console.error("[POST /api/dating/1on1/matches/admin] insert failed", insertRes.error);
    return NextResponse.json({ error: "Failed to send candidates." }, { status: 500 });
  }

  const response: AdminCreateResponse = {
    ok: true,
    requested_count: candidateCardIds.length,
    inserted_count: insertRes.data?.length ?? insertRows.length,
    skipped_count: skippedCandidateCardIds.length,
    skipped_candidate_card_ids: skippedCandidateCardIds,
  };

  return NextResponse.json(response);
}

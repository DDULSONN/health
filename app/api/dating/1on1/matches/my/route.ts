import type { DatingOneOnOneMatchRow } from "@/lib/dating-1on1";
import {
  getDatingOneOnOneCardPhonesByIds,
  getDatingOneOnOneCardsByIds,
} from "@/lib/dating-1on1";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { NextResponse } from "next/server";

const MY_MATCH_BATCH_SIZE = 500;
const CLOSED_MATCH_LIMIT = 80;
const ACTIVE_MATCH_STATES = ["proposed", "source_selected", "candidate_accepted", "mutual_accepted"];
const CLOSED_MATCH_STATES = ["source_skipped", "candidate_rejected", "source_declined", "admin_canceled"];

function isMissingMatchHidesTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("dating_1on1_match_hides") ||
    message.includes("could not find the table") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

async function fetchHiddenMatchIds(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await admin
    .from("dating_1on1_match_hides")
    .select("match_id")
    .eq("user_id", userId)
    .limit(5000);

  if (error) {
    if (isMissingMatchHidesTableError(error)) return new Set<string>();
    throw error;
  }

  return new Set((data ?? []).map((row) => String((row as { match_id?: string }).match_id ?? "")).filter(Boolean));
}

async function fetchMyMatchesByStates(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  states: string[],
  maxRows?: number
) {
  const rows: DatingOneOnOneMatchRow[] = [];
  let from = 0;

  while (true) {
    const to = maxRows
      ? Math.min(from + MY_MATCH_BATCH_SIZE - 1, maxRows - 1)
      : from + MY_MATCH_BATCH_SIZE - 1;
    const { data, error } = await admin
      .from("dating_1on1_match_proposals")
      .select(
        "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,contact_exchange_status,contact_exchange_requested_at,contact_exchange_paid_at,contact_exchange_paid_by_user_id,contact_exchange_approved_at,contact_exchange_approved_by_user_id,contact_exchange_note,source_phone_share_consented_at,candidate_phone_share_consented_at,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at"
      )
      .or(`source_user_id.eq.${userId},candidate_user_id.eq.${userId}`)
      .in("state", states)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw error;
    }

    const batch = (data ?? []) as DatingOneOnOneMatchRow[];
    rows.push(...batch);

    if (batch.length < MY_MATCH_BATCH_SIZE) break;
    if (maxRows && rows.length >= maxRows) break;
    from += MY_MATCH_BATCH_SIZE;
  }

  return maxRows ? rows.slice(0, maxRows) : rows;
}

async function fetchAllMyMatches(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const [hiddenIds, activeRows, closedRows] = await Promise.all([
    fetchHiddenMatchIds(admin, userId),
    fetchMyMatchesByStates(admin, userId, ACTIVE_MATCH_STATES),
    fetchMyMatchesByStates(admin, userId, CLOSED_MATCH_STATES, CLOSED_MATCH_LIMIT),
  ]);

  return [...activeRows, ...closedRows]
    .filter((row) => !hiddenIds.has(row.id))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let rows: DatingOneOnOneMatchRow[];
  try {
    rows = await fetchAllMyMatches(admin, user.id);
  } catch (error) {
    console.error("[GET /api/dating/1on1/matches/my] failed", error);
    return NextResponse.json({ error: "Failed to load match proposals." }, { status: 500 });
  }
  const cardMap = await getDatingOneOnOneCardsByIds(
    admin,
    rows.flatMap((row) => [row.source_card_id, row.candidate_card_id])
  ).catch((cardError) => {
    console.error("[GET /api/dating/1on1/matches/my] cards failed", cardError);
    return null;
  });

  if (!cardMap) {
    return NextResponse.json({ error: "Failed to load card details." }, { status: 500 });
  }

  const phoneMap = await getDatingOneOnOneCardPhonesByIds(
    admin,
    rows.flatMap((row) => [row.source_card_id, row.candidate_card_id])
  ).catch((phoneError) => {
    console.error("[GET /api/dating/1on1/matches/my] phones failed", phoneError);
    return null;
  });

  if (!phoneMap) {
    return NextResponse.json({ error: "Failed to load phone details." }, { status: 500 });
  }

  return NextResponse.json({
    items: rows.map((row) => {
      const role = row.source_user_id === user.id ? "source" : "candidate";
      const counterpartyCardId = role === "source" ? row.candidate_card_id : row.source_card_id;
      const counterpartyPhone =
        row.contact_exchange_status === "approved" ? (phoneMap.get(counterpartyCardId) ?? null) : null;
      return {
        ...row,
        role,
        source_card: cardMap.get(row.source_card_id) ?? null,
        candidate_card: cardMap.get(row.candidate_card_id) ?? null,
        counterparty_card: cardMap.get(counterpartyCardId) ?? null,
        counterparty_phone: counterpartyPhone,
        action_required:
          (role === "source" && row.state === "proposed") ||
          (role === "candidate" && row.state === "source_selected"),
      };
    }),
  });
}

export async function DELETE(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "숨길 매칭 기록을 찾지 못했습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: match, error: matchError } = await admin
    .from("dating_1on1_match_proposals")
    .select("id,source_user_id,candidate_user_id,state")
    .eq("id", id)
    .maybeSingle();

  if (matchError) {
    console.error("[DELETE /api/dating/1on1/matches/my] match lookup failed", matchError);
    return NextResponse.json({ error: "매칭 기록을 확인하지 못했습니다." }, { status: 500 });
  }
  if (!match || (match.source_user_id !== user.id && match.candidate_user_id !== user.id)) {
    return NextResponse.json({ error: "매칭 기록을 찾을 수 없습니다." }, { status: 404 });
  }
  if (!CLOSED_MATCH_STATES.includes(String(match.state ?? ""))) {
    return NextResponse.json({ error: "종료된 매칭 기록만 삭제할 수 있습니다." }, { status: 409 });
  }

  const { error } = await admin
    .from("dating_1on1_match_hides")
    .upsert({ user_id: user.id, match_id: id }, { onConflict: "user_id,match_id" });

  if (error) {
    console.error("[DELETE /api/dating/1on1/matches/my] hide failed", error);
    const message = isMissingMatchHidesTableError(error)
      ? "매칭 기록 숨김 테이블이 아직 적용되지 않았습니다. 관리자에게 문의해주세요."
      : "매칭 기록 삭제에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id });
}

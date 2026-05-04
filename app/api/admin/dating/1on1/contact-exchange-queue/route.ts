import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { type DatingOneOnOneMatchRow, getDatingOneOnOneCardsByIds } from "@/lib/dating-1on1";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

const BATCH_SIZE = 500;
const FULL_QUEUE_SELECT =
  "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,contact_exchange_status,contact_exchange_requested_at,contact_exchange_paid_at,contact_exchange_paid_by_user_id,contact_exchange_approved_at,contact_exchange_approved_by_user_id,contact_exchange_note,source_phone_share_consented_at,candidate_phone_share_consented_at,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at";

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

async function fetchPendingContactExchangeMatches(admin: ReturnType<typeof createAdminClient>) {
  const rows: DatingOneOnOneMatchRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("dating_1on1_match_proposals")
      .select(FULL_QUEUE_SELECT)
      .eq("state", "mutual_accepted")
      .eq("contact_exchange_status", "payment_pending_admin")
      .order("contact_exchange_paid_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, from + BATCH_SIZE - 1);

    if (error) {
      if (isMissingContactExchangeColumnsError(error)) {
        return [];
      }
      throw error;
    }

    const batch = (data ?? []) as DatingOneOnOneMatchRow[];
    rows.push(...batch);
    if (batch.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
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

  const admin = createAdminClient();

  try {
    const rows = await fetchPendingContactExchangeMatches(admin);
    const cardMap = await getDatingOneOnOneCardsByIds(
      admin,
      rows.flatMap((row) => [row.source_card_id, row.candidate_card_id])
    );

    return NextResponse.json({
      items: rows.map((row) => ({
        ...row,
        source_card: cardMap.get(row.source_card_id) ?? null,
        candidate_card: cardMap.get(row.candidate_card_id) ?? null,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/dating/1on1/contact-exchange-queue] failed", error);
    return NextResponse.json({ error: "번호 공개 승인 대기를 불러오지 못했습니다." }, { status: 500 });
  }
}

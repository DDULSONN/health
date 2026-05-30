import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { type DatingOneOnOneMatchRow, getDatingOneOnOneCardsByIds } from "@/lib/dating-1on1";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

const BATCH_SIZE = 500;
const FULL_QUEUE_SELECT =
  "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,contact_exchange_status,contact_exchange_requested_at,contact_exchange_paid_at,contact_exchange_paid_by_user_id,contact_exchange_approved_at,contact_exchange_approved_by_user_id,contact_exchange_note,source_phone_share_consented_at,candidate_phone_share_consented_at,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at";

type ProfileLite = {
  user_id: string | null;
  nickname: string | null;
  email?: string | null;
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

async function fetchPendingContactExchangeMatches(admin: ReturnType<typeof createAdminClient>) {
  const rows: DatingOneOnOneMatchRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("dating_1on1_match_proposals")
      .select(FULL_QUEUE_SELECT)
      .eq("state", "mutual_accepted")
      .in("contact_exchange_status", ["payment_pending_admin", "awaiting_applicant_payment", "none"])
      .order("contact_exchange_paid_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
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

async function fetchProfilesByUserIds(admin: ReturnType<typeof createAdminClient>, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (!uniqueUserIds.length) return new Map<string, ProfileLite>();

  const { data, error } = await admin
    .from("profiles")
    .select("user_id,nickname")
    .in("user_id", uniqueUserIds);

  const profileMap = new Map<string, ProfileLite>();
  if (error) {
    console.error("[GET /api/admin/dating/1on1/contact-exchange-queue] profiles failed", error);
  } else {
    for (const row of (data ?? []) as ProfileLite[]) {
      const userId = String(row.user_id ?? "").trim();
      if (!userId) continue;
      profileMap.set(userId, { user_id: userId, nickname: row.nickname ?? null });
    }
  }

  const missingUserIds = uniqueUserIds.filter((userId) => !String(profileMap.get(userId)?.nickname ?? "").trim());
  for (let start = 0; start < missingUserIds.length; start += 20) {
    const chunk = missingUserIds.slice(start, start + 20);
    const results = await Promise.all(
      chunk.map(async (userId) => {
        const res = await admin.auth.admin.getUserById(userId);
        if (res.error || !res.data.user) return null;
        const metadata = res.data.user.user_metadata as Record<string, unknown> | null;
        const nickname = String(metadata?.nickname ?? metadata?.name ?? "").trim() || null;
        return {
          user_id: userId,
          nickname,
          email: res.data.user.email ?? null,
        } satisfies ProfileLite;
      })
    );

    for (const row of results) {
      if (!row?.user_id) continue;
      const existing = profileMap.get(row.user_id);
      profileMap.set(row.user_id, {
        user_id: row.user_id,
        nickname: existing?.nickname ?? row.nickname,
        email: row.email ?? existing?.email ?? null,
      });
    }
  }

  return profileMap;
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
    const profileMap = await fetchProfilesByUserIds(
      admin,
      rows.flatMap((row) => [row.source_user_id, row.candidate_user_id])
    );

    return NextResponse.json({
      items: rows.map((row) => ({
        ...row,
        source_card: cardMap.get(row.source_card_id) ?? null,
        candidate_card: cardMap.get(row.candidate_card_id) ?? null,
        source_profile: profileMap.get(row.source_user_id) ?? null,
        candidate_profile: profileMap.get(row.candidate_user_id) ?? null,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/dating/1on1/contact-exchange-queue] failed", error);
    return NextResponse.json({ error: "번호 공개 가능 매칭을 불러오지 못했습니다." }, { status: 500 });
  }
}

import { ensureCronAuthorized } from "@/lib/cron-auth";
import { sendDatingEmailNotification } from "@/lib/dating-swipe";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type MatchRow = {
  id: string;
  source_user_id: string;
  candidate_user_id: string;
  state: string | null;
  contact_exchange_status: string | null;
  contact_exchange_requested_at: string | null;
  candidate_responded_at: string | null;
  source_final_responded_at: string | null;
  updated_at: string | null;
  created_at: string;
};

const CAMPAIGN_KEY = "one_on_one_match_pending_24h";
const EMAIL_SUBJECT = "짐툴 1:1 소개팅 매칭이 있어요";
const EMAIL_TEXT = "짐툴 1:1 소개팅에서 매칭된 상대가 있어요.\n마이페이지에서 내용을 확인해 주세요.";

function isoHoursAgo(nowMs: number, hours: number) {
  return new Date(nowMs - hours * 60 * 60 * 1000).toISOString();
}

function getReminderBaseAt(row: MatchRow) {
  return (
    row.contact_exchange_requested_at ||
    row.source_final_responded_at ||
    row.candidate_responded_at ||
    row.updated_at ||
    row.created_at
  );
}

function uniqueUserIds(row: MatchRow) {
  return [...new Set([row.source_user_id, row.candidate_user_id].map((id) => String(id ?? "").trim()).filter(Boolean))];
}

async function alreadySent(admin: ReturnType<typeof createAdminClient>, matchId: string, userId: string) {
  const res = await admin
    .from("admin_open_card_outreach_mail_logs")
    .select("id")
    .eq("campaign_key", CAMPAIGN_KEY)
    .eq("user_id", userId)
    .eq("success", true)
    .contains("meta", { match_id: matchId })
    .limit(1);

  if (res.error) {
    throw res.error;
  }
  return (res.data ?? []).length > 0;
}

async function logSendResult(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    matchId: string;
    userId: string;
    success: boolean;
    error?: string | null;
  }
) {
  const res = await admin.from("admin_open_card_outreach_mail_logs").insert({
    campaign_key: CAMPAIGN_KEY,
    user_id: input.userId,
    email: null,
    subject: EMAIL_SUBJECT,
    success: input.success,
    provider: "resend",
    provider_status: null,
    provider_error: input.error ?? null,
    meta: {
      match_id: input.matchId,
      reminder_kind: "pending_24h",
    },
  });

  if (res.error) {
    console.error("[cron dating-1on1-match-reminders] log insert failed", {
      matchId: input.matchId,
      userId: input.userId,
      error: res.error,
    });
  }
}

export async function GET(request: Request) {
  const authResponse = ensureCronAuthorized(request);
  if (authResponse) return authResponse;

  const admin = createAdminClient();
  const nowMs = Date.now();
  const newerThan = isoHoursAgo(nowMs, 26);
  const olderThan = isoHoursAgo(nowMs, 24);

  const matchesRes = await admin
    .from("dating_1on1_match_proposals")
    .select(
      "id,source_user_id,candidate_user_id,state,contact_exchange_status,contact_exchange_requested_at,candidate_responded_at,source_final_responded_at,updated_at,created_at"
    )
    .eq("state", "mutual_accepted")
    .eq("contact_exchange_status", "awaiting_applicant_payment")
    .gte("source_final_responded_at", newerThan)
    .lt("source_final_responded_at", olderThan)
    .order("source_final_responded_at", { ascending: true })
    .limit(1000);

  if (matchesRes.error) {
    console.error("[cron dating-1on1-match-reminders] matches query failed", matchesRes.error);
    return NextResponse.json({ error: matchesRes.error.message }, { status: 500 });
  }

  const matches = ((matchesRes.data ?? []) as MatchRow[]).filter((row) => {
    const baseAt = getReminderBaseAt(row);
    return baseAt >= newerThan && baseAt < olderThan;
  });

  const results = {
    candidates: matches.length,
    recipients: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const match of matches) {
    for (const userId of uniqueUserIds(match)) {
      results.recipients += 1;

      try {
        if (await alreadySent(admin, match.id, userId)) {
          results.skipped += 1;
          continue;
        }
      } catch (error) {
        console.error("[cron dating-1on1-match-reminders] dedupe query failed", {
          matchId: match.id,
          userId,
          error,
        });
        results.failed += 1;
        continue;
      }

      try {
        const success = await sendDatingEmailNotification(admin, userId, EMAIL_SUBJECT, EMAIL_TEXT);
        await logSendResult(admin, {
          matchId: match.id,
          userId,
          success,
          error: success ? null : "EMAIL_NOT_SENT",
        });

        if (success) results.sent += 1;
        else results.skipped += 1;
      } catch (error) {
        await logSendResult(admin, {
          matchId: match.id,
          userId,
          success: false,
          error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        });
        console.error("[cron dating-1on1-match-reminders] email failed", {
          matchId: match.id,
          userId,
          error,
        });
        results.failed += 1;
      }
    }
  }

  return NextResponse.json({ ok: true, results });
}

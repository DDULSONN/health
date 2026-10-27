import type { SupabaseClient } from "@supabase/supabase-js";
import { canDeliverOneOnOneNotification } from "@/lib/dating-1on1-delivery-guard";
import { buildOneOnOnePendingReminder } from "@/lib/dating-email-templates";
import { sendDatingEmailNotification } from "@/lib/dating-swipe";

export type OneOnOneReminderKind = "selection_pending_24h" | "mutual_pending_24h";
export type OneOnOneReminderMatch = {
  id: string; source_user_id: string; candidate_user_id: string;
  state: string | null; contact_exchange_status: string | null;
  source_selected_at: string | null; source_final_responded_at: string | null;
};
export const REMINDER_SELECT = "id,source_user_id,candidate_user_id,state,contact_exchange_status,source_selected_at,source_final_responded_at";
const HOUR = 60 * 60 * 1000;
const TABLE = "dating_1on1_reminder_deliveries";

export function isOneOnOneReminderHour(nowMs: number) {
  const hour = new Date(nowMs + 9 * HOUR).getUTCHours();
  return hour >= 9 && hour < 20;
}

export function getOneOnOneReminderKind(row: OneOnOneReminderMatch, nowMs: number, startedAt: string): OneOnOneReminderKind | null {
  const kind = row.state === "source_selected" && row.contact_exchange_status === "none" ? "selection_pending_24h"
    : row.state === "mutual_accepted" && row.contact_exchange_status === "awaiting_applicant_payment" ? "mutual_pending_24h" : null;
  if (!kind) return null;
  const eventMs = Date.parse(kind === "selection_pending_24h" ? row.source_selected_at ?? "" : row.source_final_responded_at ?? "");
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(eventMs) || !Number.isFinite(startMs) || eventMs < startMs || nowMs - eventMs < 24 * HOUR || nowMs - eventMs >= 48 * HOUR) return null;
  return kind;
}

// One reservation per event and recipient/day. Never retry an ambiguous delivery
// at a later cron tick: a provider may already have accepted it.
export async function sendOneOnOnePendingReminder(admin: SupabaseClient, row: OneOnOneReminderMatch,
  recipientId: string, kind: OneOnOneReminderKind, startedAt: string, nowMs: number) {
  const eligibleRecipient = kind === "selection_pending_24h"
    ? row.candidate_user_id === recipientId : [row.source_user_id, row.candidate_user_id].includes(recipientId);
  if (!eligibleRecipient || !isOneOnOneReminderHour(nowMs) || getOneOnOneReminderKind(row, nowMs, startedAt) !== kind) return "skipped";
  // KST-day uniqueness remains the atomic concurrency guard. Also avoid two
  // reminders less than 24h apart across consecutive days, including uncertain sends.
  const recent = await admin.from(TABLE).select("id").eq("recipient_user_id", recipientId)
    .gte("created_at", new Date(nowMs - 24 * HOUR).toISOString()).limit(1);
  if (recent.error) return "failed";
  if (recent.data?.length) return "skipped";
  const type = kind === "selection_pending_24h" ? "dating_1on1_selection_received" : "dating_1on1_match_accepted";
  const isCurrent = async () => {
    if (!isOneOnOneReminderHour(Date.now())) return false;
    if (!await canDeliverOneOnOneNotification(admin, row.id, type, recipientId)) return false;
    const fresh = await admin.from("dating_1on1_match_proposals").select(REMINDER_SELECT).eq("id", row.id).maybeSingle();
    return !fresh.error && Boolean(fresh.data) && getOneOnOneReminderKind(fresh.data as OneOnOneReminderMatch, Date.now(), startedAt) === kind;
  };
  if (!await isCurrent()) return "skipped";

  // Do not repeat a reminder already sent by the pre-upgrade cron.
  if (kind === "mutual_pending_24h") {
    const legacy = await admin.from("admin_open_card_outreach_mail_logs").select("id")
      .eq("campaign_key", "one_on_one_match_pending_24h").eq("user_id", recipientId)
      .eq("success", true).contains("meta", { match_id: row.id }).limit(1);
    if (legacy.error) return "failed";
    if (legacy.data?.length) return "skipped";
  }
  const reservation = await admin.from(TABLE).insert({ match_id: row.id, recipient_user_id: recipientId, event_kind: kind })
    .select("id").maybeSingle();
  if (reservation.error) return reservation.error.code === "23505" ? "skipped" : "failed";
  if (!reservation.data?.id) return "failed";

  let sent = false;
  try {
    const message = buildOneOnOnePendingReminder(row.id, kind);
    sent = await sendDatingEmailNotification(admin, recipientId, message.emailSubject, message.emailText,
      isCurrent, `one-on-one-reminder/${row.id}/${recipientId}/${kind}`);
  } catch {
    // Notification failures must never change a match or trigger duplicate sends.
  }
  const saved = await admin.from(TABLE).update({ status: sent ? "sent" : "failed",
    sent_at: sent ? new Date().toISOString() : null, provider_error: sent ? null : "EMAIL_NOT_SENT" })
    .eq("id", reservation.data.id).eq("status", "sending");
  if (saved.error) console.error("[1on1-reminder] delivery result save failed", { deliveryId: reservation.data.id, code: saved.error.code });
  return sent ? "sent" : "failed";
}

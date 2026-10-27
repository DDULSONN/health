import { ensureCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getOneOnOneReminderKind, isOneOnOneReminderHour, REMINDER_SELECT,
  sendOneOnOnePendingReminder, type OneOnOneReminderMatch } from "@/lib/dating-1on1-reminders";

export const maxDuration = 60;
const HOUR = 60 * 60 * 1000;

export async function GET(request: Request) {
  const authResponse = ensureCronAuthorized(request);
  if (authResponse) return authResponse;
  const nowMs = Date.now();
  if (!isOneOnOneReminderHour(nowMs)) return NextResponse.json({ ok: true, skipped: "QUIET_HOURS" });
  const admin = createAdminClient();
  const setting = await admin.from("site_settings").select("value_json")
    .eq("key", "dating_1on1_reminder_delivery").maybeSingle();
  const startedAt = String(setting.data?.value_json?.started_at ?? "");
  if (setting.error || setting.data?.value_json?.enabled !== true || !Number.isFinite(Date.parse(startedAt)))
    return NextResponse.json({ ok: true, skipped: "NOT_ENABLED" });

  const newerThan = new Date(Math.max(nowMs - 48 * HOUR, Date.parse(startedAt))).toISOString();
  const olderThan = new Date(nowMs - 24 * HOUR).toISOString();
  const rows = await Promise.all([
    admin.from("dating_1on1_match_proposals").select(REMINDER_SELECT)
      .eq("state", "source_selected").eq("contact_exchange_status", "none")
      .gte("source_selected_at", newerThan).lte("source_selected_at", olderThan)
      .order("source_selected_at").order("id").limit(100),
    admin.from("dating_1on1_match_proposals").select(REMINDER_SELECT)
      .eq("state", "mutual_accepted").eq("contact_exchange_status", "awaiting_applicant_payment")
      .gte("source_final_responded_at", newerThan).lte("source_final_responded_at", olderThan)
      .order("source_final_responded_at").order("id").limit(100),
  ]);
  if (rows.some(res => res.error)) {
    console.error("[cron 1on1-reminders] candidate query failed", rows.map(res => res.error?.code));
    return NextResponse.json({ error: "알림 대상을 확인하지 못했습니다." }, { status: 500 });
  }
  const results = { candidates: 0, sent: 0, skipped: 0, failed: 0, budgetReached: false };
  const attemptedRecipients = new Set<string>();
  // Reuse the existing hourly cron; bounded work, no additional schedule or polling.
  for (const match of rows.flatMap(res => res.data ?? []) as OneOnOneReminderMatch[]) {
    const kind = getOneOnOneReminderKind(match, nowMs, startedAt);
    if (!kind) continue;
    const recipients = kind === "selection_pending_24h" ? [match.candidate_user_id]
      : [...new Set([match.source_user_id, match.candidate_user_id])];
    for (const recipientId of recipients) {
      if (Date.now() - nowMs > 45_000 || results.sent >= 50) {
        results.budgetReached = true;
        return NextResponse.json({ ok: true, results });
      }
      results.candidates++;
      if (attemptedRecipients.has(recipientId)) { results.skipped++; continue; }
      try {
        const result = await sendOneOnOnePendingReminder(admin, match, recipientId, kind, startedAt, nowMs);
        results[result]++;
        if (result === "sent" || result === "failed") attemptedRecipients.add(recipientId);
      } catch (error) {
        attemptedRecipients.add(recipientId);
        results.failed++;
        console.error("[cron 1on1-reminders] delivery failed", { matchId: match.id, error });
      }
    }
  }
  return NextResponse.json({ ok: true, results });
}

import { createAdminClient } from "@/lib/supabase/server";
import { SUPPORT_AUTO_START, triageSupport } from "@/lib/support-triage";

export async function processSupportInquiry(id: string, admin = createAdminClient({ signal: AbortSignal.timeout(12000) })) {
  const result = await admin.from("support_inquiries").select("id,user_id,category,subject,message,status,admin_reply,answered_at,answered_by_user_id,created_at").eq("id", id).maybeSingle();
  if (result.error) throw new Error("support_read_failed");
  const row = result.data;
  if (!row || !row.user_id || row.status !== "open" || row.admin_reply || row.answered_at || row.answered_by_user_id || row.created_at < SUPPORT_AUTO_START) return "skipped";
  const decision = triageSupport(row);
  if (decision.kind !== "simple") return "important";
  // CAS: cron, after() and an operator can race; only the untouched inquiry wins.
  const saved = await admin.from("support_inquiries").update({ status: "answered", admin_reply: decision.draft, answered_at: new Date().toISOString(), answered_by_user_id: null })
    .eq("id", id).eq("status", "open").is("admin_reply", null).is("answered_at", null).is("answered_by_user_id", null)
    .eq("subject", row.subject).eq("message", row.message).eq("category", row.category).select("id").maybeSingle();
  if (saved.error) throw new Error("support_reply_write_failed");
  return saved.data ? "answered" : "skipped";
}

// Registration never awaits this task. All failures leave the original open row
// available to operators and the retry sweep. No email or external model needed.
export function scheduleSupportReply(id: string, schedule: (task: () => Promise<void>) => void) {
  try {
    schedule(async () => {
      try { await processSupportInquiry(id); }
      catch { console.error("[support-auto-reply] deferred_failed", { id }); }
    });
  } catch { console.error("[support-auto-reply] schedule_failed", { id }); }
}

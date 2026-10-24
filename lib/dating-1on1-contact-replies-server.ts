import type { createAdminClient } from "@/lib/supabase/server";
import { parseOneOnOneContactReply, type OneOnOneContactReply } from "@/lib/dating-1on1-contact-reply";

// Optional enrichment only: an absent migration or failed query must not hide matches/phones.
export async function loadOneOnOneContactReplies(admin: ReturnType<typeof createAdminClient>, nudgeIds: string[]) {
  const replies = new Map<string, OneOnOneContactReply>();
  const ids = [...new Set(nudgeIds)];
  if (!ids.length) return { available: false, replies };
  try {
    const signal = AbortSignal.timeout(3000);
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin.from("dating_1on1_contact_nudge_replies")
        .select("nudge_id,preset_key,created_at").in("nudge_id", ids.slice(i, i + 200)).abortSignal(signal);
      if (error) throw error;
      for (const row of data ?? []) {
        const reply = parseOneOnOneContactReply(row);
        if (reply) replies.set(row.nudge_id, reply);
      }
    }
    return { available: true, replies };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (!["42P01", "PGRST205"].includes(code ?? "")) {
      console.error("[contact-nudge/replies] optional lookup failed", { code: code ?? "unavailable" });
    }
    return { available: false, replies: new Map<string, OneOnOneContactReply>() };
  }
}

import type { createAdminClient } from "@/lib/supabase/server";
import { isMissingContactNudgeReadColumn, type OneOnOneContactNudgeItem, type OneOnOneContactNudgePresetKey } from "@/lib/dating-1on1-contact-nudge";

export type ContactNudgeRow = OneOnOneContactNudgeItem & {
  match_id: string;
  sender_user_id: string;
  recipient_user_id: string;
  preset_key: OneOnOneContactNudgePresetKey;
};

// Optional enrichment. Batch UUID filters to stay below gateway URL/header limits.
// At most two messages per match, so 100 match IDs also stays below DB row limits.
export async function loadOneOnOneContactNudges(admin: ReturnType<typeof createAdminClient>, matchIds: string[]) {
  const ids = [...new Set(matchIds)];
  const rows: ContactNudgeRow[] = [];
  let readReceiptsAvailable = true;
  try {
    const signal = AbortSignal.timeout(6000);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const read = () => admin.from("dating_1on1_contact_nudges")
        .select(`id,match_id,sender_user_id,recipient_user_id,preset_key,message_text,created_at${readReceiptsAvailable ? ",read_at" : ""}`)
        .in("match_id", batch).order("created_at", { ascending: false }).order("id").abortSignal(signal);
      let result = await read();
      if (result.error && readReceiptsAvailable && isMissingContactNudgeReadColumn(result.error)) {
        readReceiptsAvailable = false;
        result = await read();
      }
      if (result.error) throw result.error;
      rows.push(...(result.data ?? []) as unknown as ContactNudgeRow[]);
    }
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { available: true, readReceiptsAvailable, rows };
  } catch (error) {
    const rawCode = (error as { code?: unknown } | null)?.code;
    const code = typeof rawCode === "string" && /^[A-Z0-9]{1,20}$/.test(rawCode) ? rawCode : "LOOKUP_FAILED";
    if (!["42P01", "PGRST205"].includes(code)) console.error("[contact-nudge] optional lookup failed", { code });
    // Do not present a partial list as complete or enable sending based on it.
    return { available: false, readReceiptsAvailable: false, rows: [] as ContactNudgeRow[] };
  }
}

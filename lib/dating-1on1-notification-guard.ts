import type { SupabaseClient } from "@supabase/supabase-js";
// Best-effort send-time recheck. Once the provider accepts a message it cannot be recalled.
export async function isCurrentOneOnOneNotification(admin: SupabaseClient, matchId: unknown, type: string, recipientId: string, sourceId?: string) {
  if (!["dating_1on1_selection_received", "dating_1on1_match_accepted"].includes(type)) return true;
  if (typeof matchId !== "string" || !matchId) return false;
  try {
    const { data, error } = await admin.from("dating_1on1_match_proposals")
      .select("source_user_id,candidate_user_id,state,contact_exchange_status").eq("id", matchId).maybeSingle();
    if (error || !data || ![data.source_user_id, data.candidate_user_id].includes(recipientId)) return false;
    if (type === "dating_1on1_selection_received") return data.state === "source_selected" &&
      data.candidate_user_id === recipientId && (!sourceId || data.source_user_id === sourceId);
    return data.state === "mutual_accepted" && data.contact_exchange_status !== "canceled";
  } catch { return false; }
}

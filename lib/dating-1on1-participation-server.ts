import type { SupabaseClient } from "@supabase/supabase-js";

// An existence query over the authenticated sender's full history, including
// canceled/blocked/old-profile requests omitted from the visible matching list.
export async function hasSentOneOnOneRequest(admin: SupabaseClient, userId: string): Promise<boolean | null> {
  try {
    const result = await admin.from("dating_1on1_match_proposals")
      .select("id").eq("source_user_id", userId).not("source_selected_at", "is", null)
      .limit(1).abortSignal(AbortSignal.timeout(2500));
    return result.error || !Array.isArray(result.data) ? null : result.data.length > 0;
  } catch {
    // Optional encouragement must not break profiles, contact disclosure, or login.
    return null;
  }
}

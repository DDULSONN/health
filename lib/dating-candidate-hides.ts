import type { SupabaseClient } from "@supabase/supabase-js";

export const CANDIDATE_HIDES_TABLE = "dating_1on1_candidate_hides";
export const CANDIDATE_HIDE_LIMIT = 500;
export const CANDIDATE_HIDE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type CandidateHide = {
  id: string; candidate_user_id: string; candidate_card_id: string | null;
  candidate_name: string; created_at: string;
};

// Replay a page with the preferences that existed when it was generated.
// Later hides reserve their old slots until the next generation; the caller
// must still remove ALL currently hidden users before returning any profiles.
export function candidateHideUserIdsAt(rows: readonly CandidateHide[], pageAt: number) {
  return new Set(rows.filter(row => {
    const hiddenAt = Date.parse(row.created_at);
    return !Number.isFinite(hiddenAt) || !Number.isFinite(pageAt) || hiddenAt <= pageAt;
  }).map(row => row.candidate_user_id));
}

export async function readCandidateHides(admin: SupabaseClient, userId: string) {
  const result = await admin.from(CANDIDATE_HIDES_TABLE)
    .select("id,candidate_user_id,candidate_card_id,candidate_name,created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(CANDIDATE_HIDE_LIMIT + 1);
  if (result.error && ["42P01", "PGRST205"].includes(result.error.code)) return { available: false, rows: [] as CandidateHide[] };
  if (result.error || !Array.isArray(result.data) || result.data.length > CANDIDATE_HIDE_LIMIT) {
    throw new Error("Candidate hide preferences unavailable");
  }
  return { available: true, rows: result.data as CandidateHide[] };
}

import { DATING_ONE_ON_ONE_MATCH_ACTIVE_PAIR_STATES } from "@/lib/dating-1on1";
import type { createAdminClient } from "@/lib/supabase/server";

export type OneOnOnePairHistory = {
  id: string;
  source_card_id: string;
  candidate_card_id: string;
  source_user_id: string;
  candidate_user_id: string;
  state: string;
  source_selected_at: string | null;
  updated_at: string | null;
  created_at: string;
};

// Both directions and every page: old card IDs and duplicate historical rows
// must not hide a still-active match between these same two members.
export async function fetchOneOnOnePairHistory(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  options: { activeOnly?: boolean; counterpartUserId?: string } = {},
) {
  const directions = await Promise.all((["source_user_id", "candidate_user_id"] as const).map(async (column) => {
    const rows: OneOnOnePairHistory[] = [];
    const other = column === "source_user_id" ? "candidate_user_id" : "source_user_id";
    for (let from = 0; ; from += 500) {
      let query = admin.from("dating_1on1_match_proposals")
        .select("id,source_card_id,candidate_card_id,source_user_id,candidate_user_id,state,source_selected_at,updated_at,created_at")
        .eq(column, userId);
      if (options.activeOnly) query = query.in("state", [...DATING_ONE_ON_ONE_MATCH_ACTIVE_PAIR_STATES]);
      if (options.counterpartUserId) query = query.eq(other, options.counterpartUserId);
      const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(from, from + 499);
      if (error) throw error;
      rows.push(...((data ?? []) as OneOnOnePairHistory[]));
      if ((data ?? []).length < 500) return rows;
    }
  }));
  return directions.flat();
}

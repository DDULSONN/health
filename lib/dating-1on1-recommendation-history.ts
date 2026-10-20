import type { createAdminClient } from "@/lib/supabase/server";
import type { RecommendationPageVisit } from "@/lib/dating-1on1-recommendation-rotation";

export async function readRecommendationHistory(admin: ReturnType<typeof createAdminClient>, userId: string, now: number) {
  const { data, error } = await admin.from("dating_1on1_recommendation_page_history")
    .select("refreshed_at,main_candidate_ids,extra_candidate_ids")
    .eq("user_id", userId).gte("refreshed_at", new Date(now - 30 * 86400000).toISOString())
    .lte("refreshed_at", new Date(now).toISOString())
    .order("refreshed_at", { ascending: false }).limit(64);
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code)) return undefined;
    throw new Error("Recent recommendation pages unavailable");
  }
  return (data ?? []).map(row => ({
    at: Date.parse(row.refreshed_at),
    ids: [...row.main_candidate_ids, ...row.extra_candidate_ids],
  })) as RecommendationPageVisit[];
}

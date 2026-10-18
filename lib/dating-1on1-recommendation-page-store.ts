import type { createAdminClient } from "@/lib/supabase/server";
import { createHash } from "node:crypto";

export type StoredRecommendationPage = {
  source_card_id: string;
  refreshed_at: string;
  source_profile_key: string;
  main_candidate_ids: string[];
  extra_candidate_ids: string[];
};

export function recommendationSourceKey(source: { sex: string; birth_year: number; region: string }) {
  return createHash("md5").update(`${source.sex}:${source.birth_year}:${source.region ?? ""}`, "utf8").digest("hex");
}

// One row per member. Profile IDs and a source-settings fingerprint, never
// photos, contact details or introductions.
// An additive migration keeps old deployments compatible during rollout.
export async function readRecommendationPage(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await admin.from("dating_1on1_recommendation_pages")
    .select("source_card_id,refreshed_at,source_profile_key,main_candidate_ids,extra_candidate_ids")
    .eq("user_id", userId).maybeSingle();
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code)) return { available: false, page: null };
    throw new Error("Saved recommendation page unavailable");
  }
  return { available: true, page: data as StoredRecommendationPage | null };
}

import { after } from "next/server";
import type { createAdminClient } from "@/lib/supabase/server";
import type { RecommendationRefreshPlan } from "@/lib/dating-1on1-recommendation-service";
import { recommendationSourceKey } from "@/lib/dating-1on1-recommendation-page-store";

export type RefreshOutcome = "changed" | "rotated" | "unchanged" | "limited" | "conflict" | "failed";

// Observability must never turn a successful refresh into an error, or retry a
// quota write. A missing migration/failed recorder only loses this observation.
export function recordRefreshAttempt(admin: ReturnType<typeof createAdminClient>, userId: string,
  requestId: string, plan: RecommendationRefreshPlan | undefined, outcome: RefreshOutcome, sourceCardId?: string) {
  if (!plan?.monitor && (outcome !== "failed" || !/^[0-9a-f-]{36}$/i.test(sourceCardId ?? ""))) return;
  const snapshot = plan?.monitor ? {
    id: requestId, user_id: userId, source_card_id: plan.source_card_id,
    expected_refresh_at: plan.expected_refresh_used_at, planned_at: plan.refresh_at,
    source_profile_key: plan.source_profile_key, outcome, persist_page: plan.persist_page,
    changed_count: plan.changed_candidate_count, rotated_count: plan.rotated_candidate_count,
    before_candidate_ids: plan.monitor.before_candidate_ids,
    before_user_ids: plan.monitor.before_user_ids, after_user_ids: plan.monitor.after_user_ids,
    main_candidate_ids: plan.main_candidate_ids, extra_candidate_ids: plan.extra_candidate_ids,
    pool_count: plan.monitor.pool_count, safe_local_change: plan.monitor.safe_local_change,
    widened_count: plan.monitor.widened_count, age_mismatch_count: plan.monitor.age_mismatch_count,
  } : null;
  try {
    after(async () => {
      try {
        let observation = snapshot;
        if (!observation) {
          // Planner/read errors have no trusted plan. Establish ownership before
          // storing a diagnostic; never make these incomplete records repairable.
          const source = await admin.from("dating_1on1_cards")
            .select("id,sex,birth_year,region,recommendation_refresh_used_at").eq("id", sourceCardId!)
            .eq("user_id", userId).in("status", ["submitted", "reviewing", "approved"])
            .abortSignal(AbortSignal.timeout(3000)).maybeSingle();
          if (source.error || !source.data) return;
          observation = { id: requestId, user_id: userId, source_card_id: source.data.id,
            expected_refresh_at: source.data.recommendation_refresh_used_at, planned_at: new Date().toISOString(),
            source_profile_key: recommendationSourceKey(source.data), outcome, persist_page: false,
            changed_count: 0, rotated_count: 0, before_candidate_ids: [], before_user_ids: [], after_user_ids: [],
            main_candidate_ids: [], extra_candidate_ids: [], pool_count: 0, safe_local_change: false,
            widened_count: 0, age_mismatch_count: 0 };
        }
        const result = await admin.from("dating_1on1_refresh_attempts").insert(observation)
          .abortSignal(AbortSignal.timeout(3000));
        if (result.error && !["42P01", "PGRST205", "23505"].includes(result.error.code))
          console.warn("[refresh-monitor] observation not saved", { code: result.error.code });
      } catch { console.warn("[refresh-monitor] observation unavailable"); }
    });
  } catch { /* A response/after-context failure cannot affect a member's refresh. */ }
}

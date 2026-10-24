import { analyzeWithGemini, loadCandidateById, ruleReview } from "@/lib/admin-dating-card-review";
import { addRegistrationReviewFlags, reviewFailure } from "@/lib/dating-auto-review-policy";
import { combineReview } from "@/lib/dating-review";
import { createAdminClient } from "@/lib/supabase/server";
import { getVercelOidcToken } from "@vercel/oidc";

type Job = { source_type: "open_card" | "one_on_one"; card_id: string; revision: string; lease_token: string; payload: Record<string, unknown> };

export async function runAutomaticProfileReviews() {
  const admin = createAdminClient();
  const repaired = await admin.rpc("reconcile_dating_profile_reviews");
  if (repaired.error) throw repaired.error;
  const claimed = await admin.rpc("claim_dating_profile_reviews", { batch_size: 4 });
  if (claimed.error) throw claimed.error;
  const jobs = (claimed.data ?? []) as Job[];
  const results = await Promise.allSettled(jobs.map(async (job) => {
    try {
      const card = await loadCandidateById(admin, job.source_type, job.card_id);
      if (!card) {
        const gone = await admin.from("dating_profile_review_jobs").update({ state: "gone", lease_token: null, lease_until: null })
          .eq("source_type", job.source_type).eq("card_id", job.card_id).eq("revision", job.revision).eq("lease_token", job.lease_token);
        if (gone.error) throw gone.error;
        return "gone";
      }
      const key = process.env.GEMINI_API_KEY;
      // Resolve per invocation so a warm function never retains an expired OIDC token.
      let gatewayToken = process.env.AI_GATEWAY_API_KEY;
      if (!gatewayToken) {
        try { gatewayToken = await getVercelOidcToken(); } catch { /* Local/direct-key deployments. */ }
      }
      const model = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
      const raw = key || gatewayToken ? await analyzeWithGemini(admin, key ?? "", model, card, gatewayToken)
        : combineReview(ruleReview(card), null, ["AI 검수 설정 누락"], { provider: "rules_fallback" });
      // Determine completeness before enriching the result with registered age evidence.
      const failure = reviewFailure(raw);
      const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
      const review = addRegistrationReviewFlags(raw, job.source_type, job.payload, year);
      const finished = await admin.rpc("finish_dating_profile_review", {
        s: job.source_type, c: job.card_id, v: job.revision, token: job.lease_token, review, failure,
      });
      if (finished.error) throw finished.error;
      return finished.data ? (failure ? "retry_or_failed" : "complete") : "superseded";
    } catch {
      const failed = await admin.rpc("finish_dating_profile_review", {
        s: job.source_type, c: job.card_id, v: job.revision, token: job.lease_token,
        review: null, failure: "검수 실행 실패. 자동 재시도 후 관리자 확인이 필요합니다.",
      });
      if (failed.error) throw failed.error;
      return "retry_or_failed";
    }
  }));
  return { claimed: jobs.length, outcomes: results.map(r => r.status === "fulfilled" ? r.value : "storage_error") };
}

import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { loadOneOnOneRecommendations, type RecommendationRefreshPlan } from "@/lib/dating-1on1-recommendation-service";
import { NextResponse } from "next/server";

type RefreshResult = {
  allowed: boolean;
  reason: "consumed" | "stale" | "limit";
  used_count: number;
  remaining_count: number;
  refreshed_at: string | null;
  next_refresh_at: string | null;
};

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const sourceCardId = typeof body?.source_card_id === "string" ? body.source_card_id.trim() : "";
  if (!sourceCardId) return NextResponse.json({ error: "Source card id is required." }, { status: 400 });

  const admin = createAdminClient();
  try {
    // Read once, simulate with the exact seed the transaction will persist.
    // No client-supplied candidate IDs, counts, timestamps or quota are trusted.
    const response = await loadOneOnOneRecommendations(admin, user, { sourceCardId, at: new Date().toISOString() });
    if (!response.ok) return response;
    const { plan } = await response.json() as { plan?: RecommendationRefreshPlan };
    if (!plan || plan.source_card_id !== sourceCardId) {
      return NextResponse.json({ error: "현재 사용 중인 1:1 프로필을 다시 확인해 주세요." }, { status: 409 });
    }
    if (plan.refresh_remaining === 0) {
      return NextResponse.json({
        error: `후보 새로고침은 최근 24시간 동안 ${plan.refresh_limit}회까지 가능합니다.`,
        refresh_limit: plan.refresh_limit, refresh_used_count: plan.refresh_used_count,
        refresh_remaining: 0, next_refresh_at: plan.next_refresh_at,
      }, { status: 409 });
    }
    if (plan.changed_candidate_count === 0) {
      // A read-only no-op: do not rotate the seed, insert history, or alter timestamps.
      // Pre-deployment tabs interpret every 200 as one consumed use. Refuse with
      // an explicit no-charge notice until that old client reloads its code.
      if (body?.refresh_contract !== 2) {
        return NextResponse.json({ error: "후보 명단이 바뀌지 않아 횟수를 사용하지 않았어요. 화면을 새로고침한 뒤 확인해 주세요.",
          code: "REFRESH_UNCHANGED", refresh_consumed: false, refresh_remaining: plan.refresh_remaining,
        }, { status: 409 });
      }
      return NextResponse.json({
        ok: true, source_card_id: sourceCardId, refresh_consumed: false, changed_candidate_count: 0,
        refresh_used_at: plan.expected_refresh_used_at, refresh_limit: plan.refresh_limit,
        refresh_used_count: plan.refresh_used_count, refresh_remaining: plan.refresh_remaining,
        next_refresh_at: plan.next_refresh_at, plus_active: plan.plus_active,
      });
    }

    const result = await admin.rpc("consume_dating_1on1_recommendation_refresh_checked", {
      p_card_id: sourceCardId, p_user_id: user.id, p_limit: plan.refresh_limit,
      p_expected_refresh_at: plan.expected_refresh_used_at, p_refresh_at: plan.refresh_at,
    });
    if (result.error) throw result.error;
    const row = (Array.isArray(result.data) ? result.data[0] : result.data) as RefreshResult | null;
    if (!row || typeof row.allowed !== "boolean") throw new Error("Invalid refresh transaction result");
    if (!row.allowed) {
      return NextResponse.json({
        error: row.reason === "stale"
          ? "다른 화면에서 후보가 갱신됐습니다. 명단을 다시 불러온 뒤 확인해 주세요."
          : `후보 새로고침은 최근 24시간 동안 ${plan.refresh_limit}회까지 가능합니다.`,
        code: row.reason === "stale" ? "REFRESH_PLAN_CHANGED" : "REFRESH_LIMIT",
        refresh_limit: plan.refresh_limit, refresh_used_count: row.used_count,
        refresh_remaining: row.remaining_count, next_refresh_at: row.next_refresh_at,
      }, { status: 409 });
    }
    if (row.reason !== "consumed" || Date.parse(row.refreshed_at ?? "") !== Date.parse(plan.refresh_at)) {
      throw new Error("Refresh seed was not persisted as planned");
    }
    return NextResponse.json({
      ok: true, source_card_id: sourceCardId, refresh_consumed: true,
      changed_candidate_count: plan.changed_candidate_count, refresh_used_at: row.refreshed_at,
      refresh_limit: plan.refresh_limit, refresh_used_count: row.used_count,
      refresh_remaining: row.remaining_count, next_refresh_at: row.next_refresh_at, plus_active: plan.plus_active,
    });
  } catch (error) {
    console.error("[POST /api/dating/1on1/recommendations/refresh] checked refresh failed", { requestId, error });
    // Never retry an uncertain write through another path: it could consume twice.
    return NextResponse.json({
      error: "후보 새로고침 처리 결과를 확인하지 못했어요. 명단을 다시 불러와 확인해 주세요.",
      code: "REFRESH_CHECK_FAILED", request_id: requestId,
    }, { status: 503 });
  }
}

import { DATING_ONE_ON_ONE_ACTIVE_STATUSES } from "@/lib/dating-1on1";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

type RefreshRecommendationPayload = {
  source_card_id?: string;
};

const RECOMMENDATION_REFRESH_COOLDOWN_MS = 48 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as RefreshRecommendationPayload | null;
  const sourceCardId = typeof body?.source_card_id === "string" ? body.source_card_id.trim() : "";
  if (!sourceCardId) {
    return NextResponse.json({ error: "Source card id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const cardRes = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,recommendation_refresh_used_at")
    .eq("id", sourceCardId)
    .maybeSingle();

  if (cardRes.error) {
    console.error("[POST /api/dating/1on1/recommendations/refresh] card fetch failed", cardRes.error);
    return NextResponse.json({ error: "Failed to load source card." }, { status: 500 });
  }
  if (!cardRes.data) {
    return NextResponse.json({ error: "Card not found." }, { status: 404 });
  }
  if (cardRes.data.user_id !== user.id) {
    return NextResponse.json({ error: "Only your own card can refresh recommendations." }, { status: 403 });
  }
  if (!DATING_ONE_ON_ONE_ACTIVE_STATUSES.includes(cardRes.data.status)) {
    return NextResponse.json({ error: "Source card is no longer active." }, { status: 409 });
  }

  const lastRefreshAt = cardRes.data.recommendation_refresh_used_at;
  if (lastRefreshAt) {
    const lastRefreshMs = Date.parse(lastRefreshAt);
    if (Number.isFinite(lastRefreshMs)) {
      const nextRefreshMs = lastRefreshMs + RECOMMENDATION_REFRESH_COOLDOWN_MS;
      if (nextRefreshMs > Date.now()) {
        return NextResponse.json(
          {
            error: "추천 새로고침은 2일에 한 번만 가능합니다.",
            next_refresh_at: new Date(nextRefreshMs).toISOString(),
          },
          { status: 409 }
        );
      }
    }
  }

  const nowIso = new Date().toISOString();
  const updateRes = await admin
    .from("dating_1on1_cards")
    .update({
      recommendation_refresh_used_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", sourceCardId)
    .eq("user_id", user.id)
    .select("id,recommendation_refresh_used_at")
    .maybeSingle();

  if (updateRes.error) {
    console.error("[POST /api/dating/1on1/recommendations/refresh] update failed", updateRes.error);
    return NextResponse.json({ error: "Failed to refresh recommendations." }, { status: 500 });
  }
  if (!updateRes.data) {
    return NextResponse.json({ error: "추천 새로고침 처리에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    source_card_id: sourceCardId,
    refresh_used_at: updateRes.data.recommendation_refresh_used_at ?? nowIso,
  });
}

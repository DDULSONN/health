import { DATING_ONE_ON_ONE_ACTIVE_STATUSES } from "@/lib/dating-1on1";
import {
  ONE_ON_ONE_FREE_REFRESH_LIMIT,
  ONE_ON_ONE_PLUS_REFRESH_LIMIT,
  getActiveOneOnOnePlus,
} from "@/lib/dating-1on1-plus";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type RefreshRecommendationPayload = {
  source_card_id?: string;
};

const RECOMMENDATION_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type RefreshConsumptionRow = {
  allowed?: boolean;
  used_count?: number;
  remaining_count?: number;
  refreshed_at?: string | null;
  next_refresh_at?: string | null;
};

function isMissingRefreshSchema(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("consume_dating_1on1_recommendation_refresh") ||
    message.includes("dating_1on1_recommendation_refresh_events") ||
    message.includes("schema cache")
  );
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
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
    console.error("[POST /api/dating/1on1/recommendations/refresh] card fetch failed", {
      requestId,
      code: cardRes.error.code,
      message: cardRes.error.message,
    });
    return NextResponse.json(
      { error: "1:1 신청서를 불러오지 못했습니다.", code: "SOURCE_CARD_LOAD_FAILED", request_id: requestId },
      { status: 500 }
    );
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

  let activePlus: Awaited<ReturnType<typeof getActiveOneOnOnePlus>>;
  try {
    activePlus = await getActiveOneOnOnePlus(admin, user.id);
  } catch (error) {
    console.error("[POST /api/dating/1on1/recommendations/refresh] plus lookup failed", { requestId, error });
    return NextResponse.json(
      { error: "플러스 이용 상태를 확인하지 못했습니다.", code: "PLUS_LOOKUP_FAILED", request_id: requestId },
      { status: 500 }
    );
  }
  const refreshLimit = activePlus ? ONE_ON_ONE_PLUS_REFRESH_LIMIT : ONE_ON_ONE_FREE_REFRESH_LIMIT;
  const consumeRes = await admin.rpc("consume_dating_1on1_recommendation_refresh", {
    p_card_id: sourceCardId,
    p_user_id: user.id,
    p_limit: refreshLimit,
  });

  if (!consumeRes.error) {
    const row = (Array.isArray(consumeRes.data) ? consumeRes.data[0] : consumeRes.data) as RefreshConsumptionRow | null;
    if (!row?.allowed) {
      return NextResponse.json(
        {
          error: `후보 새로고침은 최근 24시간 동안 ${refreshLimit}회까지 가능합니다.`,
          refresh_limit: refreshLimit,
          refresh_used_count: Number(row?.used_count ?? refreshLimit),
          refresh_remaining: 0,
          next_refresh_at: row?.next_refresh_at ?? null,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      source_card_id: sourceCardId,
      refresh_used_at: row.refreshed_at ?? new Date().toISOString(),
      refresh_limit: refreshLimit,
      refresh_used_count: Number(row.used_count ?? 1),
      refresh_remaining: Number(row.remaining_count ?? Math.max(refreshLimit - 1, 0)),
      next_refresh_at: row.next_refresh_at ?? null,
      plus_active: Boolean(activePlus),
    });
  }

  if (!isMissingRefreshSchema(consumeRes.error)) {
    console.error("[POST /api/dating/1on1/recommendations/refresh] consume failed", {
      requestId,
      code: consumeRes.error.code,
      message: consumeRes.error.message,
      details: consumeRes.error.details,
      hint: consumeRes.error.hint,
    });
    return NextResponse.json(
      { error: "후보 새로고침 처리에 실패했습니다.", code: "REFRESH_CONSUME_FAILED", request_id: requestId },
      { status: 500 }
    );
  }
  if (activePlus) {
    return NextResponse.json(
      { error: "플러스 새로고침 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 }
    );
  }

  // Keep the original one-refresh behavior available during a rolling deployment.
  const lastRefreshAt = cardRes.data.recommendation_refresh_used_at;
  const lastRefreshMs = lastRefreshAt ? Date.parse(lastRefreshAt) : Number.NaN;
  const nextRefreshMs = lastRefreshMs + RECOMMENDATION_REFRESH_COOLDOWN_MS;
  if (Number.isFinite(lastRefreshMs) && nextRefreshMs > Date.now()) {
    return NextResponse.json(
      {
        error: "후보 새로고침은 최근 24시간 동안 1회까지 가능합니다.",
        refresh_limit: ONE_ON_ONE_FREE_REFRESH_LIMIT,
        refresh_used_count: 1,
        refresh_remaining: 0,
        next_refresh_at: new Date(nextRefreshMs).toISOString(),
      },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  const updateRes = await admin
    .from("dating_1on1_cards")
    .update({ recommendation_refresh_used_at: nowIso, updated_at: nowIso })
    .eq("id", sourceCardId)
    .eq("user_id", user.id)
    .select("id,recommendation_refresh_used_at")
    .maybeSingle();
  if (updateRes.error || !updateRes.data) {
    console.error("[POST /api/dating/1on1/recommendations/refresh] legacy update failed", {
      requestId,
      code: updateRes.error?.code,
      message: updateRes.error?.message,
    });
    return NextResponse.json(
      { error: "후보 새로고침 처리에 실패했습니다.", code: "LEGACY_REFRESH_FAILED", request_id: requestId },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    source_card_id: sourceCardId,
    refresh_used_at: updateRes.data.recommendation_refresh_used_at ?? nowIso,
    refresh_limit: ONE_ON_ONE_FREE_REFRESH_LIMIT,
    refresh_used_count: 1,
    refresh_remaining: 0,
    next_refresh_at: new Date(Date.parse(nowIso) + RECOMMENDATION_REFRESH_COOLDOWN_MS).toISOString(),
    plus_active: false,
  });
}

import { verifyImpressionTicket } from "@/lib/dating-1on1-impressions";
import { loadOneOnOneRecommendations } from "@/lib/dating-1on1-recommendation-service";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const generationPattern = /^[0-9a-f]{64}$/;
function json(payload: object, status: number) { return NextResponse.json(payload, { status, headers }); }
function stale() { return json({ code: "SINGLE_REFRESH_STALE", error: "추천 목록을 다시 불러온 뒤 눌러 주세요." }, 409); }

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  const plannedAt = new Date().toISOString();
  const { user } = await getRequestAuthContext(req);
  if (!user) return json({ code: "AUTH_REQUIRED", error: "로그인 상태를 다시 확인해 주세요." }, 401);
  const body = await req.json().catch(() => null);
  const sourceCardId = body?.source_card_id;
  const fromCandidateCardId = body?.candidate_card_id;
  const generationKey = body?.generation_key;
  if (typeof sourceCardId !== "string" || typeof fromCandidateCardId !== "string" ||
    typeof generationKey !== "string" || !generationPattern.test(generationKey)) return stale();
  const ticket = verifyImpressionTicket(body?.impression_ticket, user.id, [fromCandidateCardId]);
  if (!ticket || ticket.source !== sourceCardId) return stale();
  try {
    const limit = await checkRouteRateLimit({
      requestId: crypto.randomUUID(), scope: "dating-one-on-one-single-replace", path: "/api/dating/1on1/recommendations/replace",
      userId: user.id, ip: extractClientIp(req), userLimitPerMin: 8, ipLimitPerMin: 35,
    });
    if (!limit.allowed) return json({ code: "SINGLE_REFRESH_SLOW_DOWN", error: "잠시 후에 다시 눌러 주세요." }, 429);
    const response = await loadOneOnOneRecommendations(createAdminClient(), user, undefined, undefined, {
      sourceCardId, fromCandidateCardId, generationKey, plannedAt,
    });
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  } catch {
    return json({ code: "SINGLE_REFRESH_UNAVAILABLE", error: "새 후보를 확인하지 못했어요. 명단을 먼저 확인해 주세요." }, 503);
  }
}

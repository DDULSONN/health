import { verifyImpressionTicket } from "@/lib/dating-1on1-impressions";
import { probeOneOnOneRegistrationAfterDeck } from "@/lib/dating-1on1-passive-availability";
import { loadOneOnOneRecommendations } from "@/lib/dating-1on1-recommendation-service";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const generationPattern = /^[0-9a-f]{64}$/;
const cardIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const checkedThroughHeader = "X-Jimtul-Candidate-Checked-Through";
function json(payload: object, status: number) { return NextResponse.json(payload, { status, headers }); }
function stale() { return json({ code: "SINGLE_REFRESH_STALE", error: "추천 목록을 다시 불러온 뒤 눌러 주세요." }, 409); }
function privateResponse(response: Response) {
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

export async function GET(req: Request) {
  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) return json({ code: "AUTH_REQUIRED", error: "로그인 상태를 다시 확인해 주세요." }, 401);
    const { searchParams } = new URL(req.url);
    const sourceCardId = searchParams.get("source_card_id") ?? "";
    const generationKey = searchParams.get("generation_key") ?? "";
    if (!cardIdPattern.test(sourceCardId) || !generationPattern.test(generationKey)) return stale();
    const priorCandidate = searchParams.get("probe_candidate_id");
    const receipt = req.headers.get("X-Jimtul-Candidate-Receipt");
    const ticket = priorCandidate && receipt ? verifyImpressionTicket(receipt, user.id, [priorCandidate]) : null;
    if ((priorCandidate || receipt) && (!ticket || ticket.source !== sourceCardId)) return stale();
    const limit = await checkRouteRateLimit({
      requestId: crypto.randomUUID(), scope: "dating-one-on-one-single-availability", path: "/api/dating/1on1/recommendations/replace",
      userId: user.id, ip: extractClientIp(req), userLimitPerMin: 2, ipLimitPerMin: 35,
    });
    if (!limit.allowed) {
      const response = json({ code: "SINGLE_REFRESH_SLOW_DOWN" }, 429);
      if (limit.retryAfterSec > 0) response.headers.set("Retry-After", String(limit.retryAfterSec));
      return response;
    }
    const admin = createAdminClient();
    const now = Date.now();
    const checked = (response: Response) => {
      if (ticket && response.status === 200) response.headers.set(checkedThroughHeader, String(now));
      return response;
    };
    if (ticket) {
      // A later cutoff can only skip this member's optional hint. It never
      // grants a read, changes a deck or affects the POST replacement path.
      const seenThrough = req.headers.get(checkedThroughHeader) ?? "";
      const cutoff = /^\d{13}$/.test(seenThrough) && Number(seenThrough) >= ticket.issued &&
        Number(seenThrough) <= now ? Number(seenThrough) : ticket.issued;
      const result = await probeOneOnOneRegistrationAfterDeck(admin, {
        userId: user.id, sourceCardId, issuedAt: cutoff, now, signal: req.signal,
      });
      if (result === "stale") return stale();
      if (result === "ineligible") return json({ code: "SINGLE_REFRESH_INELIGIBLE" }, 403);
      if (result === "unavailable") return json({ code: "SINGLE_REFRESH_UNAVAILABLE" }, 503);
      if (result === "unchanged") return checked(json({ available: false, generation_key: generationKey }, 200));
    }
    return checked(privateResponse(await loadOneOnOneRecommendations(admin, user, undefined, undefined, {
      mode: "availability", sourceCardId, generationKey, plannedAt: new Date(now).toISOString(),
      signal: req.signal, previousCandidateCardIds: ticket?.cards,
    })));
  } catch {
    return json({ code: "SINGLE_REFRESH_UNAVAILABLE" }, 503);
  }
}

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
      mode: "replace", sourceCardId, fromCandidateCardId, generationKey, plannedAt, signal: req.signal,
    });
    return privateResponse(response);
  } catch {
    return json({ code: "SINGLE_REFRESH_UNAVAILABLE", error: "새 후보를 확인하지 못했어요. 명단을 먼저 확인해 주세요." }, 503);
  }
}

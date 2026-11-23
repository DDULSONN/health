import { NextResponse } from "next/server";
import { getLovePassStatus, getLovePassViewer, isLovePassAreaList, listLovePassNearbyCards, readLovePassStatus } from "@/lib/dating-love-pass-access";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
function json(body: object, status = 200) { return NextResponse.json(body, { status, headers }); }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("availability") === "1") {
    try {
      const sale = await createAdminClient().rpc("dating_love_pass_ready");
      return json({ saleAvailable: !sale.error && sale.data === true });
    } catch { return json({ saleAvailable: false }); }
  }
  const { user } = await getRequestAuthContext(req);
  if (!user) return json({ loggedIn: false, saleAvailable: false, pass: null });
  const admin = createAdminClient();
  try {
    const [sale, pass, viewer] = await Promise.all([
      admin.rpc("dating_love_pass_ready"), getLovePassStatus(admin, user.id), getLovePassViewer(admin, user.id),
    ]);
    const saleAvailable = !sale.error && sale.data === true;
    const eligibility = saleAvailable && !pass ? await admin.rpc("get_dating_love_pass_purchase_eligible", { p_user_id: user.id }) : null;
    const viewing = searchParams.get("cards") === "1";
    if (viewing && pass && pass.areas.length > 0) {
      const limited = await checkRouteRateLimit({ requestId: crypto.randomUUID(), scope: "dating-love-pass-nearby", path: "/api/dating/love-pass", userId: user.id,
        ip: extractClientIp(req), userLimitPerMin: 20, ipLimitPerMin: 80 });
      if (!limited.allowed) return json({ error: "잠시 후 지역 카드를 다시 확인해 주세요." }, 429);
    }
    const items = viewing && pass && viewer.verified && viewer.targetSex && pass.areas.length > 0
      ? await listLovePassNearbyCards(admin, user.id, pass, viewer.targetSex) : [];
    const canPublish = Boolean(pass && pass.publicationsRemaining > 0 && (!pass.nextPublicationAt || Date.parse(pass.nextPublicationAt) <= Date.now()));
    return json({ loggedIn: true, saleAvailable, purchaseEligible: eligibility?.data === true && !eligibility.error, canPublish,
      verified: viewer.verified, pass, ownCard: viewer.verified ? viewer.ownCard : null, items });
  } catch {
    return json({ error: "연애 패스 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
  }
}

export async function POST(req: Request) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;
  const { user } = await getRequestAuthContext(req);
  if (!user) return json({ error: "로그인이 필요해요." }, 401);
  const requestId = crypto.randomUUID();
  const limited = await checkRouteRateLimit({ requestId, scope: "dating-love-pass-change", path: "/api/dating/love-pass", userId: user.id,
    ip: extractClientIp(req), userLimitPerMin: 15, ipLimitPerMin: 45 });
  if (!limited.allowed) return json({ error: "잠시 후 다시 시도해 주세요." }, 429);
  const body = await req.json().catch(() => null) as { action?: unknown; areas?: unknown; cardId?: unknown } | null;
  const admin = createAdminClient();
  try {
    const [pass, viewer] = await Promise.all([getLovePassStatus(admin, user.id), getLovePassViewer(admin, user.id)]);
    if (!pass || !viewer.verified) return json({ error: "이용 중인 연애 패스와 휴대폰 인증이 필요해요." }, 403);
    if (body?.action === "areas") {
      if (!isLovePassAreaList(body.areas)) return json({ error: "관심 지역은 두 곳까지 골라 주세요." }, 400);
      const result = await admin.rpc("set_dating_love_pass_areas", { p_user_id: user.id, p_areas: body.areas });
      if (result.error || !readLovePassStatus(result.data)) return json({ error: "지역을 저장하지 못했어요. 다시 시도해 주세요." }, 409);
      return json({ ok: true });
    }
    if (body?.action === "publish" && typeof body.cardId === "string" && body.cardId === viewer.ownCard?.id) {
      const { data, error } = await admin.rpc("publish_dating_love_pass_card", { p_user_id: user.id, p_card_id: body.cardId });
      if (error?.message === "CARD_REVIEW_REQUIRED") return json({ error: "카드 검수가 끝나면 바로 공개할 수 있어요. 아직 횟수는 쓰지 않았어요." }, 409);
      if (error || !data) return json({ error: "지금 공개할 수 없어요. 공개 횟수와 카드 상태를 확인해 주세요." }, 409);
      return json({ ok: true });
    }
    return json({ error: "카드나 요청 내용을 확인해 주세요." }, 400);
  } catch {
    return json({ error: "연애 패스 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
  }
}

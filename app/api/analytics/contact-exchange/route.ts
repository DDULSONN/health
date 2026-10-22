import { NextResponse } from "next/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeOneOnOneMatchId, canOfferOneOnOneContact } from "@/lib/dating-1on1-match-navigation";

const skip = () => new NextResponse(null, { status: 204 });
const unavailable = () => NextResponse.json({ recorded: false }, { status: 503 });

export async function POST(request: Request) {
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;
  try {
    const raw = await request.text();
    if (raw.length > 512) return new NextResponse(null, { status: 400 });
    let body;
    try { body = JSON.parse(raw); } catch { return new NextResponse(null, { status: 400 }); }
    const matchId = normalizeOneOnOneMatchId(body?.matchId);
    if (!matchId || !["view_item", "select_item"].includes(body?.eventName) ||
        !["one_on_one_home", "mypage_matching"].includes(body?.placement) ||
        ![15000, 18000, 20000].includes(body?.amount) || typeof body?.sessionId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{4}-\d{2}-\d{2}$/i.test(body.sessionId)) {
      return new NextResponse(null, { status: 400 });
    }
    const { user } = await getRequestAuthContext(request);
    if (!user) return skip();
    const admin = createAdminClient();
    const match = await admin.from("dating_1on1_match_proposals")
      .select("source_user_id,candidate_user_id,state,contact_exchange_status")
      .eq("id", matchId).abortSignal(AbortSignal.timeout(4000)).maybeSingle();
    if (match.error) return unavailable();
    if (!match.data || ![match.data.source_user_id, match.data.candidate_user_id].includes(user.id) ||
        !canOfferOneOnOneContact(match.data)) return skip();
    // Diagnostics cannot charge, approve, reveal, or change an order/match.
    // Amount is the displayed client price, never a payment authorization.
    const result = await admin.from("payment_funnel_events").upsert({
      user_id: user.id, session_id: body.sessionId, match_id: matchId,
      event_name: body.eventName, product_type: "one_on_one_contact_exchange",
      item_name: "1:1 연락처 교환", amount: body.amount, placement: body.placement,
    }, { onConflict: "user_id,session_id,match_id,event_name,placement", ignoreDuplicates: true })
      .abortSignal(AbortSignal.timeout(4000));
    if (result.error) {
      console.warn("[contact-payment-funnel] storage unavailable", { code: result.error.code });
      return unavailable();
    }
    return NextResponse.json({ recorded: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return unavailable();
  }
}

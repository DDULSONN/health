import { NextResponse } from "next/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

const EVENT_NAMES = new Set(["view_item", "select_item"]);

type EventBody = {
  eventName?: unknown;
  itemId?: unknown;
  itemName?: unknown;
  amount?: unknown;
  placement?: unknown;
  sessionId?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("payment_funnel_events");
}

export async function POST(request: Request) {
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;

  const { user } = await getRequestAuthContext(request);
  if (!user) return new NextResponse(null, { status: 204 });

  const body = ((await request.json().catch(() => null)) ?? {}) as EventBody;
  const eventName = cleanText(body.eventName, 40);
  const productType = cleanText(body.itemId, 80);
  const itemName = cleanText(body.itemName, 120);
  const placement = cleanText(body.placement, 80);
  const sessionId = cleanText(body.sessionId, 80);
  const amountValue = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const amount = Number.isFinite(amountValue) ? Math.max(0, Math.round(amountValue)) : 0;

  if (!EVENT_NAMES.has(eventName) || !productType) {
    return NextResponse.json({ ok: false, message: "올바르지 않은 퍼널 이벤트입니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const result = await admin.from("payment_funnel_events").insert({
    user_id: user.id,
    session_id: sessionId || null,
    event_name: eventName,
    product_type: productType,
    item_name: itemName || null,
    amount,
    placement: placement || null,
  });

  if (result.error) {
    // Analytics must never interfere with browsing or checkout. Deployments remain
    // compatible while the optional analytics table is being applied.
    if (!isMissingTableError(result.error)) {
      console.error("[payment-funnel] event insert failed", result.error);
    }
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json({ ok: true });
}

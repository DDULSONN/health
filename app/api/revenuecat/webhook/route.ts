import {
  approvePaidCard,
  grantApplyCredits,
  grantCityViewAccess,
  grantMoreViewAccess,
} from "@/lib/dating-purchase-fulfillment";
import { DATING_STORE_PRODUCT_CATALOG, DATING_STORE_PRODUCT_IDS } from "@/lib/dating-store-products";
import { extractProvinceFromRegion } from "@/lib/region-city";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RevenueCatSubscriberAttribute =
  | {
      value?: string | null;
      updated_at_ms?: number | null;
    }
  | string
  | null
  | undefined;

type RevenueCatEvent = {
  id?: string | null;
  type?: string | null;
  app_user_id?: string | null;
  original_app_user_id?: string | null;
  product_id?: string | null;
  subscriber_attributes?: Record<string, RevenueCatSubscriberAttribute> | null;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function getWebhookSecret() {
  return process.env.REVENUECAT_WEBHOOK_AUTH ?? "";
}

function isAuthorized(req: Request) {
  const expected = getWebhookSecret();
  if (!expected) return false;
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  return authHeader === expected;
}

function pickEvent(payload: unknown): RevenueCatEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const top = payload as Record<string, unknown>;
  if (top.event && typeof top.event === "object") {
    return top.event as RevenueCatEvent;
  }
  return top as RevenueCatEvent;
}

function readSubscriberAttribute(event: RevenueCatEvent, key: string): string {
  const raw = event.subscriber_attributes?.[key];
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object" && typeof raw.value === "string") return raw.value.trim();
  return "";
}

async function markEventStatus(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  status: "fulfilled" | "ignored" | "failed",
  note?: string | null
) {
  await admin
    .from("revenuecat_webhook_events")
    .update({
      status,
      processed_at: new Date().toISOString(),
      note: note ?? null,
    })
    .eq("event_id", eventId);
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    if (!getWebhookSecret()) {
      return json(503, {
        ok: false,
        code: "WEBHOOK_SECRET_MISSING",
        requestId,
        message: "REVENUECAT_WEBHOOK_AUTH is not configured.",
      });
    }
    if (!isAuthorized(req)) {
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "Unauthorized" });
    }

    const payload = await req.json().catch(() => null);
    const event = pickEvent(payload);
    if (!event) {
      return json(400, { ok: false, code: "INVALID_PAYLOAD", requestId, message: "Invalid webhook payload" });
    }

    const eventId = String(event.id ?? "").trim();
    const eventType = String(event.type ?? "").trim();
    const productId = String(event.product_id ?? "").trim();
    const appUserId = String(event.app_user_id ?? event.original_app_user_id ?? "").trim();

    if (!eventId || !eventType) {
      return json(400, { ok: false, code: "INVALID_EVENT", requestId, message: "Event id/type is required" });
    }

    const admin = createAdminClient();
    const insertRes = await admin
      .from("revenuecat_webhook_events")
      .insert({
        event_id: eventId,
        event_type: eventType,
        app_user_id: appUserId || null,
        product_id: productId || null,
        status: "processing",
        raw_payload: payload,
      });

    if (insertRes.error) {
      const duplicate = String(insertRes.error.code ?? "") === "23505";
      if (duplicate) {
        return json(200, {
          ok: true,
          code: "DUPLICATE",
          requestId,
          eventId,
        });
      }
      console.error(`[revenuecat-webhook] ${requestId} event log insert failed`, insertRes.error);
      return json(500, {
        ok: false,
        code: "EVENT_LOG_FAILED",
        requestId,
        message: "Failed to persist webhook event",
      });
    }

    if (eventType === "TEST") {
      await markEventStatus(admin, eventId, "ignored", "test event");
      return json(200, { ok: true, code: "TEST", requestId, eventId });
    }

    if (eventType !== "NON_RENEWING_PURCHASE" && eventType !== "INITIAL_PURCHASE") {
      await markEventStatus(admin, eventId, "ignored", `ignored type=${eventType}`);
      return json(200, {
        ok: true,
        code: "IGNORED",
        requestId,
        eventId,
        eventType,
      });
    }

    if (!appUserId) {
      await markEventStatus(admin, eventId, "failed", "missing app_user_id");
      return json(400, {
        ok: false,
        code: "APP_USER_ID_REQUIRED",
        requestId,
        eventId,
        message: "RevenueCat app_user_id is required",
      });
    }

    const catalogItem = productId ? DATING_STORE_PRODUCT_CATALOG[productId as keyof typeof DATING_STORE_PRODUCT_CATALOG] : null;
    if (!catalogItem) {
      await markEventStatus(admin, eventId, "ignored", `unmapped product=${productId}`);
      return json(200, {
        ok: true,
        code: "UNMAPPED_PRODUCT",
        requestId,
        eventId,
        productId,
      });
    }

    const note = `source=revenuecat product=${productId} event=${eventId}`;

    if (productId === DATING_STORE_PRODUCT_IDS.applyCredits5) {
      const result = await grantApplyCredits(admin, appUserId, 5);
      await markEventStatus(admin, eventId, "fulfilled", `credits=${result.addedCredits}`);
      return json(200, {
        ok: true,
        code: "FULFILLED",
        requestId,
        eventId,
        productId,
        result,
      });
    }

    if (productId === DATING_STORE_PRODUCT_IDS.nearbyIdeal3h) {
      const provinceRaw = readSubscriberAttribute(event, "dating_nearby_province");
      const province = extractProvinceFromRegion(provinceRaw) ?? provinceRaw;
      if (!province) {
        await markEventStatus(admin, eventId, "failed", "missing dating_nearby_province");
        return json(400, {
          ok: false,
          code: "MISSING_CONTEXT",
          requestId,
          eventId,
          message: "dating_nearby_province subscriber attribute is required",
        });
      }

      const result = await grantCityViewAccess(admin, {
        userId: appUserId,
        city: province,
        accessHours: 3,
        note,
        bonusCredits: 1,
      });
      await markEventStatus(admin, eventId, "fulfilled", `province=${province}`);
      return json(200, {
        ok: true,
        code: "FULFILLED",
        requestId,
        eventId,
        productId,
        result,
      });
    }

    if (productId === DATING_STORE_PRODUCT_IDS.moreView3h) {
      const sexRaw = readSubscriberAttribute(event, "dating_more_view_sex");
      const sex = sexRaw === "female" ? "female" : sexRaw === "male" ? "male" : "";
      if (!sex) {
        await markEventStatus(admin, eventId, "failed", "missing dating_more_view_sex");
        return json(400, {
          ok: false,
          code: "MISSING_CONTEXT",
          requestId,
          eventId,
          message: "dating_more_view_sex subscriber attribute is required",
        });
      }

      const result = await grantMoreViewAccess(admin, {
        userId: appUserId,
        sex,
        accessHours: 3,
        note,
        bonusCredits: 1,
      });
      await markEventStatus(admin, eventId, "fulfilled", `sex=${sex}`);
      return json(200, {
        ok: true,
        code: "FULFILLED",
        requestId,
        eventId,
        productId,
        result,
      });
    }

    if (productId === DATING_STORE_PRODUCT_IDS.instantOpenCard) {
      const paidCardId = readSubscriberAttribute(event, "dating_paid_card_id");
      if (!paidCardId) {
        await markEventStatus(admin, eventId, "failed", "missing dating_paid_card_id");
        return json(400, {
          ok: false,
          code: "MISSING_CONTEXT",
          requestId,
          eventId,
          message: "dating_paid_card_id subscriber attribute is required",
        });
      }

      const result = await approvePaidCard(admin, {
        paidCardId,
        displayMode: "instant_public",
      });

      if (!result) {
        await markEventStatus(admin, eventId, "failed", `pending card not found paidCardId=${paidCardId}`);
        return json(404, {
          ok: false,
          code: "PAID_CARD_NOT_FOUND",
          requestId,
          eventId,
          message: "Pending paid card not found",
        });
      }

      await markEventStatus(admin, eventId, "fulfilled", `paidCardId=${paidCardId}`);
      return json(200, {
        ok: true,
        code: "FULFILLED",
        requestId,
        eventId,
        productId,
        result,
      });
    }

    await markEventStatus(admin, eventId, "ignored", `unhandled product=${productId}`);
    return json(200, {
      ok: true,
      code: "IGNORED",
      requestId,
      eventId,
      productId,
    });
  } catch (error) {
    console.error(`[revenuecat-webhook] ${requestId} unhandled`, error);
    return json(500, {
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
      requestId,
      message: "Server error",
    });
  }
}

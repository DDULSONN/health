import { NextResponse } from "next/server";
import { buildAppleNotificationEventKey, verifyAppleServerNotification } from "@/lib/apple-store-notifications";
import { syncAppleSwipeSubscription } from "@/lib/apple-swipe-subscription";
import { DATING_STORE_PRODUCT_IDS } from "@/lib/dating-store-products";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function findUserId(
  admin: ReturnType<typeof createAdminClient>,
  appAccountToken: string,
  originalTransactionId: string,
  transactionId: string
) {
  if (isUuid(appAccountToken)) {
    const userRes = await admin.auth.admin.getUserById(appAccountToken);
    if (!userRes.error && userRes.data.user?.id) return userRes.data.user.id;
  }

  for (const [column, value] of [
    ["original_transaction_id", originalTransactionId],
    ["transaction_id", transactionId],
  ] as const) {
    if (!value) continue;
    const eventRes = await admin
      .from("app_purchase_events")
      .select("user_id")
      .eq(column, value)
      .not("user_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eventRes.error) throw eventRes.error;
    if (eventRes.data?.user_id) return String(eventRes.data.user_id);
  }
  return "";
}

async function updateEvent(
  admin: ReturnType<typeof createAdminClient>,
  eventKey: string,
  payload: Record<string, unknown>
) {
  const result = await admin.from("app_purchase_events").update(payload).eq("event_key", eventKey);
  if (result.error) throw result.error;
}

export async function GET() {
  return json(200, { ok: true, service: "app-store-server-notifications-v2" });
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  let eventKey = "";

  try {
    const body = await req.json().catch(() => null);
    const signedPayload = readString(body && typeof body === "object" ? (body as Record<string, unknown>).signedPayload : null);
    if (!signedPayload) {
      return json(400, { ok: false, code: "SIGNED_PAYLOAD_REQUIRED", requestId });
    }

    let verified;
    try {
      verified = await verifyAppleServerNotification(signedPayload);
    } catch (error) {
      console.error("[app-store-notifications] signature verification failed", { requestId, error });
      return json(400, { ok: false, code: "INVALID_SIGNATURE", requestId });
    }

    const { notification, transaction, renewal, environment } = verified;
    const notificationType = readString(notification.notificationType) || "UNKNOWN";
    const notificationUUID = readString(notification.notificationUUID);
    const productId = readString(transaction?.productId) || "__apple_notification__";
    const transactionId = readString(transaction?.transactionId);
    const originalTransactionId = readString(transaction?.originalTransactionId || renewal?.originalTransactionId);
    const signedDate = Number(notification.signedDate ?? transaction?.signedDate ?? renewal?.signedDate ?? Date.now());
    eventKey = buildAppleNotificationEventKey(notificationUUID, signedPayload);

    const admin = createAdminClient();
    const insertRes = await admin.from("app_purchase_events").insert({
      event_key: eventKey,
      platform: "ios",
      store: "app_store",
      user_id: null,
      product_id: productId,
      purchase_token: null,
      transaction_id: transactionId || null,
      original_transaction_id: originalTransactionId || null,
      status: "processing",
      verified: true,
      context_json: {
        source: "app_store_server_notifications_v2",
        environment,
        notificationType,
        subtype: notification.subtype ?? null,
      },
      verification_json: {
        notification,
        transaction,
        renewal,
      },
      raw_payload: {
        notificationDedupKey: eventKey,
      },
    });

    if (insertRes.error && String(insertRes.error.code ?? "") === "23505") {
      return json(200, { ok: true, code: "DUPLICATE", requestId, eventKey });
    }
    if (insertRes.error) throw insertRes.error;

    if (notificationType === "TEST") {
      await updateEvent(admin, eventKey, {
        status: "ignored",
        processed_at: new Date().toISOString(),
        note: `verified App Store test notification environment=${environment}`,
      });
      return json(200, { ok: true, code: "TEST_VERIFIED", requestId, eventKey });
    }

    if (!transaction || !transactionId || !originalTransactionId) {
      await updateEvent(admin, eventKey, {
        status: "ignored",
        processed_at: new Date().toISOString(),
        note: `ignored notification without transaction type=${notificationType}`,
      });
      return json(200, { ok: true, code: "NO_TRANSACTION", requestId, eventKey });
    }

    if (productId !== DATING_STORE_PRODUCT_IDS.swipePremium30d) {
      await updateEvent(admin, eventKey, {
        status: "ignored",
        processed_at: new Date().toISOString(),
        note: `verified unsupported notification product=${productId} type=${notificationType}`,
      });
      return json(200, { ok: true, code: "UNMAPPED_PRODUCT", requestId, eventKey, productId });
    }

    const appAccountToken = readString(transaction.appAccountToken || renewal?.appAccountToken);
    const userId = await findUserId(admin, appAccountToken, originalTransactionId, transactionId);
    if (!userId) {
      await updateEvent(admin, eventKey, {
        status: "failed",
        processed_at: new Date().toISOString(),
        note: `user mapping failed originalTransactionId=${originalTransactionId}`,
      });
      return json(500, { ok: false, code: "USER_NOT_FOUND", requestId, eventKey });
    }

    const syncResult = await syncAppleSwipeSubscription(admin, {
      userId,
      productId,
      originalTransactionId,
      transactionId,
      notificationType,
      status: Number.isFinite(Number(notification.data?.status)) ? Number(notification.data?.status) : null,
      signedDate,
      transaction,
      renewal,
      note: `source=app_store_notification event=${eventKey} type=${notificationType}`,
    });

    await updateEvent(admin, eventKey, {
      user_id: userId,
      status: syncResult.ignored ? "ignored" : "fulfilled",
      fulfilled_at: syncResult.ignored ? null : new Date().toISOString(),
      processed_at: new Date().toISOString(),
      note: `type=${notificationType} result=${syncResult.reason}`,
    });

    return json(200, {
      ok: true,
      code: syncResult.ignored ? "IGNORED" : "SYNCED",
      requestId,
      eventKey,
      productId,
      result: syncResult.reason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[app-store-notifications] processing failed", { requestId, eventKey, error });
    if (eventKey) {
      try {
        const admin = createAdminClient();
        await updateEvent(admin, eventKey, {
          status: "failed",
          processed_at: new Date().toISOString(),
          note: message,
        });
      } catch (updateError) {
        console.error("[app-store-notifications] failed to persist error", { requestId, eventKey, updateError });
      }
    }
    return json(500, { ok: false, code: "PROCESSING_FAILED", requestId });
  }
}

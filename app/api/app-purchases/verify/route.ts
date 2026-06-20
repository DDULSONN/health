import { NextResponse } from "next/server";
import {
  buildPurchaseEventKey,
  fulfillDatingStorePurchase,
  verifyDirectStorePurchase,
  type DirectStorePlatform,
} from "@/lib/app-purchases";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";

export const runtime = "nodejs";

type ApiCode =
  | "SUCCESS"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "DUPLICATE_PURCHASE"
  | "ALREADY_FULFILLED"
  | "STORE_VERIFY_FAILED"
  | "INTERNAL_SERVER_ERROR";

function json(status: number, code: ApiCode, requestId: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    {
      ok: status >= 200 && status < 300,
      code,
      requestId,
      message,
      ...extra,
    },
    { status }
  );
}

function normalizePlatform(value: unknown): DirectStorePlatform | null {
  return value === "ios" || value === "android" ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  let eventKey = "";

  try {
    const { user } = await getRequestAuthContext(req);
    if (!user?.id) {
      return json(401, "UNAUTHORIZED", requestId, "로그인이 필요합니다.");
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(400, "VALIDATION_ERROR", requestId, "결제 검증 요청 형식이 올바르지 않습니다.");
    }

    const input = body as Record<string, unknown>;
    const platform = normalizePlatform(input.platform);
    const productId = readString(input.productId);
    const purchaseToken = readString(input.purchaseToken) || null;
    const transactionId = readString(input.transactionId) || null;
    const originalTransactionId = readString(input.originalTransactionId) || null;
    const attributes =
      input.attributes && typeof input.attributes === "object"
        ? (input.attributes as Record<string, string | null | undefined>)
        : {};
    const rawPurchase =
      input.rawPurchase && typeof input.rawPurchase === "object"
        ? (input.rawPurchase as Record<string, unknown>)
        : {};

    if (!platform || !productId || (!purchaseToken && !transactionId && !originalTransactionId)) {
      return json(400, "VALIDATION_ERROR", requestId, "platform, productId, 구매 식별값이 필요합니다.");
    }

    eventKey = buildPurchaseEventKey({
      platform,
      purchaseToken,
      transactionId,
      originalTransactionId,
    });

    const admin = createAdminClient();
    const insertRes = await admin.from("app_purchase_events").insert({
      event_key: eventKey,
      platform,
      store: platform === "ios" ? "app_store" : "play_store",
      user_id: user.id,
      product_id: productId,
      purchase_token: purchaseToken,
      transaction_id: transactionId,
      original_transaction_id: originalTransactionId,
      status: "processing",
      verified: false,
      context_json: attributes,
      raw_payload: {
        rawPurchase,
      },
    });

    if (insertRes.error && String(insertRes.error.code ?? "") === "23505") {
      const existingRes = await admin
        .from("app_purchase_events")
        .select("status,fulfilled_at")
        .eq("event_key", eventKey)
        .maybeSingle();

      if (existingRes.error) {
        throw existingRes.error;
      }

      if (existingRes.data?.status === "fulfilled") {
        return json(200, "ALREADY_FULFILLED", requestId, "이미 반영된 결제입니다.", {
          eventKey,
          alreadyFulfilled: true,
          fulfilledAt: existingRes.data.fulfilled_at ?? null,
        });
      }

      if (
        existingRes.data?.status === "failed" ||
        existingRes.data?.status === "ignored" ||
        existingRes.data?.status === "processing"
      ) {
        const retryRes = await admin
          .from("app_purchase_events")
          .update({
            user_id: user.id,
            product_id: productId,
            purchase_token: purchaseToken,
            transaction_id: transactionId,
            original_transaction_id: originalTransactionId,
            status: "processing",
            verified: false,
            context_json: attributes,
            raw_payload: {
              rawPurchase,
            },
            note: `retry requested from ${existingRes.data.status}`,
            processed_at: null,
            fulfilled_at: null,
          })
          .eq("event_key", eventKey)
          .eq("status", existingRes.data.status);

        if (retryRes.error) {
          throw retryRes.error;
        }
      } else {
        return json(409, "DUPLICATE_PURCHASE", requestId, "이미 처리 중인 결제입니다.", {
          eventKey,
          status: existingRes.data?.status ?? "processing",
        });
      }
    } else if (insertRes.error) {
      throw insertRes.error;
    }

    const verified = await verifyDirectStorePurchase({
      platform,
      productId,
      purchaseToken,
      transactionId,
      originalTransactionId,
      rawPurchase,
      attributes,
    });

    const fulfilled = await fulfillDatingStorePurchase(admin, {
      userId: user.id,
      productId: verified.productId,
      platform,
      eventKey: verified.eventKey,
      attributes,
      verificationJson: verified.verificationJson,
    });

    const updateRes = await admin
      .from("app_purchase_events")
      .update({
        status: "fulfilled",
        verified: true,
        purchase_token: verified.purchaseToken,
        transaction_id: verified.transactionId,
        original_transaction_id: verified.originalTransactionId,
        verification_json: verified.verificationJson,
        fulfilled_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
        note: `fulfilled product=${verified.productId}`,
      })
      .eq("event_key", eventKey);

    if (updateRes.error) {
      throw updateRes.error;
    }

    return json(200, "SUCCESS", requestId, "결제가 정상 반영되었습니다.", {
      eventKey,
      productId: verified.productId,
      store: verified.store,
      result: fulfilled,
    });
  } catch (error) {
    if (eventKey) {
      const admin = createAdminClient();
      await admin
        .from("app_purchase_events")
        .update({
          status: "failed",
          processed_at: new Date().toISOString(),
          note: error instanceof Error ? error.message : "unknown error",
        })
        .eq("event_key", eventKey);
    }

    const message = error instanceof Error ? error.message : "결제 검증 처리 중 오류가 발생했습니다.";
    const code = /GOOGLE_PLAY_SERVICE_ACCOUNT_JSON|APPLE_IAP_/i.test(message)
      ? "STORE_VERIFY_FAILED"
      : /결제|purchase|App Store|Google Play|환경변수|transactionId|bundle/i.test(message)
        ? "STORE_VERIFY_FAILED"
        : "INTERNAL_SERVER_ERROR";

    return json(code === "INTERNAL_SERVER_ERROR" ? 500 : 400, code, requestId, message, {
      eventKey: eventKey || null,
    });
  }
}

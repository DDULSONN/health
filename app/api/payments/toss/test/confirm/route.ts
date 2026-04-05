import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { confirmTossTestPayment, getMissingTossTestConfigKeys, isTossTestConfigured } from "@/lib/toss-payments";
import { isAllowedTestPaymentEmail } from "@/lib/test-payment";

type ConfirmBody = {
  paymentKey?: unknown;
  orderId?: unknown;
  amount?: unknown;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function toAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) {
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }
    if (!isAllowedTestPaymentEmail(user.email)) {
      return json(403, { ok: false, code: "FORBIDDEN", requestId, message: "지정된 결제 계정만 사용할 수 있습니다." });
    }
    if (!isTossTestConfigured()) {
      const missingKeys = getMissingTossTestConfigKeys();
      return json(503, {
        ok: false,
        code: "TOSS_NOT_CONFIGURED",
        requestId,
        message: missingKeys.length > 0 ? `누락된 결제 서버 키: ${missingKeys.join(", ")}` : "결제 서버 키가 설정되지 않았습니다.",
      });
    }

    const body = ((await req.json().catch(() => null)) ?? {}) as ConfirmBody;
    const paymentKey = typeof body.paymentKey === "string" ? body.paymentKey.trim() : "";
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const amount = toAmount(body.amount);

    if (!paymentKey || !orderId || amount == null) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "paymentKey, orderId, amount가 필요합니다." });
    }

    const admin = createAdminClient();
    const orderRes = await admin
      .from("toss_test_payment_orders")
      .select("id, user_id, product_type, product_ref_id, toss_order_id, amount, status")
      .eq("toss_order_id", orderId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (orderRes.error || !orderRes.data) {
      return json(404, { ok: false, code: "ORDER_NOT_FOUND", requestId, message: "결제 주문을 찾을 수 없습니다." });
    }
    if (orderRes.data.amount !== amount) {
      return json(400, { ok: false, code: "AMOUNT_MISMATCH", requestId, message: "결제 금액이 주문 정보와 다릅니다." });
    }
    if (orderRes.data.status === "paid") {
      return json(200, {
        ok: true,
        requestId,
        alreadyConfirmed: true,
        productType: orderRes.data.product_type,
        orderId,
      });
    }

    const payment = await confirmTossTestPayment({
      paymentKey,
      orderId,
      amount,
    });

    const updateRes = await admin
      .from("toss_test_payment_orders")
      .update({
        status: "paid",
        payment_key: paymentKey,
        approved_at: payment.approvedAt ?? new Date().toISOString(),
        raw_response: payment,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderRes.data.id)
      .select("id")
      .single();

    if (updateRes.error) {
      console.error("[toss-test-confirm] update failed", updateRes.error);
      return json(500, { ok: false, code: "ORDER_UPDATE_FAILED", requestId, message: "결제 결과 저장에 실패했습니다." });
    }

    let addedCredits = 0;
    let creditsAfter = 0;

    if (orderRes.data.product_type === "apply_credits" && orderRes.data.product_ref_id) {
      const rpcRes = await admin.rpc("approve_apply_credit_order", {
        p_order_id: orderRes.data.product_ref_id,
        p_admin_user_id: user.id,
      });

      if (rpcRes.error) {
        console.error("[toss-test-confirm] approve credit rpc failed", rpcRes.error);
        return json(500, { ok: false, code: "APPLY_CREDIT_APPROVE_FAILED", requestId, message: "지원권 자동 지급에 실패했습니다." });
      }

      const row = Array.isArray(rpcRes.data) ? rpcRes.data[0] : null;
      addedCredits = Number(row?.added_credits ?? 0);
      creditsAfter = Number(row?.credits_after ?? 0);
    }

    return json(200, {
      ok: true,
      requestId,
      orderId,
      paymentKey,
      productType: orderRes.data.product_type,
      amount,
      method: payment.method ?? null,
      addedCredits,
      creditsAfter,
    });
  } catch (error) {
    console.error("[toss-test-confirm] unhandled", error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}

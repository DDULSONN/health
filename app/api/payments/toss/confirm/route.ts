import { NextResponse } from "next/server";
import { grantMoreViewAccess } from "@/lib/dating-purchase-fulfillment";
import { normalizeCardSex } from "@/lib/dating-more-view";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { confirmTossPayment, getMissingTossConfigKeys, isTossConfigured } from "@/lib/toss-payments";

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

    if (!isTossConfigured()) {
      const missingKeys = getMissingTossConfigKeys();
      return json(503, {
        ok: false,
        code: "TOSS_NOT_CONFIGURED",
        requestId,
        message:
          missingKeys.length > 0
            ? `토스 결제 설정 누락: ${missingKeys.join(", ")}`
            : "결제 설정이 아직 완료되지 않았습니다.",
      });
    }

    const body = ((await req.json().catch(() => null)) ?? {}) as ConfirmBody;
    const paymentKey = typeof body.paymentKey === "string" ? body.paymentKey.trim() : "";
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const amount = toAmount(body.amount);

    if (!paymentKey || !orderId || amount == null) {
      return json(400, {
        ok: false,
        code: "VALIDATION_ERROR",
        requestId,
        message: "paymentKey, orderId, amount가 필요합니다.",
      });
    }

    const admin = createAdminClient();
    const orderRes = await admin
      .from("toss_test_payment_orders")
      .select("id,user_id,product_type,product_ref_id,product_meta,toss_order_id,amount,status")
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

    const payment = await confirmTossPayment({ paymentKey, orderId, amount });

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
      console.error("[toss-confirm] update failed", updateRes.error);
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
        console.error("[toss-confirm] approve credit rpc failed", rpcRes.error);
        return json(500, {
          ok: false,
          code: "APPLY_CREDIT_APPROVE_FAILED",
          requestId,
          message: "지원권 자동 지급에 실패했습니다.",
        });
      }

      const row = Array.isArray(rpcRes.data) ? rpcRes.data[0] : null;
      addedCredits = Number(row?.added_credits ?? 0);
      creditsAfter = Number(row?.credits_after ?? 0);
    } else if (orderRes.data.product_type === "more_view") {
      const sex = normalizeCardSex((orderRes.data.product_meta as { sex?: unknown } | null)?.sex);
      if (!sex) {
        return json(500, {
          ok: false,
          code: "MORE_VIEW_METADATA_MISSING",
          requestId,
          message: "이상형 더보기 결제 정보가 올바르지 않습니다.",
        });
      }

      await grantMoreViewAccess(admin, {
        userId: user.id,
        sex,
        accessHours: 3,
        note: `toss payment ${orderId}`,
        bonusCredits: 1,
      });
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
    console.error("[toss-confirm] unhandled", error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}

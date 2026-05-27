import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import { cancelTossPayment, getMissingTossConfigKeys, isTossConfigured } from "@/lib/toss-payments";

type RefundBody = {
  orderId?: unknown;
  cancelReason?: unknown;
  cancelAmount?: unknown;
};

type TossOrderRow = {
  id: string;
  user_id: string;
  toss_order_id: string;
  order_name: string | null;
  amount: number;
  status: string;
  payment_key: string | null;
  raw_response: Record<string, unknown> | null;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function cleanReason(value: unknown) {
  const reason = typeof value === "string" ? value.trim() : "";
  return reason.length > 0 ? reason.slice(0, 200) : "관리자 환불 처리";
}

function parseCancelAmount(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(String(value).replace(/[^\d]/g, ""));
  if (!Number.isFinite(amount)) return null;
  return Math.max(0, Math.floor(amount));
}

function getCancelTotal(payment: { cancels?: Array<{ cancelAmount?: number | null }> }, fallbackAmount: number) {
  const cancels = Array.isArray(payment.cancels) ? payment.cancels : [];
  const total = cancels.reduce((sum, item) => sum + Math.max(Number(item.cancelAmount ?? 0), 0), 0);
  return total > 0 ? total : fallbackAmount;
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  if (!isTossConfigured()) {
    return json(500, {
      ok: false,
      message: `토스 결제 설정이 없습니다. (${getMissingTossConfigKeys().join(", ")})`,
    });
  }

  const body = (await request.json().catch(() => ({}))) as RefundBody;
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const cancelReason = cleanReason(body.cancelReason);
  const requestedCancelAmount = parseCancelAmount(body.cancelAmount);
  const hasCancelAmountInput = body.cancelAmount !== undefined && body.cancelAmount !== null && body.cancelAmount !== "";

  if (!orderId) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "payment_refund",
      targetType: "toss_test_payment_order",
      requestId,
      status: "failure",
      metadata: { reason: "missing_order_id" },
    });
    return json(400, { ok: false, message: "환불할 주문 ID가 필요합니다." });
  }
  if (hasCancelAmountInput && (!requestedCancelAmount || requestedCancelAmount <= 0)) {
    return json(400, { ok: false, message: "부분 환불액은 1원 이상 숫자로 입력해주세요." });
  }

  const orderRes = await auth.admin
    .from("toss_test_payment_orders")
    .select("id,user_id,toss_order_id,order_name,amount,status,payment_key,raw_response")
    .eq("id", orderId)
    .maybeSingle();

  if (orderRes.error) {
    return json(500, { ok: false, message: "결제 주문을 불러오지 못했습니다.", detail: orderRes.error.message });
  }

  const order = orderRes.data as TossOrderRow | null;
  if (!order) {
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "payment_refund",
      targetType: "toss_test_payment_order",
      targetId: orderId,
      requestId,
      status: "failure",
      metadata: { reason: "order_not_found" },
    });
    return json(404, { ok: false, message: "결제 주문을 찾지 못했습니다." });
  }
  if (order.status !== "paid") {
    return json(400, { ok: false, message: "결제 완료 상태의 주문만 환불할 수 있습니다." });
  }
  if (!order.payment_key) {
    return json(400, { ok: false, message: "토스 paymentKey가 없어 자동 환불할 수 없습니다." });
  }

  const cancelAmount =
    requestedCancelAmount && requestedCancelAmount > 0 ? Math.min(requestedCancelAmount, Number(order.amount)) : undefined;
  const idempotencyKey = `admin-refund:${order.id}:${cancelAmount ?? "full"}`;

  try {
    const tossPayment = await cancelTossPayment({
      paymentKey: order.payment_key,
      cancelReason,
      cancelAmount,
      idempotencyKey,
    });

    const canceledTotal = getCancelTotal(tossPayment, cancelAmount ?? Number(order.amount));
    const isFullyCanceled = canceledTotal >= Number(order.amount);
    const canceledAt =
      Array.isArray(tossPayment.cancels) && tossPayment.cancels.length > 0
        ? tossPayment.cancels[tossPayment.cancels.length - 1]?.canceledAt ?? new Date().toISOString()
        : new Date().toISOString();
    const nextRawResponse = {
      ...(order.raw_response ?? {}),
      admin_refund: {
        canceledTotal,
        cancelAmount: cancelAmount ?? Number(order.amount),
        cancelReason,
        canceledAt,
        adminUserId: auth.user.id,
      },
      latest_toss_response: tossPayment,
    };

    const patch = {
      status: isFullyCanceled ? "canceled" : "paid",
      raw_response: nextRawResponse,
      updated_at: new Date().toISOString(),
      canceled_at: canceledAt,
      cancel_reason: cancelReason,
      cancel_amount: canceledTotal,
      canceled_by_user_id: auth.user.id,
    };

    let updateRes = await auth.admin.from("toss_test_payment_orders").update(patch).eq("id", order.id);
    if (updateRes.error && isMissingColumnError(updateRes.error)) {
      updateRes = await auth.admin
        .from("toss_test_payment_orders")
        .update({
          status: isFullyCanceled ? "canceled" : "paid",
          raw_response: nextRawResponse,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
    }

    if (updateRes.error) {
      await recordAdminAuditEvent({
        admin: auth.admin,
        adminUser: auth.user,
        request,
        action: "payment_refund",
        targetType: "toss_test_payment_order",
        targetId: order.id,
        requestId,
        status: "failure",
        metadata: { reason: "order_update_failed", cancelAmount: cancelAmount ?? Number(order.amount), message: updateRes.error.message },
      });
      return json(500, {
        ok: false,
        message: "토스 환불은 완료됐지만 주문 상태 저장에 실패했습니다. 결제센터에서 다시 확인해주세요.",
        detail: updateRes.error.message,
        tossPayment,
      });
    }

    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "payment_refund",
      targetType: "toss_test_payment_order",
      targetId: order.id,
      requestId,
      metadata: {
        cancelAmount: cancelAmount ?? Number(order.amount),
        canceledTotal,
        isFullyCanceled,
        orderUserId: order.user_id,
      },
    });

    return json(200, {
      ok: true,
      message: isFullyCanceled ? "환불이 완료되었습니다." : "부분 환불이 완료되었습니다.",
      orderId: order.id,
      status: isFullyCanceled ? "canceled" : "paid",
      canceledTotal,
      tossPayment,
    });
  } catch (error) {
    let message = "토스 환불 처리에 실패했습니다.";
    if (error instanceof Error) {
      try {
        const parsed = JSON.parse(error.message) as { message?: string; code?: string };
        message = parsed.message ? `${parsed.message}${parsed.code ? ` (${parsed.code})` : ""}` : message;
      } catch {
        message = error.message || message;
      }
    }
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: "payment_refund",
      targetType: "toss_test_payment_order",
      targetId: orderId || null,
      requestId,
      status: "failure",
      metadata: { reason: "toss_cancel_failed", message },
    });
    return json(500, { ok: false, message });
  }
}

import { NextResponse } from "next/server";
import { getActiveMoreViewGrant, normalizeCardSex } from "@/lib/dating-more-view";
import { grantMoreViewAccess } from "@/lib/dating-purchase-fulfillment";
import {
  SWIPE_PREMIUM_DAILY_LIMIT,
  SWIPE_PREMIUM_DURATION_DAYS,
  SWIPE_PREMIUM_PRICE_KRW,
  getSwipeLimitInfo,
} from "@/lib/dating-swipe";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { confirmTossPayment, getMissingTossConfigKeys, isTossConfigured } from "@/lib/toss-payments";

type ConfirmBody = {
  paymentKey?: unknown;
  orderId?: unknown;
  amount?: unknown;
};

type TossOrderRow = {
  id: string;
  user_id: string;
  product_type: "apply_credits" | "paid_card" | "more_view" | "one_on_one_contact_exchange" | "swipe_premium_30d";
  product_ref_id: string | null;
  product_meta: Record<string, unknown> | null;
  toss_order_id: string;
  amount: number;
  status: "ready" | "paid" | "failed" | "canceled";
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

async function ensureApplyCreditsFulfilled(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow,
  actingUserId: string
) {
  if (!order.product_ref_id) {
    return { addedCredits: 0, creditsAfter: 0 };
  }

  const applyOrderRes = await admin
    .from("apply_credit_orders")
    .select("status")
    .eq("id", order.product_ref_id)
    .maybeSingle();

  if (applyOrderRes.error) {
    throw applyOrderRes.error;
  }

  if (applyOrderRes.data?.status === "approved") {
    const creditRes = await admin
      .from("user_apply_credits")
      .select("credits")
      .eq("user_id", order.user_id)
      .maybeSingle();

    return {
      addedCredits: 0,
      creditsAfter: Number(creditRes.data?.credits ?? 0),
    };
  }

  const rpcRes = await admin.rpc("approve_apply_credit_order", {
    p_order_id: order.product_ref_id,
    p_admin_user_id: actingUserId,
  });

  if (rpcRes.error) {
    throw rpcRes.error;
  }

  const row = Array.isArray(rpcRes.data) ? rpcRes.data[0] : null;
  return {
    addedCredits: Number(row?.added_credits ?? 0),
    creditsAfter: Number(row?.credits_after ?? 0),
  };
}

async function ensureMoreViewFulfilled(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow
) {
  const sex = normalizeCardSex((order.product_meta as { sex?: unknown } | null)?.sex);
  if (!sex) {
    throw new Error("MORE_VIEW_METADATA_MISSING");
  }

  const activeGrant = await getActiveMoreViewGrant(admin, order.user_id, sex);
  if (activeGrant) {
    return { sex, alreadyGranted: true };
  }

  await grantMoreViewAccess(admin, {
    userId: order.user_id,
    sex,
    accessHours: 3,
    note: `toss payment ${order.toss_order_id}`,
    bonusCredits: 1,
  });

  return { sex, alreadyGranted: false };
}

async function ensureOneOnOneExchangeFulfilled(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow
) {
  const matchId =
    (typeof order.product_meta?.matchId === "string" ? order.product_meta.matchId.trim() : "") ||
    order.product_ref_id?.trim() ||
    "";

  if (!matchId) {
    throw new Error("ONE_ON_ONE_MATCH_ID_MISSING");
  }

  const matchRes = await admin
    .from("dating_1on1_match_proposals")
    .select("id,source_user_id,candidate_user_id,state,contact_exchange_status")
    .eq("id", matchId)
    .maybeSingle();

  if (matchRes.error) {
    throw matchRes.error;
  }
  if (!matchRes.data) {
    throw new Error("ONE_ON_ONE_MATCH_ID_MISSING");
  }

  const match = matchRes.data as {
    id: string;
    source_user_id: string;
    candidate_user_id: string;
    state: "candidate_accepted" | "mutual_accepted" | string;
    contact_exchange_status: "none" | "awaiting_applicant_payment" | "payment_pending_admin" | "approved" | "canceled" | string;
  };

  const isParticipant = match.source_user_id === order.user_id || match.candidate_user_id === order.user_id;
  if (!isParticipant) {
    throw new Error("ONE_ON_ONE_FORBIDDEN");
  }
  if (!["mutual_accepted", "candidate_accepted"].includes(match.state)) {
    throw new Error("ONE_ON_ONE_NOT_READY");
  }
  if (match.contact_exchange_status === "approved") {
    return { matchId, alreadyApproved: true };
  }
  if (match.contact_exchange_status === "canceled") {
    throw new Error("ONE_ON_ONE_CANCELED");
  }

  const nowIso = new Date().toISOString();
  const approveRes = await admin
    .from("dating_1on1_match_proposals")
    .update({
      state: match.state === "candidate_accepted" ? "mutual_accepted" : match.state,
      contact_exchange_status: "approved",
      contact_exchange_requested_at: nowIso,
      contact_exchange_paid_at: nowIso,
      contact_exchange_paid_by_user_id: order.user_id,
      contact_exchange_approved_at: nowIso,
      contact_exchange_approved_by_user_id: null,
      contact_exchange_note: `toss payment ${order.toss_order_id} | auto-approved`,
      updated_at: nowIso,
    })
    .eq("id", matchId)
    .in("state", ["mutual_accepted", "candidate_accepted"])
    .in("contact_exchange_status", ["none", "awaiting_applicant_payment", "payment_pending_admin"])
    .select("id")
    .maybeSingle();

  if (approveRes.error) {
    throw approveRes.error;
  }
  if (!approveRes.data) {
    const approvedAgain = await admin
      .from("dating_1on1_match_proposals")
      .select("contact_exchange_status")
      .eq("id", matchId)
      .maybeSingle();
    if (approvedAgain.error) {
      throw approvedAgain.error;
    }
    if (approvedAgain.data?.contact_exchange_status === "approved") {
      return { matchId, alreadyApproved: true };
    }
    throw new Error("ONE_ON_ONE_APPROVE_FAILED");
  }

  return { matchId, alreadyApproved: false };
}

async function ensureSwipePremiumFulfilled(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow
) {
  const limitInfo = await getSwipeLimitInfo(admin, order.user_id);
  if (limitInfo.activeSubscription) {
    return { alreadyActive: true };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const durationDays =
    typeof order.product_meta?.durationDays === "number" && Number.isFinite(order.product_meta.durationDays)
      ? Math.max(1, Number(order.product_meta.durationDays))
      : SWIPE_PREMIUM_DURATION_DAYS;
  const dailyLimit =
    typeof order.product_meta?.dailyLimit === "number" && Number.isFinite(order.product_meta.dailyLimit)
      ? Math.max(SWIPE_PREMIUM_DAILY_LIMIT, Number(order.product_meta.dailyLimit))
      : SWIPE_PREMIUM_DAILY_LIMIT;
  const expiresAtIso = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  if (limitInfo.pendingSubscription?.id) {
    const approveRes = await admin
      .from("dating_swipe_subscription_requests")
      .update({
        status: "approved",
        amount: SWIPE_PREMIUM_PRICE_KRW,
        daily_limit: dailyLimit,
        duration_days: durationDays,
        note: `toss payment ${order.toss_order_id} | auto-approved`,
        approved_at: nowIso,
        expires_at: expiresAtIso,
        reviewed_at: nowIso,
        reviewed_by_user_id: null,
        updated_at: nowIso,
      })
      .eq("id", limitInfo.pendingSubscription.id)
      .eq("user_id", order.user_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (approveRes.error) {
      throw approveRes.error;
    }

    if (approveRes.data) {
      return { alreadyActive: false };
    }
  }

  const insertRes = await admin.from("dating_swipe_subscription_requests").insert({
    user_id: order.user_id,
    status: "approved",
    amount: SWIPE_PREMIUM_PRICE_KRW,
    daily_limit: dailyLimit,
    duration_days: durationDays,
    note: `toss payment ${order.toss_order_id} | auto-approved`,
    requested_at: nowIso,
    approved_at: nowIso,
    expires_at: expiresAtIso,
    reviewed_at: nowIso,
    reviewed_by_user_id: null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertRes.error) {
    throw insertRes.error;
  }

  return { alreadyActive: false };
}

async function ensureOrderFulfilled(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow,
  actingUserId: string
) {
  if (order.product_type === "apply_credits") {
    return ensureApplyCreditsFulfilled(admin, order, actingUserId);
  }

  if (order.product_type === "more_view") {
    await ensureMoreViewFulfilled(admin, order);
  }

  if (order.product_type === "one_on_one_contact_exchange") {
    await ensureOneOnOneExchangeFulfilled(admin, order);
  }

  if (order.product_type === "swipe_premium_30d") {
    await ensureSwipePremiumFulfilled(admin, order);
  }

  return { addedCredits: 0, creditsAfter: 0 };
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) {
      return json(401, {
        ok: false,
        code: "UNAUTHORIZED",
        requestId,
        message: "로그인이 필요합니다.",
      });
    }

    if (!isTossConfigured()) {
      const missingKeys = getMissingTossConfigKeys();
      return json(503, {
        ok: false,
        code: "TOSS_NOT_CONFIGURED",
        requestId,
        message:
          missingKeys.length > 0
            ? `토스 결제 설정이 비어 있습니다: ${missingKeys.join(", ")}`
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
      return json(404, {
        ok: false,
        code: "ORDER_NOT_FOUND",
        requestId,
        message: "결제 주문을 찾을 수 없습니다.",
      });
    }

    const order = orderRes.data as TossOrderRow;

    if (order.amount !== amount) {
      return json(400, {
        ok: false,
        code: "AMOUNT_MISMATCH",
        requestId,
        message: "결제 금액이 주문 정보와 다릅니다.",
      });
    }

    if (order.status === "paid") {
      const fulfillment = await ensureOrderFulfilled(admin, order, user.id);
      return json(200, {
        ok: true,
        requestId,
        alreadyConfirmed: true,
        productType: order.product_type,
        orderId,
        addedCredits: fulfillment.addedCredits,
        creditsAfter: fulfillment.creditsAfter,
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
      .eq("id", order.id)
      .select("id")
      .single();

    if (updateRes.error) {
      console.error("[toss-confirm] update failed", updateRes.error);
      return json(500, {
        ok: false,
        code: "ORDER_UPDATE_FAILED",
        requestId,
        message: "결제 결과 저장에 실패했습니다.",
      });
    }

    const fulfillment = await ensureOrderFulfilled(admin, order, user.id);

    return json(200, {
      ok: true,
      requestId,
      orderId,
      paymentKey,
      productType: order.product_type,
      amount,
      method: payment.method ?? null,
      addedCredits: fulfillment.addedCredits,
      creditsAfter: fulfillment.creditsAfter,
    });
  } catch (error) {
    console.error("[toss-confirm] unhandled", error);
    if (error instanceof Error && error.message === "MORE_VIEW_METADATA_MISSING") {
      return json(500, {
        ok: false,
        code: "MORE_VIEW_METADATA_MISSING",
        requestId,
        message: "이상형 더보기 결제 정보가 올바르지 않습니다.",
      });
    }
    if (error instanceof Error && error.message === "ONE_ON_ONE_MATCH_ID_MISSING") {
      return json(500, {
        ok: false,
        code: "ONE_ON_ONE_MATCH_ID_MISSING",
        requestId,
        message: "1:1 번호 교환 결제 대상이 올바르지 않습니다.",
      });
    }
    if (error instanceof Error && error.message === "ONE_ON_ONE_FORBIDDEN") {
      return json(403, {
        ok: false,
        code: "ONE_ON_ONE_FORBIDDEN",
        requestId,
        message: "쌍방 수락된 당사자만 번호 교환 결제를 진행할 수 있습니다.",
      });
    }
    if (error instanceof Error && error.message === "ONE_ON_ONE_NOT_READY") {
      return json(409, {
        ok: false,
        code: "ONE_ON_ONE_NOT_READY",
        requestId,
        message: "쌍방 수락이 완료된 매칭만 번호 교환 결제를 진행할 수 있습니다.",
      });
    }
    if (error instanceof Error && error.message === "ONE_ON_ONE_CANCELED") {
      return json(409, {
        ok: false,
        code: "ONE_ON_ONE_CANCELED",
        requestId,
        message: "취소된 매칭은 번호 교환 결제를 진행할 수 없습니다.",
      });
    }
    return json(500, {
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
      requestId,
      message: "서버 오류가 발생했습니다.",
    });
  }
}

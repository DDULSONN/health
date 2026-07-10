import { NextResponse } from "next/server";
import { CITY_VIEW_ACCESS_HOURS } from "@/lib/dating-city-view";
import { getActiveMoreViewGrant, normalizeCardSex } from "@/lib/dating-more-view";
import {
  approvePaidCard,
  approveCityViewRequest,
  approveMoreViewRequest,
  grantSwipeSubscription,
  grantCityViewAccess,
  grantMoreViewAccess,
} from "@/lib/dating-purchase-fulfillment";
import {
  SWIPE_PREMIUM_DAILY_LIMIT,
  SWIPE_PREMIUM_DURATION_DAYS,
} from "@/lib/dating-swipe";
import { OPEN_CARD_EXPIRE_HOURS } from "@/lib/dating-open";
import { isAllowedAdminUser } from "@/lib/admin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { confirmTossPayment, getMissingTossConfigKeys, isTossConfigured } from "@/lib/toss-payments";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

type ConfirmBody = {
  paymentKey?: unknown;
  orderId?: unknown;
  amount?: unknown;
};

type TossOrderRow = {
  id: string;
  user_id: string;
  product_type:
    | "apply_credits"
    | "paid_card"
    | "more_view"
    | "city_view"
    | "one_on_one_contact_exchange"
    | "one_on_one_priority_24h"
    | "swipe_premium_30d"
    | "love_fortune_detail";
  product_ref_id: string | null;
  product_meta: Record<string, unknown> | null;
  order_name: string | null;
  toss_order_id: string;
  amount: number;
  status: "ready" | "paid" | "failed" | "canceled";
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

const PAYMENT_CARD_UNAVAILABLE_MESSAGE = "현재 국민/우리/현대 카드는 결제가 되지 않습니다. 다른 카드나 다른 결제수단으로 다시 시도해 주세요.";

function toAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function isLoveFortuneTester(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const profileRes = await admin.from("profiles").select("role").eq("user_id", userId).maybeSingle();
  if (!profileRes.error && profileRes.data?.role === "admin") {
    return true;
  }

  const authRes = await admin.auth.admin.getUserById(userId).catch(() => null);
  return isAllowedAdminUser(userId, authRes?.data?.user?.email);
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

  const pendingRes = await admin
    .from("dating_more_view_requests")
    .select("id")
    .eq("user_id", order.user_id)
    .eq("sex", sex)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingRes.error) {
    throw pendingRes.error;
  }

  if (pendingRes.data?.id) {
    await approveMoreViewRequest(admin, {
      requestId: pendingRes.data.id,
      reviewedByUserId: null,
      note: `toss payment ${order.toss_order_id} | auto-approved`,
      accessHours: 3,
      bonusCredits: 1,
    });

    return { sex, alreadyGranted: false };
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

async function ensureCityViewFulfilled(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow
) {
  const province =
    (typeof order.product_meta?.province === "string" ? order.product_meta.province.trim() : "") ||
    (typeof order.product_ref_id === "string" && order.product_ref_id.includes(":")
      ? order.product_ref_id.split(":").slice(1).join(":").trim()
      : "");

  if (!province) {
    throw new Error("CITY_VIEW_PROVINCE_MISSING");
  }

  const activeRes = await admin
    .from("dating_city_view_requests")
    .select("id,access_expires_at")
    .eq("user_id", order.user_id)
    .eq("city", province)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (activeRes.error) {
    throw activeRes.error;
  }

  const hasActiveGrant = (activeRes.data ?? []).some((row) => {
    const expiresAt = row.access_expires_at ? new Date(row.access_expires_at).getTime() : Number.NaN;
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  });

  if (hasActiveGrant) {
    await grantCityViewAccess(admin, {
      userId: order.user_id,
      city: province,
      accessHours: CITY_VIEW_ACCESS_HOURS,
      note: `toss payment ${order.toss_order_id} | next 30 cards`,
      bonusCredits: 1,
    });

    return { province, alreadyGranted: false };
  }

  const pendingRes = await admin
    .from("dating_city_view_requests")
    .select("id")
    .eq("user_id", order.user_id)
    .eq("city", province)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingRes.error) {
    throw pendingRes.error;
  }

  if (pendingRes.data?.id) {
    await approveCityViewRequest(admin, {
      requestId: pendingRes.data.id,
      reviewedByUserId: null,
      note: `toss payment ${order.toss_order_id} | auto-approved`,
      accessHours: CITY_VIEW_ACCESS_HOURS,
      bonusCredits: 1,
    });

    return { province, alreadyGranted: false };
  }

  await grantCityViewAccess(admin, {
    userId: order.user_id,
    city: province,
    accessHours: CITY_VIEW_ACCESS_HOURS,
    note: `toss payment ${order.toss_order_id} | auto-approved`,
    bonusCredits: 1,
  });

  return { province, alreadyGranted: false };
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

async function ensureOneOnOnePriorityFulfilled(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow
) {
  const cardId =
    (typeof order.product_meta?.cardId === "string" ? order.product_meta.cardId.trim() : "") ||
    order.product_ref_id?.trim() ||
    "";

  if (!cardId) {
    throw new Error("ONE_ON_ONE_PRIORITY_CARD_ID_MISSING");
  }

  const cardRes = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,priority_boost_expires_at")
    .eq("id", cardId)
    .maybeSingle();

  if (cardRes.error) {
    throw cardRes.error;
  }
  if (!cardRes.data || cardRes.data.user_id !== order.user_id) {
    throw new Error("ONE_ON_ONE_PRIORITY_CARD_NOT_FOUND");
  }
  if (!["submitted", "reviewing", "approved"].includes(String(cardRes.data.status ?? ""))) {
    throw new Error("ONE_ON_ONE_PRIORITY_CARD_INACTIVE");
  }

  const now = Date.now();
  const currentExpiresAt = cardRes.data.priority_boost_expires_at
    ? new Date(cardRes.data.priority_boost_expires_at).getTime()
    : Number.NaN;
  if (Number.isFinite(currentExpiresAt) && currentExpiresAt > now) {
    return { cardId, alreadyActive: true, expiresAt: cardRes.data.priority_boost_expires_at };
  }

  const durationHours =
    typeof order.product_meta?.durationHours === "number" && Number.isFinite(order.product_meta.durationHours)
      ? Math.max(1, Number(order.product_meta.durationHours))
      : 72;
  const expiresAt = new Date(now + durationHours * 60 * 60 * 1000).toISOString();
  const updateRes = await admin
    .from("dating_1on1_cards")
    .update({ priority_boost_expires_at: expiresAt })
    .eq("id", cardId)
    .eq("user_id", order.user_id)
    .in("status", ["submitted", "reviewing", "approved"])
    .select("id,priority_boost_expires_at")
    .maybeSingle();

  if (updateRes.error) {
    throw updateRes.error;
  }
  if (!updateRes.data?.id) {
    throw new Error("ONE_ON_ONE_PRIORITY_UPDATE_FAILED");
  }

  return { cardId, alreadyActive: false, expiresAt: updateRes.data.priority_boost_expires_at ?? expiresAt };
}

async function ensureSwipePremiumFulfilled(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow
) {
  if (order.product_meta?.swipePremiumFulfilledAt) {
    return { fulfilled: true, alreadyFulfilled: true };
  }

  const durationDays =
    typeof order.product_meta?.durationDays === "number" && Number.isFinite(order.product_meta.durationDays)
      ? Math.max(1, Number(order.product_meta.durationDays))
      : SWIPE_PREMIUM_DURATION_DAYS;
  const dailyLimit =
    typeof order.product_meta?.dailyLimit === "number" && Number.isFinite(order.product_meta.dailyLimit)
      ? Math.max(SWIPE_PREMIUM_DAILY_LIMIT, Number(order.product_meta.dailyLimit))
      : SWIPE_PREMIUM_DAILY_LIMIT;

  await grantSwipeSubscription(admin, {
    userId: order.user_id,
    amount: order.amount,
    dailyLimit,
    durationDays,
    note: `toss payment ${order.toss_order_id} | auto-approved`,
  });

  const metaUpdateRes = await admin
    .from("toss_test_payment_orders")
    .update({
      product_meta: {
        ...(order.product_meta ?? {}),
        swipePremiumFulfilledAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (metaUpdateRes.error) {
    throw metaUpdateRes.error;
  }

  return { fulfilled: true };
}

async function ensurePaidCardFulfilled(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow
) {
  const paidCardId = order.product_ref_id?.trim() ?? "";
  if (!paidCardId) {
    throw new Error("PAID_CARD_ID_MISSING");
  }

  if (order.product_meta?.source === "open_card_reopen") {
    const openCardId =
      (typeof order.product_meta.openCardId === "string" ? order.product_meta.openCardId.trim() : "") ||
      paidCardId;
    if (!openCardId) {
      throw new Error("OPEN_CARD_REOPEN_ID_MISSING");
    }

    const cardRes = await admin
      .from("dating_cards")
      .select("id,owner_user_id,status,published_at,expires_at,auto_requeue_count")
      .eq("id", openCardId)
      .maybeSingle();
    if (cardRes.error) {
      throw cardRes.error;
    }
    if (!cardRes.data) {
      throw new Error("OPEN_CARD_REOPEN_NOT_FOUND");
    }
    if (cardRes.data.owner_user_id !== order.user_id) {
      throw new Error("OPEN_CARD_REOPEN_FORBIDDEN");
    }
    if (cardRes.data.status === "public") {
      const currentExpiresAt = cardRes.data.expires_at ? new Date(cardRes.data.expires_at).getTime() : 0;
      if (Number.isFinite(currentExpiresAt) && currentExpiresAt > Date.now()) {
        return { alreadyApproved: true };
      }
    }
    if (!["pending", "hidden", "expired", "public"].includes(String(cardRes.data.status ?? ""))) {
      throw new Error("OPEN_CARD_REOPEN_STATUS_INVALID");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + OPEN_CARD_EXPIRE_HOURS * 60 * 60 * 1000).toISOString();
    const updateRes = await admin
      .from("dating_cards")
      .update({
        status: "public",
        published_at: now.toISOString(),
        expires_at: expiresAt,
        created_at: now.toISOString(),
      })
      .eq("id", openCardId)
      .eq("owner_user_id", order.user_id)
      .in("status", ["pending", "hidden", "expired", "public"])
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      throw updateRes.error;
    }
    if (!updateRes.data) {
      const reopenedAgain = await admin
        .from("dating_cards")
        .select("status,expires_at")
        .eq("id", openCardId)
        .eq("owner_user_id", order.user_id)
        .maybeSingle();
      if (reopenedAgain.error) {
        throw reopenedAgain.error;
      }
      const reopenedExpiresAt = reopenedAgain.data?.expires_at ? new Date(reopenedAgain.data.expires_at).getTime() : 0;
      if (reopenedAgain.data?.status === "public" && Number.isFinite(reopenedExpiresAt) && reopenedExpiresAt > Date.now()) {
        return { alreadyApproved: true };
      }
      throw new Error("OPEN_CARD_REOPEN_FAILED");
    }

    return { alreadyApproved: false };
  }

  const paidCardRes = await admin
    .from("dating_paid_cards")
    .select("id,user_id,status,display_mode")
    .eq("id", paidCardId)
    .maybeSingle();

  if (paidCardRes.error) {
    throw paidCardRes.error;
  }
  if (!paidCardRes.data) {
    throw new Error("PAID_CARD_NOT_FOUND");
  }
  if (paidCardRes.data.user_id !== order.user_id) {
    throw new Error("PAID_CARD_FORBIDDEN");
  }
  if (paidCardRes.data.status === "approved") {
    return { alreadyApproved: true };
  }
  if (paidCardRes.data.status !== "pending") {
    throw new Error("PAID_CARD_NOT_PENDING");
  }

  const approveRes = await approvePaidCard(admin, {
    paidCardId,
    displayMode: paidCardRes.data.display_mode === "instant_public" ? "instant_public" : "priority_24h",
  });

  if (approveRes) {
    return { alreadyApproved: false };
  }

  const approvedAgain = await admin
    .from("dating_paid_cards")
    .select("status")
    .eq("id", paidCardId)
    .maybeSingle();

  if (approvedAgain.error) {
    throw approvedAgain.error;
  }
  if (approvedAgain.data?.status === "approved") {
    return { alreadyApproved: true };
  }

  throw new Error("PAID_CARD_APPROVE_FAILED");
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

  if (order.product_type === "city_view") {
    await ensureCityViewFulfilled(admin, order);
  }

  if (order.product_type === "paid_card") {
    await ensurePaidCardFulfilled(admin, order);
  }

  if (order.product_type === "one_on_one_contact_exchange") {
    await ensureOneOnOneExchangeFulfilled(admin, order);
  }

  if (order.product_type === "one_on_one_priority_24h") {
    await ensureOneOnOnePriorityFulfilled(admin, order);
  }

  if (order.product_type === "swipe_premium_30d") {
    await ensureSwipePremiumFulfilled(admin, order);
  }

  if (order.product_type === "love_fortune_detail") {
    if (!order.product_ref_id) {
      throw new Error("LOVE_FORTUNE_READING_MISSING");
    }

    const allowedTester = await isLoveFortuneTester(admin, order.user_id);
    if (!allowedTester) {
      throw new Error("LOVE_FORTUNE_ADMIN_ONLY");
    }

    const readingRes = await admin
      .from("love_fortune_readings")
      .update({
        status: "paid",
        payment_order_id: order.id,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.product_ref_id)
      .eq("user_id", order.user_id)
      .in("status", ["pending_payment", "paid", "generated"])
      .select("id")
      .maybeSingle();

    if (readingRes.error) {
      throw readingRes.error;
    }

    if (!readingRes.data?.id) {
      throw new Error("LOVE_FORTUNE_FULFILL_FAILED");
    }
  }

  return { addedCredits: 0, creditsAfter: 0 };
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

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
      .select("id,user_id,product_type,product_ref_id,product_meta,order_name,toss_order_id,amount,status")
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
        orderName: order.order_name,
        readingId: order.product_type === "love_fortune_detail" ? order.product_ref_id : undefined,
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
      orderName: order.order_name,
      readingId: order.product_type === "love_fortune_detail" ? order.product_ref_id : undefined,
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
    if (error instanceof Error && error.message === "CITY_VIEW_PROVINCE_MISSING") {
      return json(500, {
        ok: false,
        code: "CITY_VIEW_PROVINCE_MISSING",
        requestId,
        message: "가까운 이상형 결제 지역 정보가 올바르지 않습니다.",
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
    if (error instanceof Error && error.message.startsWith("OPEN_CARD_REOPEN_")) {
      return json(500, {
        ok: false,
        code: error.message,
        requestId,
        message: "오픈카드 재노출 처리에 실패했습니다. 마이페이지에서 상태를 확인해주세요.",
      });
    }
    return json(500, {
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
      requestId,
      message: `결제 확인 중 오류가 발생했습니다. ${PAYMENT_CARD_UNAVAILABLE_MESSAGE}`,
    });
  }
}

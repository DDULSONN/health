import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { normalizeCardSex } from "@/lib/dating-more-view";
import {
  SWIPE_PREMIUM_DAILY_LIMIT,
  SWIPE_PREMIUM_DURATION_DAYS,
  SWIPE_PREMIUM_PRICE_KRW,
  getLatestSwipeCardForUser,
  getSwipeLimitInfo,
} from "@/lib/dating-swipe";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { createTossPayment, getMissingTossConfigKeys, isTossConfigured } from "@/lib/toss-payments";

type ProductType =
  | "apply_credits"
  | "paid_card"
  | "more_view"
  | "city_view"
  | "one_on_one_contact_exchange"
  | "swipe_premium_30d";

type CreateBody = {
  productType?: unknown;
  sex?: unknown;
  province?: unknown;
  matchId?: unknown;
};

type OneOnOneMatchRow = {
  id: string;
  source_user_id: string;
  candidate_user_id: string;
  state: "proposed" | "source_selected" | "candidate_accepted" | "mutual_accepted" | "source_skipped" | "candidate_rejected" | "source_declined" | "admin_canceled";
  contact_exchange_status: "none" | "awaiting_applicant_payment" | "payment_pending_admin" | "approved" | "canceled";
};

const PRODUCT_CONFIG: Record<ProductType, { amount: number; orderName: string }> = {
  apply_credits: {
    amount: 5000,
    orderName: "오픈카드 지원권 3장",
  },
  paid_card: {
    amount: 10000,
    orderName: "대기 없이 등록",
  },
  more_view: {
    amount: 5000,
    orderName: "이상형 더보기",
  },
  city_view: {
    amount: 5000,
    orderName: "가까운 이상형 보기",
  },
  one_on_one_contact_exchange: {
    amount: 20000,
    orderName: "1:1 번호 교환",
  },
  swipe_premium_30d: {
    amount: SWIPE_PREMIUM_PRICE_KRW,
    orderName: "鍮좊Ⅸ留ㅼ묶 ?뵆?쒖뒪",
  },
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function getBaseUrl(req: Request) {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(req.url).origin;
}

function parseProductType(raw: unknown): ProductType | "" {
  if (
    raw === "apply_credits" ||
    raw === "paid_card" ||
    raw === "more_view" ||
    raw === "city_view" ||
    raw === "one_on_one_contact_exchange" ||
    raw === "swipe_premium_30d"
  ) {
    return raw;
  }
  return "";
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

    const body = ((await req.json().catch(() => null)) ?? {}) as CreateBody;
    const productType = parseProductType(body.productType);

    if (!productType) {
      return json(400, {
        ok: false,
        code: "VALIDATION_ERROR",
        requestId,
        message: "productType이 필요합니다.",
      });
    }

    if (productType === "more_view" && !isAllowedAdminUser(user.id, user.email)) {
      return json(403, {
        ok: false,
        code: "FORBIDDEN",
        requestId,
        message: "현재는 운영 테스트 계정에서만 이용할 수 있습니다.",
      });
    }

    const config = PRODUCT_CONFIG[productType];
    const admin = createAdminClient();
    let productRefId: string | null = null;
    let productMeta: Record<string, unknown> = {};

    if (productType === "apply_credits") {
      const applyOrderRes = await admin
        .from("apply_credit_orders")
        .insert({
          user_id: user.id,
          pack_size: 3,
          amount: config.amount,
          status: "pending",
          memo: "toss payment",
        })
        .select("id")
        .single();

      if (applyOrderRes.error || !applyOrderRes.data?.id) {
        console.error("[toss-create] apply credit order insert failed", applyOrderRes.error);
        return json(500, {
          ok: false,
          code: "CREATE_ORDER_FAILED",
          requestId,
          message: "지원권 주문을 생성하지 못했습니다.",
        });
      }

      productRefId = applyOrderRes.data.id;
    }

    if (productType === "more_view") {
      const sex = normalizeCardSex(body.sex);
      if (!sex) {
        return json(400, {
          ok: false,
          code: "VALIDATION_ERROR",
          requestId,
          message: "성별 값이 올바르지 않습니다.",
        });
      }

      productMeta = { sex };

      const activeRes = await admin
        .from("dating_more_view_requests")
        .select("id,access_expires_at")
        .eq("user_id", user.id)
        .eq("sex", sex)
        .eq("status", "approved")
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(10);

      if (!activeRes.error && Array.isArray(activeRes.data)) {
        const hasActiveGrant = activeRes.data.some((row) => {
          const expiresAt = row.access_expires_at ? new Date(row.access_expires_at).getTime() : Number.NaN;
          return Number.isFinite(expiresAt) && expiresAt > Date.now();
        });

        if (hasActiveGrant) {
          return json(409, {
            ok: false,
            code: "ALREADY_APPROVED",
            requestId,
            message: "이미 이용 가능한 이상형 더보기 권한이 있습니다.",
          });
        }
      }
    }

    if (productType === "city_view") {
      const province = typeof body.province === "string" ? body.province.trim() : "";
      if (!province) {
        return json(400, {
          ok: false,
          code: "VALIDATION_ERROR",
          requestId,
          message: "도/광역시 정보가 필요합니다.",
        });
      }

      const activeRes = await admin
        .from("dating_city_view_requests")
        .select("id,access_expires_at")
        .eq("user_id", user.id)
        .eq("city", province)
        .eq("status", "approved")
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(10);

      if (activeRes.error) {
        console.error("[toss-create] city view active lookup failed", activeRes.error);
        return json(500, {
          ok: false,
          code: "CITY_VIEW_LOOKUP_FAILED",
          requestId,
          message: "가까운 이상형 이용 상태를 확인하지 못했습니다.",
        });
      }

      const hasActiveGrant = (activeRes.data ?? []).some((row) => {
        const expiresAt = row.access_expires_at ? new Date(row.access_expires_at).getTime() : Number.NaN;
        return Number.isFinite(expiresAt) && expiresAt > Date.now();
      });

      if (hasActiveGrant) {
        return json(409, {
          ok: false,
          code: "ALREADY_APPROVED",
          requestId,
          message: "이미 이용 가능한 가까운 이상형 권한이 있습니다.",
        });
      }

      const productRef = `${user.id}:${province}`;
      const duplicateOrderRes = await admin
        .from("toss_test_payment_orders")
        .select("id,status,created_at")
        .eq("product_type", "city_view")
        .eq("product_ref_id", productRef)
        .in("status", ["ready", "paid"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (duplicateOrderRes.error) {
        console.error("[toss-create] city view duplicate order lookup failed", duplicateOrderRes.error);
        return json(500, {
          ok: false,
          code: "ORDER_LOOKUP_FAILED",
          requestId,
          message: "기존 결제 진행 상태를 확인하지 못했습니다.",
        });
      }

      const duplicateOrders = duplicateOrderRes.data ?? [];
      if (duplicateOrders.some((row) => row.status === "paid")) {
        return json(409, {
          ok: false,
          code: "ALREADY_PAID",
          requestId,
          message: "이미 결제가 완료된 지역입니다. 탭을 새로고침해 주세요.",
        });
      }

      const hasFreshReadyOrder = duplicateOrders.some((row) => {
        if (row.status !== "ready") return false;
        const createdAtMs = new Date(row.created_at).getTime();
        return Number.isFinite(createdAtMs) && Date.now() - createdAtMs < 15 * 60 * 1000;
      });

      if (hasFreshReadyOrder) {
        return json(409, {
          ok: false,
          code: "PAYMENT_IN_PROGRESS",
          requestId,
          message: "이미 진행 중인 결제가 있습니다. 잠시 후 다시 확인해 주세요.",
        });
      }

      productRefId = productRef;
      productMeta = { province };
    }

    if (productType === "one_on_one_contact_exchange") {
      const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
      if (!matchId) {
        return json(400, {
          ok: false,
          code: "VALIDATION_ERROR",
          requestId,
          message: "matchId가 필요합니다.",
        });
      }

      const matchRes = await admin
        .from("dating_1on1_match_proposals")
        .select("id,source_user_id,candidate_user_id,state,contact_exchange_status")
        .eq("id", matchId)
        .maybeSingle();

      if (matchRes.error) {
        console.error("[toss-create] 1on1 match lookup failed", matchRes.error);
        return json(500, {
          ok: false,
          code: "MATCH_LOOKUP_FAILED",
          requestId,
          message: "1:1 매칭 정보를 불러오지 못했습니다.",
        });
      }

      const match = matchRes.data as OneOnOneMatchRow | null;
      if (!match) {
        return json(404, {
          ok: false,
          code: "MATCH_NOT_FOUND",
          requestId,
          message: "1:1 매칭을 찾지 못했습니다.",
        });
      }

      const isParticipant = match.source_user_id === user.id || match.candidate_user_id === user.id;
      if (!isParticipant) {
        return json(403, {
          ok: false,
          code: "FORBIDDEN",
          requestId,
          message: "쌍방 수락된 당사자만 번호 교환 결제를 진행할 수 있습니다.",
        });
      }

      if (!["mutual_accepted", "candidate_accepted"].includes(match.state)) {
        return json(409, {
          ok: false,
          code: "MATCH_NOT_READY",
          requestId,
          message: "쌍방 수락이 완료된 매칭만 번호 교환 결제를 진행할 수 있습니다.",
        });
      }

      if (match.contact_exchange_status === "approved") {
        return json(409, {
          ok: false,
          code: "ALREADY_APPROVED",
          requestId,
          message: "이미 번호 교환이 완료된 매칭입니다.",
        });
      }

      if (match.contact_exchange_status === "canceled") {
        return json(409, {
          ok: false,
          code: "MATCH_CANCELED",
          requestId,
          message: "취소된 매칭은 번호 교환 결제를 진행할 수 없습니다.",
        });
      }

      const duplicateOrderRes = await admin
        .from("toss_test_payment_orders")
        .select("id,status,created_at")
        .eq("product_type", "one_on_one_contact_exchange")
        .eq("product_ref_id", matchId)
        .in("status", ["ready", "paid"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (duplicateOrderRes.error) {
        console.error("[toss-create] 1on1 duplicate order lookup failed", duplicateOrderRes.error);
        return json(500, {
          ok: false,
          code: "ORDER_LOOKUP_FAILED",
          requestId,
          message: "기존 결제 진행 상태를 확인하지 못했습니다.",
        });
      }

      const duplicateOrders = duplicateOrderRes.data ?? [];
      const hasPaidOrder = duplicateOrders.some((row) => row.status === "paid");
      if (hasPaidOrder) {
        return json(409, {
          ok: false,
          code: "ALREADY_PAID",
          requestId,
          message: "이미 결제가 완료된 번호 교환입니다. 마이페이지를 새로고침해 주세요.",
        });
      }

      const hasFreshReadyOrder = duplicateOrders.some((row) => {
        if (row.status !== "ready") return false;
        const createdAtMs = new Date(row.created_at).getTime();
        return Number.isFinite(createdAtMs) && Date.now() - createdAtMs < 15 * 60 * 1000;
      });

      if (hasFreshReadyOrder) {
        return json(409, {
          ok: false,
          code: "PAYMENT_IN_PROGRESS",
          requestId,
          message: "상대가 이미 결제를 진행 중일 수 있어요. 잠시 후 다시 확인해 주세요.",
        });
      }

      productRefId = matchId;
      productMeta = { matchId };
    }

    if (productType === "swipe_premium_30d") {
      const myCard = await getLatestSwipeCardForUser(admin, user.id);
      if (!myCard) {
        return json(403, {
          ok: false,
          code: "SWIPE_CARD_REQUIRED",
          requestId,
          message: "?ㅽ뵂移대뱶瑜??깅줉???ъ슜?먮쭔 鍮좊Ⅸ留ㅼ묶 ?뵆?쒖뒪瑜??댁슜?????덉뒿?덈떎.",
        });
      }

      const limitInfo = await getSwipeLimitInfo(admin, user.id);
      if (limitInfo.activeSubscription) {
        return json(409, {
          ok: false,
          code: "ALREADY_ACTIVE",
          requestId,
          message: "?대? 鍮좊Ⅸ留ㅼ묶 ?뵆?쒖뒪瑜??댁슜 以묒엯?덈떎.",
        });
      }

      const duplicateOrderRes = await admin
        .from("toss_test_payment_orders")
        .select("id,status,created_at")
        .eq("product_type", "swipe_premium_30d")
        .eq("user_id", user.id)
        .in("status", ["ready", "paid"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (duplicateOrderRes.error) {
        console.error("[toss-create] swipe premium duplicate order lookup failed", duplicateOrderRes.error);
        return json(500, {
          ok: false,
          code: "ORDER_LOOKUP_FAILED",
          requestId,
          message: "湲곗〈 寃곗젣 ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??",
        });
      }

      const duplicateOrders = duplicateOrderRes.data ?? [];
      if (duplicateOrders.some((row) => row.status === "paid")) {
        return json(409, {
          ok: false,
          code: "ALREADY_PAID",
          requestId,
          message: "?대? 鍮좊Ⅸ留ㅼ묶 ?뵆?쒖뒪 寃곗젣媛 ?꾨즺?? ?댁슜 以묒엯?덈떎.",
        });
      }

      const hasFreshReadyOrder = duplicateOrders.some((row) => {
        if (row.status !== "ready") return false;
        const createdAtMs = new Date(row.created_at).getTime();
        return Number.isFinite(createdAtMs) && Date.now() - createdAtMs < 15 * 60 * 1000;
      });

      if (hasFreshReadyOrder) {
        return json(409, {
          ok: false,
          code: "PAYMENT_IN_PROGRESS",
          requestId,
          message: "?대? 鍮좊Ⅸ留ㅼ묶 ?뵆?쒖뒪 寃곗젣媛 吏꾪뻾 以묒엯?덈떎. ?좎떆 ???ㅼ떆 ?뺤씤??二쇱꽭??",
        });
      }

      productRefId = user.id;
      productMeta = {
        source: "quick_match",
        dailyLimit: limitInfo.premiumLimit ?? SWIPE_PREMIUM_DAILY_LIMIT,
        durationDays: limitInfo.premiumDurationDays ?? SWIPE_PREMIUM_DURATION_DAYS,
      };
    }

    const tossOrderId = crypto.randomUUID().replace(/-/g, "");
    const orderName =
      productType === "more_view"
        ? `${config.orderName} (${productMeta.sex === "female" ? "여자 카드" : "남자 카드"})`
        : productType === "city_view"
          ? `${config.orderName} (${String(productMeta.province ?? "-")})`
          : config.orderName;

    const saveOrderRes = await admin
      .from("toss_test_payment_orders")
      .insert({
        user_id: user.id,
        product_type: productType,
        product_ref_id: productRefId,
        product_meta: productMeta,
        toss_order_id: tossOrderId,
        order_name: orderName,
        amount: config.amount,
        status: "ready",
      })
      .select("id")
      .single();

    if (saveOrderRes.error || !saveOrderRes.data?.id) {
      console.error("[toss-create] toss order insert failed", saveOrderRes.error);
      return json(500, {
        ok: false,
        code: "CREATE_ORDER_FAILED",
        requestId,
        message: "결제 주문 저장에 실패했습니다.",
      });
    }

    const baseUrl = getBaseUrl(req);
    const successUrl = new URL("/payments/success", baseUrl);
    successUrl.searchParams.set("productType", productType);
    const failUrl = new URL("/payments/fail", baseUrl);
    failUrl.searchParams.set("productType", productType);
    const payment = await createTossPayment({
      method: "CARD",
      amount: config.amount,
      orderId: tossOrderId,
      orderName,
      successUrl: successUrl.toString(),
      failUrl: failUrl.toString(),
      customerEmail: user.email ?? undefined,
      customerName: "GymTools User",
      ...(productType === "more_view" || productType === "city_view" || productType === "one_on_one_contact_exchange" || productType === "swipe_premium_30d"
        ? {
            flowMode: "DIRECT" as const,
            easyPay: "KAKAOPAY" as const,
          }
        : {}),
    });

    const checkoutUrl = payment.checkout?.url ?? "";
    if (!checkoutUrl) {
      return json(500, {
        ok: false,
        code: "CHECKOUT_URL_MISSING",
        requestId,
        message: "결제창 URL을 만들지 못했습니다.",
      });
    }

    return json(200, {
      ok: true,
      requestId,
      productType,
      orderId: tossOrderId,
      amount: config.amount,
      checkoutUrl,
    });
  } catch (error) {
    console.error("[toss-create] unhandled", error);
    return json(500, {
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
      requestId,
      message: "서버 오류가 발생했습니다.",
    });
  }
}

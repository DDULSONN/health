import { NextResponse } from "next/server";
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
  paidCardId?: unknown;
};

type OneOnOneMatchRow = {
  id: string;
  source_user_id: string;
  candidate_user_id: string;
  state:
    | "proposed"
    | "source_selected"
    | "candidate_accepted"
    | "mutual_accepted"
    | "source_skipped"
    | "candidate_rejected"
    | "source_declined"
    | "admin_canceled";
  contact_exchange_status: "none" | "awaiting_applicant_payment" | "payment_pending_admin" | "approved" | "canceled";
};

const PRODUCT_CONFIG: Record<ProductType, { amount: number; orderName: string }> = {
  apply_credits: {
    amount: 5000,
    orderName: "지원권 5장",
  },
  paid_card: {
    amount: 10000,
    orderName: "즉시 공개",
  },
  more_view: {
    amount: 5000,
    orderName: "이상형 더보기",
  },
  city_view: {
    amount: 5000,
    orderName: "가까운 이상형",
  },
  one_on_one_contact_exchange: {
    amount: 20000,
    orderName: "1:1 번호 교환",
  },
  swipe_premium_30d: {
    amount: SWIPE_PREMIUM_PRICE_KRW,
    orderName: "빠른매칭 플러스",
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

async function cancelReadyOrders(admin: ReturnType<typeof createAdminClient>, orderIds: string[]) {
  if (orderIds.length === 0) return;

  const res = await admin
    .from("toss_test_payment_orders")
    .update({
      status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .in("id", orderIds)
    .eq("status", "ready");

  if (res.error) {
    throw res.error;
  }
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
        message: "濡쒓렇?몄씠 ?꾩슂?⑸땲??",
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
            ? `?좎뒪 寃곗젣 ?ㅼ젙??鍮꾩뼱 ?덉뒿?덈떎: ${missingKeys.join(", ")}`
            : "寃곗젣 ?ㅼ젙???꾩쭅 ?꾨즺?섏? ?딆븯?듬땲??",
      });
    }

    const body = ((await req.json().catch(() => null)) ?? {}) as CreateBody;
    const productType = parseProductType(body.productType);

    if (!productType) {
      return json(400, {
        ok: false,
        code: "VALIDATION_ERROR",
        requestId,
        message: "productType???꾩슂?⑸땲??",
      });
    }

    if (productType === "more_view" && false) {
      return json(403, {
        ok: false,
        code: "FORBIDDEN",
        requestId,
        message: "?꾩옱???댁쁺 ?뚯뒪??怨꾩젙?먯꽌留??댁슜?????덉뒿?덈떎.",
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
          message: "吏?먭텒 二쇰Ц???앹꽦?섏? 紐삵뻽?듬땲??",
        });
      }

      productRefId = applyOrderRes.data.id;

      const readyOrderRes = await admin
        .from("toss_test_payment_orders")
        .select("id")
        .eq("product_type", "apply_credits")
        .eq("user_id", user.id)
        .eq("status", "ready")
        .limit(20);

      if (readyOrderRes.error) {
        console.error("[toss-create] apply credit ready order lookup failed", readyOrderRes.error);
        return json(500, {
          ok: false,
          code: "ORDER_LOOKUP_FAILED",
          requestId,
          message: "湲곗〈 寃곗젣 吏꾪뻾 ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??",
        });
      }

      await cancelReadyOrders(
        admin,
        (readyOrderRes.data ?? []).map((row) => row.id)
      );
    }

    if (productType === "more_view") {
      const sex = normalizeCardSex(body.sex);
      if (!sex) {
        return json(400, {
          ok: false,
          code: "VALIDATION_ERROR",
          requestId,
          message: "?깅퀎 媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎.",
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

      if (activeRes.error) {
        console.error("[toss-create] more view active lookup failed", activeRes.error);
        return json(500, {
          ok: false,
          code: "MORE_VIEW_LOOKUP_FAILED",
          requestId,
          message: "?댁긽???붾낫湲??댁슜 ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??",
        });
      }

      if (Array.isArray(activeRes.data)) {
        const hasActiveGrant = activeRes.data.some((row) => {
          const expiresAt = row.access_expires_at ? new Date(row.access_expires_at).getTime() : Number.NaN;
          return Number.isFinite(expiresAt) && expiresAt > Date.now();
        });

        if (hasActiveGrant) {
          return json(409, {
            ok: false,
            code: "ALREADY_APPROVED",
            requestId,
            message: "?대? ?댁슜 媛?ν븳 ?댁긽???붾낫湲?沅뚰븳???덉뒿?덈떎.",
          });
        }
      }

      const duplicateOrderRes = await admin
        .from("toss_test_payment_orders")
        .select("id,status,created_at")
        .eq("product_type", "more_view")
        .eq("user_id", user.id)
        .contains("product_meta", { sex })
        .in("status", ["ready", "paid"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (duplicateOrderRes.error) {
        console.error("[toss-create] more view duplicate order lookup failed", duplicateOrderRes.error);
        return json(500, {
          ok: false,
          code: "ORDER_LOOKUP_FAILED",
          requestId,
          message: "湲곗〈 寃곗젣 吏꾪뻾 ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??",
        });
      }

      const duplicateOrders = duplicateOrderRes.data ?? [];
      if (duplicateOrders.some((row) => row.status === "paid")) {
        return json(409, {
          ok: false,
          code: "ALREADY_PAID",
          requestId,
          message: "?대? 寃곗젣媛 ?꾨즺???댁긽???붾낫湲곗엯?덈떎. 寃곗젣 ??씠???깃났 ?붾㈃???ㅼ떆 ?뺤씤??二쇱꽭??",
        });
      }

      await cancelReadyOrders(
        admin,
        duplicateOrders.filter((row) => row.status === "ready").map((row) => row.id)
      );
    }

    if (productType === "city_view") {
      const province = typeof body.province === "string" ? body.province.trim() : "";
      if (!province) {
        return json(400, {
          ok: false,
          code: "VALIDATION_ERROR",
          requestId,
          message: "吏???뺣낫媛 ?꾩슂?⑸땲??",
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
          message: "媛源뚯슫 ?댁긽???댁슜 ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??",
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
          message: "?대? ?댁슜 媛?ν븳 媛源뚯슫 ?댁긽??沅뚰븳???덉뒿?덈떎.",
        });
      }

      const duplicateOrderRes = await admin
        .from("toss_test_payment_orders")
        .select("id,status,created_at")
        .eq("product_type", "city_view")
        .eq("user_id", user.id)
        .contains("product_meta", { province })
        .in("status", ["ready", "paid"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (duplicateOrderRes.error) {
        console.error("[toss-create] city view duplicate order lookup failed", duplicateOrderRes.error);
        return json(500, {
          ok: false,
          code: "ORDER_LOOKUP_FAILED",
          requestId,
          message: "湲곗〈 寃곗젣 吏꾪뻾 ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??",
        });
      }

      const duplicateOrders = duplicateOrderRes.data ?? [];
      if (duplicateOrders.some((row) => row.status === "paid")) {
        return json(409, {
          ok: false,
          code: "ALREADY_PAID",
          requestId,
          message: "?대? 寃곗젣媛 ?꾨즺??吏??엯?덈떎. ??쓣 ?덈줈怨좎묠??二쇱꽭??",
        });
      }

      const readyOrderIds = duplicateOrders.filter((row) => row.status === "ready").map((row) => row.id);
      await cancelReadyOrders(admin, readyOrderIds);

      productRefId = user.id;
      productMeta = { province };
    }

    if (productType === "one_on_one_contact_exchange") {
      const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
      if (!matchId) {
        return json(400, {
          ok: false,
          code: "VALIDATION_ERROR",
          requestId,
          message: "matchId媛 ?꾩슂?⑸땲??",
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
          message: "1:1 留ㅼ묶 ?뺣낫瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??",
        });
      }

      const match = matchRes.data as OneOnOneMatchRow | null;
      if (!match) {
        return json(404, {
          ok: false,
          code: "MATCH_NOT_FOUND",
          requestId,
          message: "1:1 留ㅼ묶??李얠? 紐삵뻽?듬땲??",
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
          message: "湲곗〈 寃곗젣 吏꾪뻾 ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??",
        });
      }

      const duplicateOrders = duplicateOrderRes.data ?? [];
      const hasPaidOrder = duplicateOrders.some((row) => row.status === "paid");
      if (hasPaidOrder) {
        return json(409, {
          ok: false,
          code: "ALREADY_PAID",
          requestId,
          message: "?대? 寃곗젣媛 ?꾨즺??踰덊샇 援먰솚?낅땲?? 留덉씠?섏씠吏瑜??덈줈怨좎묠??二쇱꽭??",
        });
      }

      const readyOrderIds = duplicateOrders.filter((row) => row.status === "ready").map((row) => row.id);
      await cancelReadyOrders(admin, readyOrderIds);

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
          message: "鍮좊Ⅸ留ㅼ묶 移대뱶瑜??깅줉???ъ슜?먮쭔 鍮좊Ⅸ留ㅼ묶 ?뚮윭?ㅻ? ?댁슜?????덉뒿?덈떎.",
        });
      }

      const limitInfo = await getSwipeLimitInfo(admin, user.id);
      if (limitInfo.activeSubscription) {
        return json(409, {
          ok: false,
          code: "ALREADY_ACTIVE",
          requestId,
          message: "?대? 鍮좊Ⅸ留ㅼ묶 ?뚮윭?ㅻ? ?댁슜 以묒엯?덈떎.",
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
          message: "湲곗〈 寃곗젣 吏꾪뻾 ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??",
        });
      }

      const duplicateOrders = duplicateOrderRes.data ?? [];
      if (duplicateOrders.some((row) => row.status === "paid")) {
        return json(409, {
          ok: false,
          code: "ALREADY_PAID",
          requestId,
          message: "?대? 鍮좊Ⅸ留ㅼ묶 ?뚮윭??寃곗젣媛 ?꾨즺?섏뼱 ?댁슜 以묒엯?덈떎.",
        });
      }

      const readyOrderIds = duplicateOrders.filter((row) => row.status === "ready").map((row) => row.id);
      await cancelReadyOrders(admin, readyOrderIds);

      productRefId = user.id;
      productMeta = {
        source: "quick_match",
        dailyLimit: limitInfo.premiumLimit ?? SWIPE_PREMIUM_DAILY_LIMIT,
        durationDays: limitInfo.premiumDurationDays ?? SWIPE_PREMIUM_DURATION_DAYS,
      };
    }

    if (productType === "paid_card") {
      const paidCardId = typeof body.paidCardId === "string" ? body.paidCardId.trim() : "";
      if (!paidCardId) {
        return json(400, {
          ok: false,
          code: "VALIDATION_ERROR",
          requestId,
          message: "paidCardId가 필요합니다.",
        });
      }

      const paidCardRes = await admin
        .from("dating_paid_cards")
        .select("id,user_id,status,display_mode")
        .eq("id", paidCardId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (paidCardRes.error) {
        console.error("[toss-create] paid card lookup failed", paidCardRes.error);
        return json(500, {
          ok: false,
          code: "PAID_CARD_LOOKUP_FAILED",
          requestId,
          message: "대기 없이 등록 신청 정보를 확인하지 못했습니다.",
        });
      }

      if (!paidCardRes.data) {
        return json(404, {
          ok: false,
          code: "PAID_CARD_NOT_FOUND",
          requestId,
          message: "결제할 대기 없이 등록 신청을 찾지 못했습니다.",
        });
      }

      if (paidCardRes.data.status === "approved") {
        return json(409, {
          ok: false,
          code: "ALREADY_APPROVED",
          requestId,
          message: "이미 결제가 반영된 대기 없이 등록입니다.",
        });
      }

      if (paidCardRes.data.status !== "pending") {
        return json(409, {
          ok: false,
          code: "PAID_CARD_NOT_PENDING",
          requestId,
          message: "대기중 신청만 결제를 진행할 수 있습니다.",
        });
      }

      const readyOrderRes = await admin
        .from("toss_test_payment_orders")
        .select("id")
        .eq("product_type", "paid_card")
        .eq("product_ref_id", paidCardId)
        .eq("status", "ready")
        .limit(20);

      if (readyOrderRes.error) {
        console.error("[toss-create] paid card ready order lookup failed", readyOrderRes.error);
        return json(500, {
          ok: false,
          code: "ORDER_LOOKUP_FAILED",
          requestId,
          message: "기존 결제 진행 상태를 확인하지 못했습니다.",
        });
      }

      await cancelReadyOrders(admin, (readyOrderRes.data ?? []).map((row) => row.id));
      productRefId = paidCardId;
      productMeta = {
        displayMode: paidCardRes.data.display_mode === "instant_public" ? "instant_public" : "priority_24h",
      };
    }

    const tossOrderId = crypto.randomUUID().replace(/-/g, "");
    const orderName =
      productType === "more_view"
        ? `${config.orderName} (${productMeta.sex === "female" ? "?ъ옄 移대뱶" : "?⑥옄 移대뱶"})`
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
      const dbErrorCode = String(saveOrderRes.error?.code ?? "");
      const dbErrorMessage = String(saveOrderRes.error?.message ?? "");
      const isSchemaOutdated =
        dbErrorCode === "23514" ||
        dbErrorCode === "42703" ||
        dbErrorMessage.includes("toss_test_payment_orders_product_type_check") ||
        dbErrorMessage.includes("product_meta");
      return json(500, {
        ok: false,
        code: isSchemaOutdated ? "PAYMENT_SCHEMA_OUTDATED" : "CREATE_ORDER_FAILED",
        requestId,
        message: isSchemaOutdated
          ? "寃곗젣 ?ㅼ젙 ?낅뜲?댄듃媛 ?꾩쭅 ?곸슜?섏? ?딆븯?듬땲?? 愿由ъ옄?먭쾶 臾몄쓽?댁＜?몄슂."
          : "寃곗젣 二쇰Ц ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.",
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
      ...(productType === "apply_credits" ||
      productType === "paid_card" ||
      productType === "more_view" ||
      productType === "city_view" ||
      productType === "one_on_one_contact_exchange" ||
      productType === "swipe_premium_30d"
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
        message: "寃곗젣李?URL??留뚮뱾吏 紐삵뻽?듬땲??",
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
      message: "?쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.",
    });
  }
}



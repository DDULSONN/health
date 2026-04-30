import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { normalizeCardSex } from "@/lib/dating-more-view";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { createTossPayment, getMissingTossConfigKeys, isTossConfigured } from "@/lib/toss-payments";

type CreateBody = {
  productType?: unknown;
  sex?: unknown;
};

const PRODUCT_CONFIG = {
  apply_credits: {
    amount: 5000,
    orderName: "지원권 3장 구매",
  },
  paid_card: {
    amount: 10000,
    orderName: "유료카드 등록 결제",
  },
  more_view: {
    amount: 5000,
    orderName: "이상형 더보기",
  },
} as const;

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function getBaseUrl(req: Request) {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(req.url).origin;
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

    const body = ((await req.json().catch(() => null)) ?? {}) as CreateBody;
    const productType =
      body.productType === "paid_card"
        ? "paid_card"
        : body.productType === "apply_credits"
          ? "apply_credits"
          : body.productType === "more_view"
            ? "more_view"
            : "";

    if (!productType) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "productType이 필요합니다." });
    }

    if (productType === "more_view" && !isAllowedAdminUser(user.id, user.email)) {
      return json(403, {
        ok: false,
        code: "FORBIDDEN",
        requestId,
        message: "현재는 운영 테스트 계정만 이용할 수 있습니다.",
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
        return json(500, { ok: false, code: "CREATE_ORDER_FAILED", requestId, message: "지원권 주문 생성에 실패했습니다." });
      }

      productRefId = applyOrderRes.data.id;
    }

    if (productType === "more_view") {
      const sex = normalizeCardSex(body.sex);
      if (!sex) {
        return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "성별 값이 올바르지 않습니다." });
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

    const tossOrderId = crypto.randomUUID().replace(/-/g, "");
    const saveOrderRes = await admin
      .from("toss_test_payment_orders")
      .insert({
        user_id: user.id,
        product_type: productType,
        product_ref_id: productRefId,
        product_meta: productMeta,
        toss_order_id: tossOrderId,
        order_name:
          productType === "more_view"
            ? `${config.orderName} (${productMeta.sex === "female" ? "여자 카드" : "남자 카드"})`
            : config.orderName,
        amount: config.amount,
        status: "ready",
      })
      .select("id")
      .single();

    if (saveOrderRes.error || !saveOrderRes.data?.id) {
      console.error("[toss-create] toss order insert failed", saveOrderRes.error);
      return json(500, { ok: false, code: "CREATE_ORDER_FAILED", requestId, message: "결제 주문 저장에 실패했습니다." });
    }

    const baseUrl = getBaseUrl(req);
    const payment = await createTossPayment({
      method: "CARD",
      amount: config.amount,
      orderId: tossOrderId,
      orderName: config.orderName,
      successUrl: `${baseUrl}/payments/success`,
      failUrl: `${baseUrl}/payments/fail`,
      customerEmail: user.email ?? undefined,
      customerName: "GymTools User",
    });

    const checkoutUrl = payment.checkout?.url ?? "";
    if (!checkoutUrl) {
      return json(500, { ok: false, code: "CHECKOUT_URL_MISSING", requestId, message: "결제창 URL 생성에 실패했습니다." });
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
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createTossTestPayment, getMissingTossTestConfigKeys, isTossTestConfigured } from "@/lib/toss-payments";
import { isAllowedTestPaymentEmail } from "@/lib/test-payment";

type CreateBody = {
  productType?: unknown;
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

    const body = ((await req.json().catch(() => null)) ?? {}) as CreateBody;
    const productType = body.productType === "paid_card" ? "paid_card" : body.productType === "apply_credits" ? "apply_credits" : "";
    if (!productType) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "productType이 필요합니다." });
    }

    const config = PRODUCT_CONFIG[productType];
    const admin = createAdminClient();
    let productRefId: string | null = null;

    if (productType === "apply_credits") {
      const applyOrderRes = await admin
        .from("apply_credit_orders")
        .insert({
          user_id: user.id,
          pack_size: 3,
          amount: config.amount,
          status: "pending",
          memo: "toss test payment",
        })
        .select("id")
        .single();

      if (applyOrderRes.error || !applyOrderRes.data?.id) {
        console.error("[toss-test-create] apply credit order insert failed", applyOrderRes.error);
        return json(500, { ok: false, code: "CREATE_ORDER_FAILED", requestId, message: "지원권 주문 생성에 실패했습니다." });
      }

      productRefId = applyOrderRes.data.id;
    }

    const tossOrderId = crypto.randomUUID().replace(/-/g, "");
    const saveOrderRes = await admin
      .from("toss_test_payment_orders")
      .insert({
        user_id: user.id,
        product_type: productType,
        product_ref_id: productRefId,
        toss_order_id: tossOrderId,
        order_name: config.orderName,
        amount: config.amount,
        status: "ready",
      })
      .select("id")
      .single();

    if (saveOrderRes.error || !saveOrderRes.data?.id) {
      console.error("[toss-test-create] toss order insert failed", saveOrderRes.error);
      return json(500, { ok: false, code: "CREATE_ORDER_FAILED", requestId, message: "결제 주문 저장에 실패했습니다." });
    }

    const baseUrl = getBaseUrl(req);
    const successUrl = `${baseUrl}/payments/test/success`;
    const failUrl = `${baseUrl}/payments/test/fail`;

    const payment = await createTossTestPayment({
      method: "CARD",
      amount: config.amount,
      orderId: tossOrderId,
      orderName: config.orderName,
      successUrl,
      failUrl,
      customerEmail: user.email ?? undefined,
      customerName: "Toss Test User",
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
    console.error("[toss-test-create] unhandled", error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}

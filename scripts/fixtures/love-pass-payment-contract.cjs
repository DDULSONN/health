/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');

// Synthetic checkout tests cover these exact additive branches. Continue to
// pin every byte of the prior checkout/disclosure contracts outside them.
const createOnly = [
  'import { createLovePassCheckout, LovePassCheckoutError } from "@/lib/dating-love-pass-checkout";\n',
  `    if (body.productType === "dating_love_pass_30d") {
      try {
        return json(200, { ...await createLovePassCheckout(createAdminClient(), user, getBaseUrl(req)), requestId });
      } catch (error) {
        if (error instanceof LovePassCheckoutError) return json(error.status, { ok: false, code: error.code, requestId, message: error.message });
        throw error;
      }
    }
`,
];

const confirmOnly = [
  'import { activateLovePassOrder, LovePassCheckoutError } from "@/lib/dating-love-pass-checkout";\n',
  '    | "dating_love_pass_30d"\n',
  `async function finalizeLovePassConfirmation(
  admin: ReturnType<typeof createAdminClient>,
  order: TossOrderRow,
  paymentKey: string,
  requestId: string,
  approvedPayment?: TossConfirmPaymentResponse,
) {
  try {
    await activateLovePassOrder(admin, order.toss_order_id, paymentKey, approvedPayment);
  } catch (error) {
    if (error instanceof LovePassCheckoutError) return json(error.status, { ok: false, code: error.code, requestId, message: error.message });
    throw error;
  }
  return json(200, {
    ok: true, requestId, orderId: order.toss_order_id, orderName: order.order_name,
    productType: order.product_type, amount: order.amount, method: approvedPayment?.method ?? null,
    alreadyConfirmed: !approvedPayment,
  });
}

`,
  `      if (order.product_type === "dating_love_pass_30d") {
        return await finalizeLovePassConfirmation(admin, order, paymentKey, requestId);
      }
`,
  `    if (order.product_type === "dating_love_pass_30d") {
      // Do not use the generic paid update. The grant and paid status for this
      // product must both commit or both roll back on duplicate/failed delivery.
      return await finalizeLovePassConfirmation(admin, order, paymentKey, requestId, payment);
    }

`,
];

function withoutLovePassPaymentAdditions(source, kind) {
  source = source.replace(/\r\n/g, '\n');
  for (const addition of kind === 'create' ? createOnly : confirmOnly) {
    assert.equal(source.split(addition).length, 2, 'Exact reviewed love-pass checkout addition: ' + kind);
    source = source.replace(addition, '');
  }
  return source;
}

function withoutLovePassMypageAdditions(source) {
  source = source.replace(/\r\n/g, '\n');
  const additions = [
    '  if (order.product_type === "dating_love_pass_30d") return "짐툴 연애 패스";\n',
    '  if (order.product_type === "dating_love_pass_30d") return "연애 패스 혜택 적용 완료";\n',
    `        amount?: number;
        alreadyActive?: boolean;
      };
      if (res.ok && body.ok && order.product_type === "dating_love_pass_30d" && body.alreadyActive) {
        window.location.href = "/dating/love-pass";
        return;
      }
      if (!res.ok || body.ok === false || !body.checkoutUrl) {
`,
    `                                      : order.product_type === "dating_love_pass_30d"
                                        ? "짐툴 연애 패스"
`,
  ];
  for (const [index, addition] of additions.entries()) {
    assert.equal(source.split(addition).length, 2, 'Exact reviewed love-pass MyPage addition: ' + (index + 1));
    const previous = index === 2 ? `        amount?: number;
      };
      if (!res.ok || body.ok === false || !body.checkoutUrl) {
` : '';
    source = source.replace(addition, previous);
  }
  return source;
}

module.exports = { withoutLovePassPaymentAdditions, withoutLovePassMypageAdditions };

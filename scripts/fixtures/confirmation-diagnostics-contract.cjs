/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
// Retain the pre-diagnostics approval/fulfillment hash in older safety suites.
// Remove ONLY these exact, separately integration-tested diagnostic changes.
function withoutConfirmationDiagnostics(source) {
  source = require('./private-contact-contract.cjs').withoutPrivateConfirmation(source);
  source = source.replace(/\r\n/g, '\n');
  const changes = [
    ['import { getPaymentConfirmationFailureCode, getPaymentConfirmationFailureMessage, recordPaymentConfirmationFailure } from "@/lib/payment-confirmation-diagnostics";\n', ''],
    ['function toAmount(value: unknown) {', 'const PAYMENT_CARD_UNAVAILABLE_MESSAGE = "현재 국민/우리/현대 카드는 결제가 되지 않습니다. 다른 카드나 다른 결제수단으로 다시 시도해 주세요.";\n\nfunction toAmount(value: unknown) {'],
    [`    let payment: TossConfirmPaymentResponse;
    try {
      payment = recoveredOfferPayment ?? await confirmOrRecoverTossPayment({ paymentKey, orderId, amount });
    } catch (confirmError) {
      const providerCode = getPaymentConfirmationFailureCode(confirmError);
      await recordPaymentConfirmationFailure(admin, order, providerCode);
      console.warn("[toss-confirm] approval unresolved", { requestId, orderId: order.id, providerCode });
      return json(502, { ok: false, code: "PAYMENT_CONFIRMATION_UNRESOLVED", providerCode, requestId,
        message: getPaymentConfirmationFailureMessage(providerCode) });
    }`, '    const payment = recoveredOfferPayment ?? await confirmOrRecoverTossPayment({ paymentKey, orderId, amount });'],
    ['    console.error("[toss-confirm] unhandled", { requestId, code: getPaymentConfirmationFailureCode(error) });', '    console.error("[toss-confirm] unhandled", error);'],
    ['      message: "결제 처리 결과를 확인하지 못했어요. 다시 결제하지 말고 결제센터에서 내역을 확인해 주세요. 해결되지 않으면 고객센터로 문의해 주세요.",', '      message: `결제 확인 중 오류가 발생했습니다. ${PAYMENT_CARD_UNAVAILABLE_MESSAGE}`,'],
  ];
  for (const [from,to] of changes) {
    assert.equal(source.split(from).length, 2, 'Reviewed diagnostics patch must appear exactly once');
    source = source.replace(from,to);
  }
  return source;
}
module.exports = { withoutConfirmationDiagnostics };

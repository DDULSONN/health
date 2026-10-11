import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTACT_INTRO_PRICE, isContactIntroId, isContactIntroOffer, type ContactIntroOffer } from "@/lib/contact-intro-offer";
import { createTossPayment, getTossCheckoutOptions, getTossPaymentByOrderId } from "@/lib/toss-payments";

export class ContactIntroError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
const unavailable = () => new ContactIntroError("CONTACT_INTRO_UNAVAILABLE", "할인 또는 매칭 상태가 변경됐어요. 새로고침 후 확인해 주세요.");
const checkPayment = () => new ContactIntroError("CONTACT_INTRO_PAYMENT_CHECK", "진행 중인 결제를 확인해야 해요. 추가 결제하지 말고 잠시 후 내 매칭을 확인해 주세요.");
export async function readContactIntroOffer(admin: SupabaseClient, userId: string, matchId: string, checkout = false) {
  const { data, error } = await admin.rpc("read_contact_intro_offer", { p_user_id: userId, p_match_id: matchId, p_checkout: checkout })
    .abortSignal(AbortSignal.timeout(4000));
  // Installing the app before the optional migration leaves normal pricing intact.
  if (error && ["PGRST202", "42883"].includes(error.code)) return null;
  if (error) throw unavailable();
  if (data === null) return null;
  if (!isContactIntroOffer(data) || data.matchId !== matchId) throw unavailable();
  return data;
}
type Order = { id: string; orderId: string; amount: number; orderName: string; expiresAt: string; reused: boolean; owned: boolean };
async function reserve(admin: SupabaseClient, userId: string, offer: ContactIntroOffer, replaceOrderId: string | null = null) {
  const { data, error } = await admin.rpc("reserve_contact_intro_order", {
    p_user_id: userId, p_match_id: offer.matchId, p_offer_id: offer.offerId, p_replace_order_id: replaceOrderId,
  }).abortSignal(AbortSignal.timeout(4000));
  if (error || !data || !isContactIntroId(data.id) || !/^[0-9a-f]{32}$/i.test(data.orderId) ||
    data.amount !== CONTACT_INTRO_PRICE || typeof data.orderName !== "string" || typeof data.reused !== "boolean" ||
    typeof data.owned !== "boolean" || !Number.isFinite(Date.parse(data.expiresAt))) throw unavailable();
  return data as Order;
}
function checkoutUrl(raw: string | undefined) {
  try {
    const url = new URL(raw ?? "");
    if (url.protocol === "https:" && !url.username && !url.password &&
      (url.hostname === "tosspayments.com" || url.hostname.endsWith(".tosspayments.com"))) return url.href;
  } catch { /* Invalid provider URL cannot redirect the user. */ }
  throw checkPayment();
}
export async function createContactIntroCheckout(admin: SupabaseClient, user: { id: string; email?: string }, offer: ContactIntroOffer, baseUrl: string) {
  let order = await reserve(admin, user.id, offer);
  if (order.reused) {
    let payment;
    try { payment = await getTossPaymentByOrderId(order.orderId); }
    catch (error) {
      let code: unknown;
      try { code = JSON.parse(error instanceof Error ? error.message : "").code; } catch { /* Unknown is not unpaid. */ }
      if (code !== "NOT_FOUND_PAYMENT") throw checkPayment();
    }
    if (payment) {
      if (payment.orderId !== order.orderId || payment.totalAmount !== order.amount) throw checkPayment();
      if (payment.status === "DONE") {
        if (!order.owned || !payment.paymentKey) throw checkPayment();
        const url = new URL("/payments/success", baseUrl);
        url.searchParams.set("productType", "one_on_one_contact_exchange");
        url.searchParams.set("orderId", order.orderId);
        url.searchParams.set("paymentKey", payment.paymentKey);
        url.searchParams.set("amount", String(order.amount));
        return { ok: true, amount: order.amount, checkoutUrl: url.href, reusedOrder: true };
      }
      if (payment.status === "READY") {
        if (!order.owned) throw checkPayment();
        return { ok: true, amount: order.amount, checkoutUrl: checkoutUrl(payment.checkout?.url), reusedOrder: true };
      }
      if (["ABORTED", "EXPIRED"].includes(payment.status ?? "")) order = await reserve(admin, user.id, offer, order.id);
      else throw checkPayment();
    }
  }
  // The DB gates first reservations using its clock. Honor an existing price on
  // recovery, including crossing the deadline between reservation and redirect.
  if (!order.owned) throw unavailable();
  const success = new URL("/payments/success", baseUrl), fail = new URL("/payments/fail", baseUrl);
  success.searchParams.set("productType", "one_on_one_contact_exchange");
  fail.searchParams.set("productType", "one_on_one_contact_exchange");
  fail.searchParams.set("failedOrderId", order.orderId);
  const payment = await createTossPayment({ method: "CARD", amount: order.amount, orderId: order.orderId,
    orderName: order.orderName, successUrl: success.href, failUrl: fail.href,
    customerEmail: user.email, customerName: "GymTools User", ...getTossCheckoutOptions(),
  }, { idempotencyKey: "contact-intro:" + order.orderId });
  return { ok: true, orderId: order.orderId, amount: order.amount, checkoutUrl: checkoutUrl(payment.checkout?.url), reusedOrder: order.reused };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertOneOnOnePlusSchemaReady } from "@/lib/dating-1on1-plus";
import { ALL_PASS_PROFILE_DISCOUNT_PRICE, ALL_PASS_PROFILE_OFFER_KEY, isAllPassProfileOffer } from "@/lib/all-pass-profile-offer";
import { createTossPayment, getTossCheckoutOptions, getTossPayment, getTossPaymentByOrderId, type TossConfirmPaymentResponse } from "@/lib/toss-payments";

export class AllPassOfferError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
const unavailable = () => new AllPassOfferError("ALL_PASS_OFFER_UNAVAILABLE", "할인 기간 또는 프로필 상태가 변경됐어요. 새로고침 후 확인해 주세요.");
const unknownPayment = () => new AllPassOfferError("ALL_PASS_PAYMENT_CHECK_REQUIRED", "결제 상태를 확인하지 못했어요. 추가 결제하지 말고 잠시 후 다시 확인해 주세요.", 503);
export async function readAllPassProfileOffer(admin: SupabaseClient, userId: string, start = false) {
  const { data, error } = await admin.rpc(start ? "start_all_pass_profile_offer" : "all_pass_profile_offer_status", { p_user_id: userId })
    .abortSignal(AbortSignal.timeout(4000));
  if (error && ["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code)) return null;
  if (error) throw unavailable();
  if (data === null) return null;
  if (!isAllPassProfileOffer(data)) throw unavailable();
  return data;
}
type OfferOrder = { id: string; orderId: string; amount: number; orderName: string; expiresAt: string; reused: boolean };
async function reserve(admin: SupabaseClient, userId: string, offerId: string, replaceOrderId: string | null = null) {
  const { data, error } = await admin.rpc("reserve_all_pass_profile_offer_order", {
    p_user_id: userId, p_offer_id: offerId, p_replace_order_id: replaceOrderId,
  }).abortSignal(AbortSignal.timeout(4000));
  if (error || !data || data.amount !== ALL_PASS_PROFILE_DISCOUNT_PRICE ||
    !/^[0-9a-f-]{36}$/i.test(data.id) || !/^[0-9a-f]{32}$/i.test(data.orderId) ||
    typeof data.orderName !== "string" || typeof data.reused !== "boolean" || !Number.isFinite(Date.parse(data.expiresAt))) throw unavailable();
  return data as OfferOrder;
}
function safeCheckoutUrl(raw: string | undefined) {
  try {
    const url = new URL(raw ?? "");
    if (url.protocol === "https:" && !url.username && !url.password &&
      (url.hostname === "tosspayments.com" || url.hostname.endsWith(".tosspayments.com"))) return url.href;
  } catch { /* reject untrusted redirects */ }
  throw unknownPayment();
}
function matchingPayment(payment: TossConfirmPaymentResponse, orderId: string, amount: number) {
  return payment.orderId === orderId && payment.totalAmount === amount;
}
function recoveryUrl(baseUrl: string, order: OfferOrder, payment: TossConfirmPaymentResponse) {
  if (!payment.paymentKey || !matchingPayment(payment, order.orderId, order.amount)) throw unknownPayment();
  const url = new URL("/payments/success", baseUrl);
  url.searchParams.set("productType", "dating_all_pass_30d");
  url.searchParams.set("paymentKey", payment.paymentKey);
  url.searchParams.set("orderId", order.orderId);
  url.searchParams.set("amount", String(order.amount));
  return url.href;
}
export async function createAllPassProfileOfferCheckout(admin: SupabaseClient, user: { id: string; email?: string }, offerId: unknown, baseUrl: string) {
  if (typeof offerId !== "string" || !/^[0-9a-f-]{36}$/i.test(offerId)) throw unavailable();
  // Preserve the standard checkout's pre-charge entitlement-schema check.
  try { await assertOneOnOnePlusSchemaReady(admin); }
  catch { throw new AllPassOfferError("PAYMENT_SCHEMA_OUTDATED", "플러스 이용 설정을 확인하지 못했어요. 결제하지 말고 잠시 후 다시 확인해 주세요.", 503); }
  let order = await reserve(admin, user.id, offerId);
  if (order.reused) {
    let payment: TossConfirmPaymentResponse | null = null;
    try { payment = await getTossPaymentByOrderId(order.orderId); }
    catch (error) {
      // Only an explicit provider NOT_FOUND may retry the SAME idempotent create.
      let code: string | undefined;
      try { code = JSON.parse(error instanceof Error ? error.message : "").code; } catch { /* outage is unknown */ }
      if (code !== "NOT_FOUND_PAYMENT") throw unknownPayment();
    }
    if (payment) {
      if (!matchingPayment(payment, order.orderId, order.amount)) throw unknownPayment();
      if (payment.status === "DONE") return { ok: true, amount: order.amount, checkoutUrl: recoveryUrl(baseUrl, order, payment), reusedOrder: true };
      if (payment.status === "READY") return { ok: true, amount: order.amount, checkoutUrl: safeCheckoutUrl(payment.checkout?.url), reusedOrder: true };
      if (["ABORTED", "EXPIRED"].includes(payment.status ?? "")) order = await reserve(admin, user.id, offerId, order.id);
      else throw unknownPayment();
    }
  }
  if (Date.parse(order.expiresAt) <= Date.now()) throw unavailable();
  const success = new URL("/payments/success", baseUrl), fail = new URL("/payments/fail", baseUrl);
  success.searchParams.set("productType", "dating_all_pass_30d");
  fail.searchParams.set("productType", "dating_all_pass_30d");
  fail.searchParams.set("failedOrderId", order.orderId);
  const payment = await createTossPayment({ method: "CARD", amount: order.amount, orderId: order.orderId,
    orderName: order.orderName, successUrl: success.href, failUrl: fail.href,
    customerEmail: user.email, customerName: "GymTools User", ...getTossCheckoutOptions(),
  }, { idempotencyKey: "all-pass-profile:" + order.orderId });
  return { ok: true, amount: order.amount, orderId: order.orderId, checkoutUrl: safeCheckoutUrl(payment.checkout?.url), reusedOrder: order.reused };
}

// Only the discount path calls this. Ordinary payments and fulfillment remain unchanged.
// The private offer/order binding is authoritative, not editable order metadata alone.
export async function checkAllPassProfileOfferPayment(admin: SupabaseClient,
  order: { id: string; user_id: string; amount: number; toss_order_id: string; product_meta: Record<string, unknown> | null }, paymentKey: string) {
  if (order.product_meta?.profileAllPassOfferKey !== ALL_PASS_PROFILE_OFFER_KEY || order.amount !== ALL_PASS_PROFILE_DISCOUNT_PRICE) throw unavailable();
  const { data, error } = await admin.from("all_pass_profile_offers").select("offer_id,order_id,expires_at")
    .eq("user_id", order.user_id).eq("order_id", order.id).maybeSingle();
  if (error || !data || data.offer_id !== order.product_meta.profileAllPassOfferId || !Number.isFinite(Date.parse(data.expires_at))) throw unavailable();
  if (Date.parse(data.expires_at) > Date.now()) {
    const offer = await readAllPassProfileOffer(admin, order.user_id);
    if (offer?.state === "active" && offer.offerId === data.offer_id) return null;
    throw unavailable();
  }
  // The deadline cannot create a fresh charge, but never strand money already approved.
  const payment = await getTossPayment(paymentKey).catch(() => { throw unknownPayment(); });
  if (payment.status === "DONE" && payment.paymentKey === paymentKey && matchingPayment(payment, order.toss_order_id, order.amount)) return payment;
  throw new AllPassOfferError("ALL_PASS_OFFER_EXPIRED", "24시간 할인 기간이 끝났어요. 이 주문으로는 추가 결제되지 않습니다.");
}

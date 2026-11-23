import { OPEN_QUICK_PASS } from "@/lib/dating-open-quick-pass";
import { getPaymentConfirmationFailureCode } from "@/lib/payment-confirmation-diagnostics";
import type { createAdminClient } from "@/lib/supabase/server";
import { createTossPayment, getTossCheckoutMode, getTossCheckoutOptions, getTossPaymentByOrderId, type TossConfirmPaymentResponse } from "@/lib/toss-payments";

export const DATING_LOVE_PASS_PRODUCT_TYPE = "dating_love_pass_30d";
export const DATING_LOVE_PASS_ORDER_NAME = "짐툴 연애 패스";

const orderAmount = OPEN_QUICK_PASS.priceKrw;
const orderIdPattern = /^[a-f0-9]{32}$/;
const paymentRowIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const checkoutTerminalStatuses = new Set(["ABORTED", "EXPIRED", "CANCELED"]);
const common = { ok: true, productType: DATING_LOVE_PASS_PRODUCT_TYPE, amount: orderAmount } as const;

export class LovePassCheckoutError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}

function statusUnknown() {
  return new LovePassCheckoutError("LOVE_PASS_PAYMENT_UNRESOLVED", 503, "연애 패스 결제를 확인 중이에요. 이미 출금됐다면 다시 결제하지 말고 잠시 후 이 화면에서 확인해 주세요.");
}

function salesUnavailable() {
  return new LovePassCheckoutError("LOVE_PASS_NOT_ON_SALE", 503, "연애 패스 구매는 아직 이용할 수 없어요.");
}

function orderNotFound() {
  return new LovePassCheckoutError("LOVE_PASS_ORDER_NOT_FOUND", 404, "다시 확인할 연애 패스 결제 내역을 찾지 못했어요. 마이페이지에서 내역을 다시 확인해 주세요.");
}

function checkoutUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.port && !url.username && !url.password &&
      (url.hostname === "tosspayments.com" || url.hostname.endsWith(".tosspayments.com")) ? url.href : null;
  } catch { return null; }
}

/** Must receive server-fetched Toss details, never browser query data. */
export async function activateLovePassOrder(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
  paymentKey: string,
  payment?: TossConfirmPaymentResponse,
) {
  if (payment && (payment.status !== "DONE" || payment.orderId !== orderId || payment.paymentKey !== paymentKey ||
    payment.totalAmount !== orderAmount || !payment.approvedAt || !Number.isFinite(Date.parse(payment.approvedAt)))) {
    throw statusUnknown();
  }
  const result = await admin.rpc("activate_dating_love_pass", {
    p_order_id: orderId,
    p_payment_key: paymentKey,
    ...(payment ? { p_approved_at: payment.approvedAt, p_payment: payment } : {}),
  });
  // The RPC validates provider evidence, records paid, then creates the access
  // grant once in the same transaction. No unrelated product can invoke it.
  if (result.error || typeof result.data !== "string" || !result.data) {
    console.warn("[love-pass] activation unresolved", { databaseCode: result.error?.code ?? "MISSING_GRANT" });
    throw statusUnknown();
  }
}

async function getResumedOrder(admin: ReturnType<typeof createAdminClient>, userId: string, id: unknown) {
  if (typeof id !== "string" || !paymentRowIdPattern.test(id)) throw orderNotFound();
  const { data, error } = await admin.from("toss_test_payment_orders")
    .select("toss_order_id,amount,status,product_meta")
    .eq("id", id).eq("user_id", userId).eq("product_type", DATING_LOVE_PASS_PRODUCT_TYPE)
    .in("status", ["ready", "paid"]).maybeSingle();
  if (error) throw statusUnknown();
  if (!data || data.amount !== orderAmount || !orderIdPattern.test(data.toss_order_id) || data.product_meta?.lovePassVersion !== 1) throw orderNotFound();
  return data;
}

async function readExistingTossPayment(orderId: string) {
  try {
    const payment = await getTossPaymentByOrderId(orderId);
    if (payment.orderId !== orderId || payment.totalAmount !== orderAmount) throw statusUnknown();
    return payment;
  } catch (error) {
    if (getPaymentConfirmationFailureCode(error) === "NOT_FOUND_PAYMENT") return null;
    throw statusUnknown();
  }
}

async function recoverApprovedOrder(admin: ReturnType<typeof createAdminClient>, orderId: string) {
  const payment = await readExistingTossPayment(orderId);
  if (!payment || payment.status === "READY" || payment.status === "IN_PROGRESS" || checkoutTerminalStatuses.has(payment.status ?? "")) {
    throw new LovePassCheckoutError("LOVE_PASS_ORDER_NOT_APPROVED", 409, "이 주문에는 승인된 결제가 없어요. 새 결제는 판매가 다시 열리면 이용할 수 있어요.");
  }
  if (payment.status !== "DONE" || !payment.paymentKey) throw statusUnknown();
  await activateLovePassOrder(admin, orderId, payment.paymentKey, payment);
  return { ...common, alreadyActive: true };
}

export async function createLovePassCheckout(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string | null },
  baseUrl: string,
  resumedFromOrderId?: unknown,
) {
  // The MyPage identifier is a local row UUID, not a provider order ID supplied by the browser.
  const resumed = resumedFromOrderId === undefined ? null : await getResumedOrder(admin, user.id, resumedFromOrderId);
  const ready = await admin.rpc("dating_love_pass_ready");
  if (ready.error || ready.data !== true) {
    // A sales pause blocks new payment, not fulfillment of an already approved charge.
    if (resumed) return recoverApprovedOrder(admin, resumed.toss_order_id);
    throw salesUnavailable();
  }
  if (resumed?.status === "paid") return recoverApprovedOrder(admin, resumed.toss_order_id);

  for (let attempt = 0; attempt < 2; attempt++) {
    const reservation = await admin.rpc("reserve_dating_love_pass_order", {
      p_user_id: user.id,
      p_toss_order_id: crypto.randomUUID().replace(/-/g, ""),
    });
    if (reservation.error || !reservation.data || reservation.data.code === "DISABLED") {
      if (!reservation.error && reservation.data?.code === "DISABLED" && resumed) return recoverApprovedOrder(admin, resumed.toss_order_id);
      throw salesUnavailable();
    }
    if (reservation.data.code === "ACTIVE") return { ...common, alreadyActive: true };
    if (reservation.data.code === "INELIGIBLE") {
      throw new LovePassCheckoutError("LOVE_PASS_PROFILE_REQUIRED", 403, "휴대폰 인증과 오픈카드 등록을 마친 뒤 구매할 수 있어요.");
    }
    const orderId: unknown = reservation.data.toss_order_id;
    if (reservation.data.code !== "READY" || typeof orderId !== "string" || !orderIdPattern.test(orderId) ||
      typeof reservation.data.reused !== "boolean") throw statusUnknown();

    const reusedOrder = reservation.data.reused;
    if (reusedOrder) {
      // A confirmed NOT_FOUND retries the same provider order and stable key.
      // Network errors and browser failure callbacks never replace the order.
      const existing = await readExistingTossPayment(orderId);
      if (existing) {
        if (existing.status === "DONE") {
          if (!existing.paymentKey) throw statusUnknown();
          await activateLovePassOrder(admin, orderId, existing.paymentKey, existing);
          return { ...common, alreadyActive: true };
        }
        if (checkoutTerminalStatuses.has(existing.status ?? "")) {
          const closed = await admin.rpc("close_dating_love_pass_order", {
            p_user_id: user.id, p_toss_order_id: orderId, p_payment: existing,
          });
          if (closed.error || closed.data !== true) throw statusUnknown();
          continue;
        }
        const url = checkoutUrl(existing.checkout?.url);
        if ((existing.status === "READY" || existing.status === "IN_PROGRESS") && url) {
          return { ...common, checkoutUrl: url, orderId, reusedOrder, checkoutMode: getTossCheckoutMode() };
        }
        throw statusUnknown();
      }
    }

    const successUrl = new URL("/payments/success", baseUrl);
    const failUrl = new URL("/payments/fail", baseUrl);
    successUrl.searchParams.set("productType", DATING_LOVE_PASS_PRODUCT_TYPE);
    failUrl.searchParams.set("productType", DATING_LOVE_PASS_PRODUCT_TYPE);
    failUrl.searchParams.set("failedOrderId", orderId);
    try {
      const payment = await createTossPayment({
        method: "CARD", amount: orderAmount, orderId, orderName: DATING_LOVE_PASS_ORDER_NAME,
        successUrl: successUrl.toString(), failUrl: failUrl.toString(),
        customerEmail: user.email ?? undefined, customerName: "GymTools User", ...getTossCheckoutOptions(),
      }, { idempotencyKey: `love-pass:${orderId}` });
      const url = checkoutUrl(payment.checkout?.url);
      if (url) return { ...common, checkoutUrl: url, orderId, reusedOrder, checkoutMode: getTossCheckoutMode() };
    } catch (error) {
      console.warn("[love-pass] checkout unresolved", { providerCode: getPaymentConfirmationFailureCode(error) });
    }
    throw statusUnknown();
  }
  throw statusUnknown();
}

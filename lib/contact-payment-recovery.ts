import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatingOneOnOneCardsByIds } from "@/lib/dating-1on1";
import { isOneOnOnePairAgeEligible } from "@/lib/dating-1on1-age";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactPhoneBlockBetween } from "@/lib/dating-contact-blocks";
import { ONE_ON_ONE_CONTACT_PRICE_KRW } from "@/lib/dating-contact-price";
import { getTossPaymentByOrderId } from "@/lib/toss-payments";

export type ContactPaymentRecovery = {
  matchId: string;
  name: string;
  region: string;
  age: number | null;
  photoUrl: string | null;
  amount: number;
  state: "retry" | "paid" | "pending" | "unavailable";
};

// Never accept arbitrary redirect destinations, even from stored/provider data.
function safeCheckoutUrl(raw: string | undefined): string | null {
  try {
    const url = new URL(raw ?? "");
    return url.protocol === "https:" && !url.username && !url.password &&
      (url.hostname === "tosspayments.com" || url.hostname.endsWith(".tosspayments.com")) ? url.href : null;
  } catch { return null; }
}

// Read-only preflight. Call again at retry time, not just when rendering the page.
// A provider outage/unknown state must never be treated as an unpaid order.
export async function getContactPaymentRecovery(admin: SupabaseClient, userId: string, orderId: string) {
  const orderRes = await admin.from("toss_test_payment_orders")
    .select("id,user_id,product_ref_id,product_type,toss_order_id,amount,status,created_at")
    .eq("toss_order_id", orderId).eq("user_id", userId).maybeSingle();
  if (orderRes.error) throw orderRes.error;
  const order = orderRes.data;
  if (!order || order.product_type !== "one_on_one_contact_exchange" || !order.product_ref_id) return null;
  // Do not reopen old or refunded purchases as a new payment.
  if (Date.now() - Date.parse(order.created_at) > 7 * 86400000 || !Number.isFinite(Date.parse(order.created_at))) return null;
  const matchRes = await admin.from("dating_1on1_match_proposals")
    .select("id,source_user_id,candidate_user_id,source_card_id,candidate_card_id,state,contact_exchange_status,contact_exchange_paid_at")
    .eq("id", order.product_ref_id).maybeSingle();
  if (matchRes.error) throw matchRes.error;
  const match = matchRes.data;
  if (!match || ![match.source_user_id, match.candidate_user_id].includes(userId) || match.state !== "mutual_accepted" || match.contact_exchange_status === "canceled") return null;
  const otherId = match.source_user_id === userId ? match.candidate_user_id : match.source_user_id;
  const otherCardId = match.source_user_id === userId ? match.candidate_card_id : match.source_card_id;
  const [blocked, phoneBlocked, ageEligible, profiles] = await Promise.all([
    hasDatingBlockBetween(admin, userId, otherId),
    hasDatingContactPhoneBlockBetween(admin, userId, otherId),
    isOneOnOnePairAgeEligible(admin, match),
    admin.from("profiles").select("user_id,is_banned").in("user_id", [userId, otherId]),
  ]);
  if (profiles.error) throw profiles.error;
  if (blocked || phoneBlocked || !ageEligible || profiles.data?.length !== 2 || profiles.data.some(row => row.is_banned)) return null;
  const card = (await getDatingOneOnOneCardsByIds(admin, [otherCardId])).get(otherCardId);
  if (!card || card.user_id !== otherId || card.status === "rejected") return null;
  const view: ContactPaymentRecovery = {
    matchId: match.id, name: card.name, region: card.region, age: card.age,
    photoUrl: card.photo_signed_urls[0] ?? null, amount: ONE_ON_ONE_CONTACT_PRICE_KRW, state: "unavailable",
  };
  if (order.status === "paid" || match.contact_exchange_status === "approved" || match.contact_exchange_paid_at) {
    view.state = "paid";
    return { view, checkoutUrl: null };
  }
  // Inspect both participants' recent attempts, not only the failed redirect's order.
  const history = await admin.from("toss_test_payment_orders")
    .select("id,user_id,toss_order_id,amount,status")
    .eq("product_type", "one_on_one_contact_exchange").eq("product_ref_id", match.id)
    .order("created_at", { ascending: false }).limit(9);
  if (history.error) throw history.error;
  const rows = history.data ?? [];
  if (rows.some(row => row.status === "paid")) return { view: { ...view, state: "paid" as const }, checkoutUrl: null };
  // Limit provider calls; unusually long histories require manual payment review.
  if (rows.length > 8) return { view, checkoutUrl: null };
  const relevant = [...rows];
  if (!relevant.some(row => row.toss_order_id === orderId)) relevant.push(order);
  if (relevant.length > 8) return { view, checkoutUrl: null };
  const payments = await Promise.all(relevant.map(row => getTossPaymentByOrderId(row.toss_order_id)));
  let checkoutUrl: string | null = null;
  let pending = match.contact_exchange_status === "payment_pending_admin";
  for (const [index, row] of relevant.entries()) {
    const payment = payments[index];
    if (payment.orderId !== row.toss_order_id || payment.totalAmount !== Number(row.amount)) return { view, checkoutUrl: null };
    if (payment.status === "DONE") return { view: { ...view, state: "paid" as const }, checkoutUrl: null };
    if (["IN_PROGRESS", "WAITING_FOR_DEPOSIT"].includes(payment.status ?? "")) { pending = true; continue; }
    if (payment.status === "READY") {
      // A locally canceled READY session cannot be confirmed by our confirm API.
      if (row.status === "canceled") continue;
      // Reopen the SAME order: refreshes/double clicks cannot create another charge.
      const url = safeCheckoutUrl(payment.checkout?.url);
      if (row.user_id !== userId || row.status !== "ready" || Number(row.amount) !== ONE_ON_ONE_CONTACT_PRICE_KRW || !url) pending = true;
      else checkoutUrl ??= url;
    } else if (!["ABORTED", "EXPIRED"].includes(payment.status ?? "")) {
      return { view, checkoutUrl: null };
    }
  }
  view.state = pending ? "pending" : "retry";
  return { view, checkoutUrl: pending ? null : checkoutUrl };
}

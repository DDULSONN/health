import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTACT_CARE_UUID } from "@/lib/contact-care";
import { getTossPaymentByOrderId } from "@/lib/toss-payments";

// Called ONLY after the existing redemption RPC rejects with CARE_CHECKOUT.
// Never infer expiry from elapsed time, cancel a provider payment, or grant a
// voucher here. The unchanged RPC rechecks every condition under its row locks.
export async function reconcileExpiredCareCheckout(
  admin: SupabaseClient, matchId: string, participants: string[],
): Promise<boolean> {
  if (!CONTACT_CARE_UUID.test(matchId) || participants.length !== 2 ||
    new Set(participants).size !== 2 || participants.some(id => !CONTACT_CARE_UUID.test(id))) return false;
  const history = await admin.from("toss_test_payment_orders")
    .select("id,user_id,toss_order_id,amount,status,payment_key,approved_at,canceled_at,cancel_amount")
    .eq("product_type", "one_on_one_contact_exchange").eq("product_ref_id", matchId)
    .or("status.eq.ready,status.eq.paid,payment_key.not.is.null,approved_at.not.is.null")
    .order("created_at", { ascending: false }).limit(9);
  if (history.error) throw history.error;
  const rows = history.data ?? [];
  // Bound provider traffic. Paid/refunded/ambiguous histories need manual review.
  if (rows.length > 8 || rows.some(row => row.status !== "ready" || row.payment_key != null ||
    row.approved_at != null || row.canceled_at != null || (row.cancel_amount != null && row.cancel_amount !== 0) ||
    !participants.includes(row.user_id) || !CONTACT_CARE_UUID.test(row.id) ||
    typeof row.toss_order_id !== "string" || !/^[a-zA-Z0-9_-]{6,64}$/.test(row.toss_order_id) ||
    !Number.isSafeInteger(row.amount) || row.amount <= 0)) return false;

  let payments;
  try {
    payments = await Promise.all(rows.map(row => getTossPaymentByOrderId(row.toss_order_id)));
  } catch {
    // Includes timeout, 404, credentials and provider outages. None prove expiry.
    return false;
  }
  if (payments.some((payment, i) => !payment || payment.orderId !== rows[i].toss_order_id ||
    payment.totalAmount !== rows[i].amount || !["EXPIRED", "ABORTED"].includes(payment.status ?? "") ||
    payment.approvedAt != null || (payment.cancels != null &&
      (!Array.isArray(payment.cancels) || payment.cancels.length > 0)))) return false;

  for (const row of rows) {
    // Compare-and-set: never overwrite an approval or a concurrent state change.
    // This only retires a local checkout; it is NOT a payment cancellation/refund.
    const retired = await admin.from("toss_test_payment_orders")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("toss_order_id", row.toss_order_id).eq("user_id", row.user_id)
      .eq("product_type", "one_on_one_contact_exchange").eq("product_ref_id", matchId)
      .eq("amount", row.amount).eq("status", "ready").is("payment_key", null)
      .is("approved_at", null).is("canceled_at", null)
      .or("cancel_amount.is.null,cancel_amount.eq.0").select("id").maybeSingle();
    if (retired.error) throw retired.error;
    if (!retired.data) return false;
  }
  return true;
}

import { normalizeOneOnOneMatchId } from "@/lib/dating-1on1-match-navigation";

export type ContactOrderDelivery = "delivered" | "processing" | "check_required";

type ContactOrder = {
  id: string;
  product_ref_id: string | null;
  product_type: string;
  product_meta: Record<string, unknown> | null;
  toss_order_id: string;
  status: string;
};

export type ContactOrderMatch = {
  id: string;
  source_user_id: string;
  candidate_user_id: string;
  state: string;
  contact_exchange_status: string | null;
  contact_exchange_paid_by_user_id: string | null;
  contact_exchange_approved_at: string | null;
  contact_exchange_note: string | null;
};

export function contactOrderMatchId(order: ContactOrder): string | null {
  if (order.product_type !== "one_on_one_contact_exchange") return null;
  const stored = normalizeOneOnOneMatchId(order.product_ref_id);
  const legacy = normalizeOneOnOneMatchId(order.product_meta?.matchId);
  if (stored && legacy && stored !== legacy) return null;
  return stored ?? legacy;
}

export function contactOrderDelivery(
  order: ContactOrder,
  match: ContactOrderMatch | undefined,
  userId: string,
): { status: ContactOrderDelivery; matchId: string | null } | null {
  if (order.status !== "paid" || order.product_type !== "one_on_one_contact_exchange") return null;
  if (!match || match.id !== contactOrderMatchId(order) ||
      (match.source_user_id !== userId && match.candidate_user_id !== userId) ||
      match.state !== "mutual_accepted") {
    return { status: "check_required", matchId: null };
  }

  // The other person, a voucher, or a different checkout may have delivered the
  // match. Do not label this order complete without an exact persisted binding.
  const exactCheckoutNote =
    match.contact_exchange_note === `toss payment ${order.toss_order_id} | auto-approved` ||
    match.contact_exchange_note === `instagram:v1:${order.id}`;
  if (match.contact_exchange_status === "approved" &&
      match.contact_exchange_paid_by_user_id === userId &&
      Number.isFinite(Date.parse(match.contact_exchange_approved_at ?? "")) &&
      exactCheckoutNote) {
    return { status: "delivered", matchId: match.id };
  }

  if (["none", "awaiting_applicant_payment", "payment_pending_admin"].includes(match.contact_exchange_status ?? "")) {
    return { status: "processing", matchId: null };
  }
  return { status: "check_required", matchId: null };
}

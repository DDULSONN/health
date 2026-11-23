import type { createAdminClient } from "@/lib/supabase/server";
import { getContactExchangeBlockedPeers } from "@/lib/contact-care-targets";
import { loadOneOnOneContactNudges } from "@/lib/dating-1on1-contact-nudges-server";
import { loadOneOnOneContactReplies } from "@/lib/dating-1on1-contact-replies-server";
import { normalizeOneOnOneMatchId } from "@/lib/dating-1on1-match-navigation";

const DAY = 24 * 60 * 60 * 1000;
const ACTIVE_CARD_STATUSES = ["submitted", "reviewing", "approved"];

// Personal navigation only. No payment eligibility decision or mutations here.
export async function getContactHomeNoticeMatchId(admin: ReturnType<typeof createAdminClient>, viewer: string, now = Date.now()) {
  const { data, error } = await admin.from("dating_1on1_match_proposals")
    .select("id,source_user_id,candidate_user_id,source_card_id,candidate_card_id")
    .or(`source_user_id.eq.${viewer},candidate_user_id.eq.${viewer}`)
    .eq("state", "mutual_accepted")
    .in("contact_exchange_status", ["none", "awaiting_applicant_payment"])
    .is("contact_exchange_paid_at", null).is("contact_exchange_approved_at", null)
    .gte("source_final_responded_at", new Date(now - 7 * DAY).toISOString())
    .lte("source_final_responded_at", new Date(now).toISOString())
    .order("source_final_responded_at", { ascending: false }).order("id", { ascending: false })
    .limit(12);
  if (error) throw error;
  const rows = (data ?? []).filter(row => normalizeOneOnOneMatchId(row.id) &&
    row.source_user_id !== row.candidate_user_id && [row.source_user_id, row.candidate_user_id].includes(viewer));
  if (!rows.length) return null;
  const peer = (row: (typeof rows)[number]) => row.source_user_id === viewer ? row.candidate_user_id : row.source_user_id;
  const ids = rows.map(row => row.id);
  const [blocked, cards, orders, nudges] = await Promise.all([
    getContactExchangeBlockedPeers(admin, viewer, [...new Set(rows.map(peer))]),
    admin.from("dating_1on1_cards").select("id,user_id").in("id", [...new Set(rows.flatMap(row => [row.source_card_id, row.candidate_card_id]))])
      .in("status", ACTIVE_CARD_STATUSES),
    admin.from("toss_test_payment_orders").select("product_ref_id,status,created_at,payment_key,approved_at")
      .eq("product_type", "one_on_one_contact_exchange").in("product_ref_id", ids).in("status", ["ready", "paid"]).limit(120),
    loadOneOnOneContactNudges(admin, ids),
  ]);
  if (cards.error) throw cards.error;
  if (orders.error) throw orders.error;
  if (!nudges.available || (orders.data?.length ?? 0) >= 120) return null;
  const cardOwners = new Map((cards.data ?? []).map(card => [card.id, card.user_id]));
  const busy = new Set((orders.data ?? []).filter(order => order.status === "paid" || order.payment_key || order.approved_at ||
    Date.parse(order.created_at ?? "") >= now - 30 * 60 * 1000).map(order => order.product_ref_id));
  const nudgeIds = nudges.rows.flatMap(row => row.id ? [row.id] : []);
  if (nudgeIds.length !== nudges.rows.length) return null;
  const replies = await loadOneOnOneContactReplies(admin, nudgeIds);
  if (nudgeIds.length && !replies.available) return null;
  const declined = new Set(nudges.rows.filter(row => row.id && replies.replies.get(row.id)?.preset_key === "not_right_now").map(row => row.match_id));
  return rows.find(row => !blocked.has(peer(row)) && !busy.has(row.id) && !declined.has(row.id) &&
    cardOwners.get(row.source_card_id) === row.source_user_id &&
    cardOwners.get(row.candidate_card_id) === row.candidate_user_id)?.id ?? null;
}

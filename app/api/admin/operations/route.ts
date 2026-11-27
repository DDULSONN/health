import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import type { AdminOperationCounts } from "@/lib/admin-operations";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const DAY = 86_400_000;
const PAID_LOOKUP_LIMIT = 200;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Admin = Extract<Awaited<ReturnType<typeof requireAdminRoute>>, { ok: true }>["admin"];

type CountResult = PromiseLike<{ count: number | null; error: unknown }>;
async function safeCount(query: CountResult) {
  try {
    const { count, error } = await query;
    return !error && Number.isSafeInteger(count) && count! >= 0 ? count : null;
  } catch {
    return null;
  }
}

function firstValidId(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && UUID.test(value)) ?? null;
}

async function countPaymentReview(admin: Admin, from: string) {
  try {
    const { data, error } = await admin.from("toss_test_payment_orders")
      .select("id,user_id,product_ref_id,match_hint:product_meta->>matchId")
      .eq("product_type", "one_on_one_contact_exchange").eq("status", "paid")
      .gte("approved_at", from).order("approved_at", { ascending: false }).order("id", { ascending: false })
      .limit(PAID_LOOKUP_LIMIT + 1).abortSignal(AbortSignal.timeout(4_000));
    if (error || !data || data.length > PAID_LOOKUP_LIMIT) return null;

    const payers = new Map<string, Set<string>>();
    for (const row of data) {
      const matchId = firstValidId(row.match_hint, row.product_ref_id);
      if (!matchId || !firstValidId(row.user_id)) continue;
      let users = payers.get(matchId);
      if (!users) payers.set(matchId, users = new Set());
      users.add(row.user_id);
    }
    const ids = [...payers.keys()];
    if (ids.length === 0) return data.length === 0 ? 0 : null;
    const groups = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50));
    const matches = await Promise.all(groups.map((group) => admin.from("dating_1on1_match_proposals")
      .select("id,source_user_id,candidate_user_id,state,contact_exchange_status")
      .in("id", group).abortSignal(AbortSignal.timeout(4_000))));
    if (matches.some((result) => result.error || !result.data)) return null;

    // This is a review queue, never an instruction to disclose or a PG verdict.
    return matches.flatMap((result) => result.data ?? []).filter((match) => {
      const users = payers.get(match.id);
      return users && (users.has(match.source_user_id) || users.has(match.candidate_user_id)) &&
        ["candidate_accepted", "mutual_accepted"].includes(match.state) &&
        ["none", "awaiting_applicant_payment", "payment_pending_admin"].includes(match.contact_exchange_status);
    }).length;
  } catch {
    return null;
  }
}

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) {
    return NextResponse.json({ error: "관리자 로그인이 필요해요." }, { status: auth.response.status, headers });
  }
  const { admin } = auth;
  const now = Date.now();
  const dayAgo = new Date(now - DAY).toISOString();
  const weekAgo = new Date(now - 7 * DAY).toISOString();
  const fortnightAgo = new Date(now - 14 * DAY).toISOString();
  const [paymentReview, agedCheckout, checkoutHelp, vouchers, profileReview, datingReports, support] = await Promise.all([
    countPaymentReview(admin, weekAgo),
    safeCount(admin.from("toss_test_payment_orders").select("id", { count: "exact", head: true })
      .eq("product_type", "one_on_one_contact_exchange").eq("status", "ready")
      .gte("created_at", fortnightAgo).lt("created_at", dayAgo).abortSignal(AbortSignal.timeout(4_000))),
    safeCount(admin.from("contact_care_checkout_support").select("id", { count: "exact", head: true })
      .is("resolved_at", null).abortSignal(AbortSignal.timeout(4_000))),
    safeCount(admin.from("contact_care_claims").select("id", { count: "exact", head: true })
      .in("status", ["pending", "needs_info"]).abortSignal(AbortSignal.timeout(4_000))),
    safeCount(admin.from("dating_profile_review_jobs").select("card_id", { count: "exact", head: true })
      .eq("resolution", "open").or("state.eq.failed,and(state.eq.complete,result->>suspicionLevel.neq.clear)")
      .abortSignal(AbortSignal.timeout(4_000))),
    safeCount(admin.from("dating_user_reports").select("id", { count: "exact", head: true })
      .eq("status", "open").abortSignal(AbortSignal.timeout(4_000))),
    safeCount(admin.from("support_inquiries").select("id", { count: "exact", head: true })
      .eq("status", "open").abortSignal(AbortSignal.timeout(4_000))),
  ]);
  const counts: AdminOperationCounts = { paymentReview, agedCheckout, checkoutHelp, vouchers, profileReview, datingReports, support };
  return NextResponse.json({ counts, checkedAt: new Date(now).toISOString() }, { headers });
}

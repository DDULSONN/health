import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { CONTACT_CARE_UUID } from "@/lib/contact-care";
import { careJson, parseCareCursor, readCareJson } from "@/lib/contact-care-server";
import { CARE_CHECKOUT_SUPPORT_REASONS, isCareCheckoutSupportUnavailable } from "@/lib/contact-care-checkout-support";

async function requireSupportAdmin() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth;
  const profile = await auth.admin.from("profiles").select("role,is_banned").eq("user_id", auth.user.id).maybeSingle();
  if (profile.error) throw profile.error;
  const bannedUntil = auth.user.banned_until;
  if (profile.data?.role !== "admin" || profile.data.is_banned || auth.user.deleted_at ||
    (bannedUntil && !(Date.parse(bannedUntil) <= Date.now()))) {
    return { ok: false as const, response: careJson({ error: "활성 관리자 계정만 이용할 수 있어요." }, 403) };
  }
  return auth;
}

function supportError(error: unknown) {
  const e = error as { code?: string; message?: string } | null;
  if (isCareCheckoutSupportUnavailable(e?.code)) {
    return careJson({ code: "CARE_SUPPORT_UNAVAILABLE", error: "교환권 사용 문의 기능의 SQL이 아직 적용되지 않았어요." }, 503);
  }
  if (e?.message === "CARE_SUPPORT_ADMIN") return careJson({ error: "활성 관리자 계정만 이용할 수 있어요." }, 403);
  if (e?.message === "CARE_SUPPORT_MISSING") return careJson({ error: "해당 접수 내역을 찾지 못했어요." }, 404);
  console.error("[admin-contact-care-checkout-support] request failed", e?.code ?? "unknown");
  return careJson({ error: "접수 내역을 확인하지 못했어요. 같은 접수 번호로 다시 확인해 주세요." }, 500);
}

export async function GET(req: Request) {
  try {
    const auth = await requireSupportAdmin();
    if (!auth.ok) return auth.response;
    const params = new URL(req.url).searchParams;
    const reference = params.get("reference");
    const state = params.get("state") ?? (reference ? "all" : "open");
    const reason = params.get("reason");
    const before = params.get("before");
    const cursor = before === null ? null : parseCareCursor(before);
    const limitText = params.get("limit");
    const limit = limitText === null ? 20 : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (limitText !== null && !/^\d{1,2}$/.test(limitText)) ||
      !["open", "resolved", "all"].includes(state) ||
      (reason !== null && !CARE_CHECKOUT_SUPPORT_REASONS.some(value => value === reason)) ||
      (reference !== null && !CONTACT_CARE_UUID.test(reference)) || (before !== null && !cursor) || (reference && cursor)) {
      return careJson({ error: "조회 조건을 확인해 주세요." }, 400);
    }
    let query = auth.admin.from("contact_care_checkout_support")
      .select("id,user_id,match_id,reason,created_at,resolved_at,resolved_by");
    if (state === "open") query = query.is("resolved_at", null);
    if (state === "resolved") query = query.not("resolved_at", "is", null);
    if (reason !== null) query = query.eq("reason", reason);
    if (reference) query = query.eq("id", reference);
    if (cursor) query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const result = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (result.error) throw result.error;
    const rows = (result.data ?? []).slice(0, limit);
    const tail = rows.at(-1);
    const nextCursor = !reference && (result.data?.length ?? 0) > limit && tail ? `${tail.created_at}|${tail.id}` : null;
    let orders: { orderNumber: string | null; status: string; createdAt: string; approvedAt: string | null }[] | null = reference ? [] : null;
    if (reference && tail) {
      const orderPage = () => auth.admin.from("toss_test_payment_orders").select("toss_order_id,status,created_at,approved_at")
        .eq("product_type", "one_on_one_contact_exchange").eq("product_ref_id", tail.match_id)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(9);
      // Keep an older row that still holds the voucher visible, even after many
      // newer terminal attempts. Fall back to context after the hold clears.
      const blockers = await orderPage().or("status.eq.ready,status.eq.paid,payment_key.not.is.null,approved_at.not.is.null");
      if (blockers.error) throw blockers.error;
      const orderResult = blockers.data?.length ? blockers : await orderPage();
      if (orderResult.error) throw orderResult.error;
      orders = (orderResult.data ?? []).map(row => ({ orderNumber: typeof row.toss_order_id === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(row.toss_order_id) ? row.toss_order_id : null, status: row.status,
        createdAt: row.created_at, approvedAt: row.approved_at }));
    }
    return careJson({ requests: rows.map(row => ({ reference: row.id, memberId: row.user_id, matchId: row.match_id,
      reason: row.reason, createdAt: row.created_at, resolvedAt: row.resolved_at, resolvedBy: row.resolved_by })), nextCursor, orders });
  } catch (error) { return supportError(error); }
}

export async function PATCH(req: Request) {
  const origin = ensureAllowedMutationOrigin(req);
  if (origin) return origin;
  try {
    const auth = await requireSupportAdmin();
    if (!auth.ok) return auth.response;
    let body;
    try { body = await readCareJson(req, 512); } catch { return careJson({ error: "접수 번호를 확인해 주세요." }, 400); }
    if (body?.action !== "resolve" || typeof body.reference !== "string" || !CONTACT_CARE_UUID.test(body.reference)) {
      return careJson({ error: "접수 번호를 확인해 주세요." }, 400);
    }
    const reference = body.reference.toLowerCase();
    const result = await auth.admin.rpc("resolve_contact_care_checkout_support", { p_admin: auth.user.id, p_reference: reference });
    if (result.error) throw result.error;
    const data = result.data;
    if (data?.ok !== true || data.reference !== reference || typeof data.resolvedAt !== "string" ||
      !Number.isFinite(Date.parse(data.resolvedAt)) || typeof data.resolvedBy !== "string" ||
      !CONTACT_CARE_UUID.test(data.resolvedBy) || typeof data.alreadyResolved !== "boolean") throw Error("INVALID_SUPPORT_RESULT");
    return careJson({ ok: true, reference, resolvedAt: data.resolvedAt, resolvedBy: data.resolvedBy, alreadyResolved: data.alreadyResolved });
  } catch (error) { return supportError(error); }
}

import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { CONTACT_CARE_UUID } from "@/lib/contact-care";
import { careJson, careError, CARE_CLAIM_FIELDS, parseCareCursor, readCareJson } from "@/lib/contact-care-server";

export async function GET(req: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;
  const search = new URL(req.url).searchParams;
  const user = search.get("userId");
  const before = search.get("before");
  const cursor = before ? parseCareCursor(before) : null;
  if ((user && !CONTACT_CARE_UUID.test(user)) || (before && !cursor)) return careJson({ error: "조회 조건을 확인해 주세요." }, 400);
  try {
    let query = auth.admin.from("contact_care_claims").select(CARE_CLAIM_FIELDS)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(21);
    query = user ? query.eq("user_id", user) : query.in("status", ["pending", "needs_info"]);
    if (cursor) query = query.or(`created_at.gt.${cursor.at},and(created_at.eq.${cursor.at},id.gt.${cursor.id})`);
    const res = await query;
    if (res.error) throw res.error;
    const rows = (res.data ?? []).slice(0, 20);
    const ids = [...new Set(rows.map(r => r.user_id))];
    const profiles = ids.length ? await auth.admin.from("profiles").select("user_id,nickname").in("user_id", ids) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const matches = rows.length ? await auth.admin.from("dating_1on1_match_proposals").select("id,source_user_id,source_card_id,candidate_card_id,contact_exchange_approved_at").in("id", rows.map(r => r.match_id)) : { data: [], error: null };
    if (matches.error) throw matches.error;
    const cards = [...new Set((matches.data ?? []).flatMap(m => [m.source_card_id, m.candidate_card_id]))];
    const names = cards.length ? await auth.admin.from("dating_1on1_cards").select("id,name").in("id", cards) : { data: [], error: null };
    if (names.error) throw names.error;
    return careJson({ items: rows.map(r => {
      const match = matches.data?.find(m => m.id === r.match_id);
      const counterpart = match?.source_user_id === r.user_id ? match?.candidate_card_id : match?.source_card_id;
      return { ...r, nickname: profiles.data?.find(p => p.user_id === r.user_id)?.nickname ?? "회원",
        counterparty_name: r.counterparty_name || names.data?.find(c => c.id === counterpart)?.name || "상대 프로필", exchanged_at: r.exchanged_at ?? match?.contact_exchange_approved_at ?? null };
    }),
      next: (res.data?.length ?? 0) > 20 ? `${rows[rows.length - 1].created_at}|${rows[rows.length - 1].id}` : null });
  } catch (error) { return careError(error); }
}

export async function POST(req: Request) {
  const origin = ensureAllowedMutationOrigin(req);
  if (origin) return origin;
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;
  let body;
  try {
    body = await readCareJson(req, 2000);
  } catch { return careJson({ error: "입력 내용을 확인해 주세요." }, 400); }
  if (body?.action === "cleanup") {
    try {
      const staged = await auth.admin.rpc("cleanup_contact_care_uploads", { p_admin: auth.user.id });
      if (staged.error) throw staged.error;
      let removed = 0;
      for (const row of staged.data ?? []) {
        const files = await auth.admin.storage.from("contact-care-evidence").remove(row.paths);
        if (files.error) throw files.error;
        const done = await auth.admin.rpc("finish_contact_care_cleanup", { p_admin: auth.user.id, p_upload: row.id });
        if (done.error) throw done.error;
        removed += row.paths.length;
      }
      return careJson({ ok: true, removed });
    } catch (error) { return careError(error); }
  }
  if (!body || typeof body.claimId !== "string" || !CONTACT_CARE_UUID.test(body.claimId) ||
    !["approved", "rejected", "needs_info"].includes(body.decision) || typeof body.note !== "string" || body.note.trim().length < 5 || body.note.length > 300 ||
    (body.decision === "approved" && body.evidenceChecked !== true)) return careJson({ error: "검토 사유와 증빙 확인을 입력해 주세요." }, 400);
  try {
    const res = await auth.admin.rpc("review_contact_care", { p_claim: body.claimId, p_admin: auth.user.id,
      p_decision: body.decision, p_checked: body.evidenceChecked === true, p_note: body.note.trim() });
    if (res.error) throw res.error;
    return careJson(res.data);
  } catch (error) { return careError(error); }
}

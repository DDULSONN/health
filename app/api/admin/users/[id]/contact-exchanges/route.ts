import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { ADMIN_CONTACT_EXCHANGE_PAGE_SIZE, ADMIN_CONTACT_EXCHANGE_UUID } from "@/lib/admin-contact-exchanges";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;
  const userId = (await params).id.toLowerCase();
  if (!ADMIN_CONTACT_EXCHANGE_UUID.test(userId)) return json({ error: "회원 ID를 확인해 주세요." }, 400);

  const search = new URL(req.url).searchParams;
  const beforeId = search.get("before_id");
  const beforeAt = search.get("before_created_at");
  // Keep the original timestamp precision for pagination, but never interpolate arbitrary filters.
  if ((beforeId !== null || beforeAt !== null) && (
    !beforeId || !ADMIN_CONTACT_EXCHANGE_UUID.test(beforeId) || !beforeAt ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(beforeAt) ||
    !Number.isFinite(Date.parse(beforeAt))
  )) return json({ error: "조회 위치가 올바르지 않습니다. 목록을 다시 불러와 주세요." }, 400);

  try {
    let query = auth.admin.from("dating_1on1_match_proposals")
      .select("id,source_user_id,candidate_user_id,source_card_id,candidate_card_id,contact_exchange_approved_at,created_at")
      .eq("state", "mutual_accepted")
      .eq("contact_exchange_status", "approved")
      .or(`source_user_id.eq.${userId},candidate_user_id.eq.${userId}`)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(ADMIN_CONTACT_EXCHANGE_PAGE_SIZE + 1);
    if (beforeId && beforeAt) {
      query = query.or(`created_at.lt.${beforeAt},and(created_at.eq.${beforeAt},id.lt.${beforeId})`);
    }
    const result = await query;
    if (result.error) throw result.error;
    const rows = (result.data ?? []).slice(0, ADMIN_CONTACT_EXCHANGE_PAGE_SIZE);
    const cardIds = [...new Set(rows.flatMap(row => [row.source_card_id, row.candidate_card_id]).filter(Boolean))];
    const peerIds = [...new Set(rows.map(row => row.source_user_id === userId ? row.candidate_user_id : row.source_user_id).filter(Boolean))];
    const [cards, profiles] = await Promise.all([
      cardIds.length ? auth.admin.from("dating_1on1_cards").select("id,name").in("id", cardIds) : { data: [], error: null },
      peerIds.length ? auth.admin.from("profiles").select("user_id,nickname").in("user_id", peerIds) : { data: [], error: null },
    ]);
    if (cards.error) throw cards.error;
    if (profiles.error) throw profiles.error;
    const names = new Map((cards.data ?? []).map(card => [card.id, card.name]));
    const nicknames = new Map((profiles.data ?? []).map(profile => [profile.user_id, profile.nickname]));
    const last = rows[rows.length - 1];
    return json({
      ok: true,
      items: rows.map(row => {
        const isSource = row.source_user_id === userId;
        return {
          id: row.id,
          own_name: names.get(isSource ? row.source_card_id : row.candidate_card_id) ?? null,
          counterpart_name: names.get(isSource ? row.candidate_card_id : row.source_card_id) ?? null,
          counterpart_nickname: nicknames.get(isSource ? row.candidate_user_id : row.source_user_id) ?? null,
          approved_at: row.contact_exchange_approved_at,
          created_at: row.created_at,
        };
      }),
      next_cursor: (result.data?.length ?? 0) > ADMIN_CONTACT_EXCHANGE_PAGE_SIZE && last
        ? { created_at: last.created_at, id: last.id } : null,
    });
  } catch (error) {
    console.error("[admin member contact exchanges] lookup failed", error);
    return json({ error: "번호 교환 내역을 불러오지 못했습니다. 다시 조회해 주세요." }, 500);
  }
}

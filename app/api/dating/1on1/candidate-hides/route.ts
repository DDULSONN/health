import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { readCandidateHides, CANDIDATE_HIDE_UUID } from "@/lib/dating-candidate-hides";
import { verifyImpressionTicket } from "@/lib/dating-1on1-impressions";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) {
  const e = error as { code?: string; message?: string };
  if (["42P01", "PGRST202", "PGRST205"].includes(e?.code ?? "")) return json({ error: "후보 숨기기를 준비 중이에요." }, 503);
  if (e?.message?.includes("HIDE_LIMIT")) return json({ error: "숨긴 후보는 최대 500명까지 보관할 수 있어요. 일부 후보의 숨김을 해제해 주세요." }, 409);
  if (e?.message?.startsWith("HIDE_")) return json({ error: "프로필 상태가 바뀌었어요. 후보를 다시 확인해 주세요." }, 409);
  return json({ error: "숨김 상태를 확인하지 못했어요. 다시 시도해 주세요." }, 503);
}
export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return json({ error: "로그인이 필요해요." }, 401);
  try {
    const result = await readCandidateHides(createAdminClient(), user.id);
    return json({ enabled: result.available, items: result.rows.map(row => ({ id: row.id, name: row.candidate_name, created_at: row.created_at })) });
  } catch (e) { return failure(e); }
}
export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  const { user } = await getRequestAuthContext(req);
  if (!user) return json({ error: "로그인이 필요해요." }, 401);
  let body;
  try {
    if (!req.body) throw Error();
    const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 6500) { await reader.cancel(); throw Error(); } chunks.push(part.value);
    } } finally { reader.releaseLock(); }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return json({ error: "입력 내용을 확인해 주세요." }, 400); }
  if (!body || !["hide", "restore"].includes(body.action)) return json({ error: "입력 내용을 확인해 주세요." }, 400);
  const admin = createAdminClient();
  try {
    if (body.action === "restore") {
      if (typeof body.id !== "string" || !CANDIDATE_HIDE_UUID.test(body.id)) return json({ error: "숨긴 후보를 선택해 주세요." }, 400);
      const result = await admin.rpc("restore_dating_1on1_candidate", { p_user: user.id, p_hide: body.id });
      if (result.error) throw result.error;
      return json(result.data);
    }
    const { sourceCardId, candidateId } = body;
    if (![sourceCardId, candidateId].every(id => typeof id === "string" && CANDIDATE_HIDE_UUID.test(id)) || sourceCardId === candidateId) return json({ error: "추천 후보를 확인해 주세요." }, 400);
    const ticket = verifyImpressionTicket(body.ticket, user.id, [candidateId]);
    // Only a delivered recommendation, the member's own favorite, or an admin
    // proposal can be hidden. Never turn guessed IDs into a profile-name lookup.
    if (ticket?.source !== sourceCardId) {
      const [favorite, proposal] = await Promise.all([
        admin.from("dating_1on1_candidate_favorites").select("candidate_card_id").eq("user_id", user.id).eq("source_card_id", sourceCardId).eq("candidate_card_id", candidateId).limit(1),
        admin.from("dating_1on1_match_proposals").select("id").eq("source_user_id", user.id).eq("source_card_id", sourceCardId).eq("candidate_card_id", candidateId).eq("state", "proposed").limit(1),
      ]);
      if (favorite.error || proposal.error) throw favorite.error || proposal.error;
      if (!favorite.data?.length && !proposal.data?.length) return json({ error: "후보 목록을 다시 불러온 뒤 숨겨 주세요." }, 409);
    }
    const result = await admin.rpc("hide_dating_1on1_candidate", { p_user: user.id, p_source: sourceCardId, p_candidate: candidateId });
    if (result.error) throw result.error;
    return json(result.data);
  } catch (e) { return failure(e); }
}

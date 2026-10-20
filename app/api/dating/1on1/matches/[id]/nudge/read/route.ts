import { NextResponse } from "next/server";
import { canConfirmOneOnOneContactNudge } from "@/lib/dating-1on1-contact-nudge";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactPhoneBlockBetween } from "@/lib/dating-contact-blocks";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: object, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;
  const { user } = await getRequestAuthContext(req);
  if (!user) return json({ error: "로그인이 필요합니다." }, 401);
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!UUID.test(id ?? "") || !body || typeof body.nudgeId !== "string" || !UUID.test(body.nudgeId)) {
    return json({ error: "한마디 정보를 다시 불러와 주세요." }, 400);
  }
  const admin = createAdminClient();
  try {
    const matchRes = await admin.from("dating_1on1_match_proposals")
      .select("source_user_id,candidate_user_id,state,contact_exchange_status")
      .eq("id", id).maybeSingle();
    if (matchRes.error) throw matchRes.error;
    const match = matchRes.data;
    if (!match || ![match.source_user_id, match.candidate_user_id].includes(user.id)) {
      return json({ error: "한마디를 찾을 수 없습니다." }, 404);
    }
    if (!canConfirmOneOnOneContactNudge(match)) {
      return json({ error: "종료된 매칭에서는 확인을 남길 수 없어요." }, 409);
    }
    const otherId = match.source_user_id === user.id ? match.candidate_user_id : match.source_user_id;
    const [memberBlocked, contactBlocked] = await Promise.all([
      hasDatingBlockBetween(admin, user.id, otherId),
      hasDatingContactPhoneBlockBetween(admin, user.id, otherId),
    ]);
    if (memberBlocked || contactBlocked) return json({ error: "현재 확인을 남길 수 없는 매칭이에요." }, 409);

    // The recipient always comes from verified auth, never from the request body.
    // SQL rechecks recipient, match state, bans/deletions and member blocks.
    const result = await admin.rpc("mark_dating_1on1_contact_nudge_read", {
      p_match_id: id, p_nudge_id: body.nudgeId, p_recipient_user_id: user.id,
    });
    if (result.error) {
      const message = String(result.error.message ?? "");
      if (message.includes("NUDGE_READ_NOT_FOUND")) return json({ error: "받은 한마디를 찾을 수 없습니다." }, 404);
      if (message.includes("NUDGE_READ_UNAVAILABLE")) return json({ error: "현재 확인을 남길 수 없는 매칭이에요." }, 409);
      if (["42883", "PGRST202"].includes(result.error.code ?? "")) {
        return json({ error: "확인 기능을 준비 중이에요. 잠시 후 다시 시도해 주세요." }, 503);
      }
      throw result.error;
    }
    if (typeof result.data !== "string" || !Number.isFinite(Date.parse(result.data))) throw Error("Invalid nudge receipt");
    return json({ ok: true, nudgeId: body.nudgeId, read_at: result.data });
  } catch (error) {
    console.error("[contact-nudge/read] confirmation failed", error);
    return json({ error: "확인 표시를 저장하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
  }
}

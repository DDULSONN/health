import { NextResponse } from "next/server";
import { canReplyToOneOnOneContactNudge, getOneOnOneContactReplyPreset, parseOneOnOneContactReply } from "@/lib/dating-1on1-contact-reply";
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
  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) return json({ error: "로그인이 필요합니다." }, 401);
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const preset = getOneOnOneContactReplyPreset(body?.presetKey);
    if (!UUID.test(id ?? "") || typeof body?.nudgeId !== "string" || !UUID.test(body.nudgeId) || !preset) {
      return json({ error: "받은 한마디와 답장 문구를 다시 확인해 주세요." }, 400);
    }
    const admin = createAdminClient();
    const { data: match, error } = await admin.from("dating_1on1_match_proposals")
      .select("source_user_id,candidate_user_id,state,contact_exchange_status,contact_exchange_paid_at,contact_exchange_paid_by_user_id")
      .eq("id", id).maybeSingle();
    if (error) throw error;
    if (!match || ![match.source_user_id, match.candidate_user_id].includes(user.id)) {
      return json({ error: "받은 한마디를 찾을 수 없습니다." }, 404);
    }
    if (!canReplyToOneOnOneContactNudge(match)) {
      return json({ error: "이미 연락처를 교환했거나 종료된 매칭이에요. 최신 내역을 확인해 주세요." }, 409);
    }
    const otherId = match.source_user_id === user.id ? match.candidate_user_id : match.source_user_id;
    const [memberBlocked, contactBlocked] = await Promise.all([
      hasDatingBlockBetween(admin, user.id, otherId),
      hasDatingContactPhoneBlockBetween(admin, user.id, otherId),
    ]);
    if (memberBlocked || contactBlocked) return json({ error: "현재 답장을 보낼 수 없는 매칭이에요." }, 409);
    // Only the authenticated recipient can answer. SQL atomically rechecks match state.
    const result = await admin.rpc("reply_dating_1on1_contact_nudge", {
      p_match_id: id, p_nudge_id: body.nudgeId, p_recipient_user_id: user.id, p_preset_key: preset.key,
    });
    if (result.error) {
      const message = String(result.error.message ?? "");
      if (message.includes("NUDGE_REPLY_NOT_FOUND")) return json({ error: "받은 한마디를 찾을 수 없습니다." }, 404);
      if (message.includes("NUDGE_REPLY_UNAVAILABLE")) return json({ error: "현재 답장을 보낼 수 없는 매칭이에요. 최신 내역을 확인해 주세요." }, 409);
      if (["42883", "PGRST202", "42P01", "PGRST205"].includes(result.error.code ?? "")) {
        return json({ error: "답장 기능을 준비 중이에요. 기존 번호교환은 그대로 이용할 수 있어요." }, 503);
      }
      throw result.error;
    }
    const reply = parseOneOnOneContactReply(result.data);
    if (!reply) throw Error("Invalid nudge reply result");
    return json({ ok: true, nudgeId: body.nudgeId, reply });
  } catch (error) {
    console.error("[contact-nudge/reply] save failed", { code: (error as { code?: string })?.code ?? "unavailable" });
    return json({ error: "답장 전송을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
  }
}

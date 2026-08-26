import { NextResponse } from "next/server";
import type { DatingOneOnOneMatchRow } from "@/lib/dating-1on1";
import {
  buildOneOnOneContactNudgeEmail,
  getOneOnOneContactNudgeEligibility,
  getOneOnOneContactNudgeMessage,
} from "@/lib/dating-1on1-contact-nudge";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactPhoneBlockBetween } from "@/lib/dating-contact-blocks";
import { notifyDatingUser } from "@/lib/dating-notifications";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { getUserBanResponse } from "@/lib/user-ban-guard";
import { sendDatingEmailNotification } from "@/lib/dating-swipe";

function isMissingNudgeSchema(error: { code?: string | null; message?: string | null }) {
  const message = String(error.message ?? "").toLowerCase();
  return error.code === "42P01" || error.code === "PGRST205" || message.includes("dating_1on1_contact_nudges");
}

async function getMatch(admin: ReturnType<typeof createAdminClient>, matchId: string) {
  const { data, error } = await admin
    .from("dating_1on1_match_proposals")
    .select(
      "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,contact_exchange_status,contact_exchange_requested_at,contact_exchange_paid_at,contact_exchange_paid_by_user_id,contact_exchange_approved_at,contact_exchange_approved_by_user_id,contact_exchange_note,source_phone_share_consented_at,candidate_phone_share_consented_at,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at",
    )
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as DatingOneOnOneMatchRow | null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { presetKey?: unknown } | null;
  const preset = getOneOnOneContactNudgeMessage(body?.presetKey);
  if (!preset) return NextResponse.json({ error: "보낼 문구를 다시 선택해 주세요." }, { status: 400 });

  const { id } = await params;
  const matchId = id?.trim();
  if (!matchId) return NextResponse.json({ error: "매칭 정보가 올바르지 않습니다." }, { status: 400 });

  const admin = createAdminClient();
  const banResponse = await getUserBanResponse(admin, user.id);
  if (banResponse) return banResponse;

  let match: DatingOneOnOneMatchRow | null;
  try {
    match = await getMatch(admin, matchId);
  } catch (error) {
    console.error("[POST /api/dating/1on1/matches/[id]/nudge] match load failed", error);
    return NextResponse.json({ error: "매칭 정보를 불러오지 못했습니다." }, { status: 500 });
  }
  if (!match) return NextResponse.json({ error: "매칭을 찾을 수 없습니다." }, { status: 404 });

  const isSource = match.source_user_id === user.id;
  const isCandidate = match.candidate_user_id === user.id;
  if (!isSource && !isCandidate) {
    return NextResponse.json({ error: "이 매칭의 참여자만 문구를 보낼 수 있습니다." }, { status: 403 });
  }

  const eligibility = getOneOnOneContactNudgeEligibility(match);
  if (!eligibility.eligible) {
    return NextResponse.json(
      {
        error: "쌍방 수락 후 48시간 동안 결제가 없을 때만 문구를 보낼 수 있습니다.",
        eligibleAt: eligibility.eligibleAt,
      },
      { status: 409 },
    );
  }

  const recipientUserId = isSource ? match.candidate_user_id : match.source_user_id;
  try {
    const [memberBlocked, contactBlocked] = await Promise.all([
      hasDatingBlockBetween(admin, user.id, recipientUserId),
      hasDatingContactPhoneBlockBetween(admin, user.id, recipientUserId),
    ]);
    if (memberBlocked || contactBlocked) {
      return NextResponse.json({ error: "차단된 상대에게는 문구를 보낼 수 없습니다." }, { status: 409 });
    }
  } catch (error) {
    console.error("[POST /api/dating/1on1/matches/[id]/nudge] block check failed", error);
    return NextResponse.json({ error: "안전 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const insert = await admin
    .from("dating_1on1_contact_nudges")
    .insert({
      match_id: match.id,
      sender_user_id: user.id,
      recipient_user_id: recipientUserId,
      preset_key: preset.key,
      message_text: preset.message,
      created_at: nowIso,
    })
    .select("preset_key,message_text,created_at")
    .single();

  if (insert.error) {
    if (insert.error.code === "23505") {
      return NextResponse.json({ error: "같은 매칭에는 한 번만 문구를 보낼 수 있습니다." }, { status: 409 });
    }
    if (isMissingNudgeSchema(insert.error)) {
      return NextResponse.json({ error: "문구 보내기 기능을 준비 중입니다." }, { status: 503 });
    }
    if (String(insert.error.message ?? "").includes("NUDGE_NOT_ELIGIBLE")) {
      return NextResponse.json({ error: "현재는 문구를 보낼 수 없는 매칭 상태입니다." }, { status: 409 });
    }
    if (String(insert.error.message ?? "").includes("NUDGE_PARTICIPANT_MISMATCH")) {
      return NextResponse.json({ error: "이 매칭의 참여자만 문구를 보낼 수 있습니다." }, { status: 403 });
    }
    console.error("[POST /api/dating/1on1/matches/[id]/nudge] insert failed", insert.error);
    return NextResponse.json({ error: "문구를 보내지 못했습니다." }, { status: 500 });
  }

  const email = buildOneOnOneContactNudgeEmail(preset.message);
  const [, emailSent] = await Promise.all([
    notifyDatingUser(admin, {
      userId: recipientUserId,
      actorId: user.id,
      type: "dating_1on1_contact_nudge",
      title: "1:1 상대가 한마디를 보냈어요",
      body: preset.message,
      route: "/community/dating/cards?tab=one_on_one",
      meta: { match_id: match.id, preset_key: preset.key },
    }).catch((error) => {
      console.error("[POST /api/dating/1on1/matches/[id]/nudge] notification failed", error);
      return null;
    }),
    sendDatingEmailNotification(admin, recipientUserId, email.subject, email.text).catch((error) => {
      console.error("[POST /api/dating/1on1/matches/[id]/nudge] email failed", error);
      return false;
    }),
  ]);
  if (!emailSent) {
    console.info("[POST /api/dating/1on1/matches/[id]/nudge] email not sent", {
      matchId: match.id,
      recipientUserId,
    });
  }

  return NextResponse.json({ ok: true, nudge: insert.data });
}

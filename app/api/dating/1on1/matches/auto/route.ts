import {
  DATING_ONE_ON_ONE_ACTIVE_STATUSES,
  DATING_ONE_ON_ONE_MATCH_PERMANENT_REJECTION_STATES,
  getDatingOneOnOneCardsByIds,
  isDatingOneOnOnePendingPairExpired,
} from "@/lib/dating-1on1";
import {
  getOneOnOnePhoneBlockMapForUsers,
  isOneOnOnePhoneBlockedPair,
  normalizePhoneForOneOnOneBlock,
} from "@/lib/dating-1on1-phone-blocks";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactPhoneBlockBetween } from "@/lib/dating-contact-blocks";
import {
  getOneOnOneAdminUserBlockPairSetForUsers,
  isOneOnOneAdminUserBlockedPair,
} from "@/lib/dating-1on1-admin-user-blocks";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";
import { getCurrentOneOnOneCardIds } from "@/lib/dating-1on1-current-cards";
import { fetchRecommendationProfiles } from "@/lib/dating-1on1-recommendation-data";
import { fetchOneOnOnePairHistory } from "@/lib/dating-1on1-pair-history";
import { buildOneOnOneSelectionReceivedNotification } from "@/lib/dating-email-templates";
import { sendDatingEmailNotification } from "@/lib/dating-swipe";
import { notifyDatingUser } from "@/lib/dating-notifications";
import { sendOneOnOneSelectionSms } from "@/lib/dating-1on1-sms";

type CreateAutoMatchPayload = {
  source_card_id?: string;
  candidate_card_id?: string;
};

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as CreateAutoMatchPayload | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sourceCardId = typeof body.source_card_id === "string" ? body.source_card_id.trim() : "";
  const candidateCardId = typeof body.candidate_card_id === "string" ? body.candidate_card_id.trim() : "";

  if (!sourceCardId || !candidateCardId) {
    return NextResponse.json({ error: "Source card id and candidate card id are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const [sourceRes, candidateRes] = await Promise.all([
    admin
      .from("dating_1on1_cards")
      .select("id,user_id,sex,status,phone")
      .eq("id", sourceCardId)
      .maybeSingle(),
    admin
      .from("dating_1on1_cards")
      .select("id,user_id,sex,status,phone")
      .eq("id", candidateCardId)
      .maybeSingle(),
  ]);

  if (sourceRes.error) {
    console.error("[POST /api/dating/1on1/matches/auto] source fetch failed", sourceRes.error);
    return NextResponse.json({ error: "Failed to load source card." }, { status: 500 });
  }
  if (candidateRes.error) {
    console.error("[POST /api/dating/1on1/matches/auto] candidate fetch failed", candidateRes.error);
    return NextResponse.json({ error: "Failed to load candidate card." }, { status: 500 });
  }
  if (!sourceRes.data || !candidateRes.data) {
    return NextResponse.json({ error: "Card not found." }, { status: 404 });
  }

  if (sourceRes.data.user_id !== user.id) {
    return NextResponse.json({ error: "Only your own card can create automatic match requests." }, { status: 403 });
  }
  if (!DATING_ONE_ON_ONE_ACTIVE_STATUSES.includes(sourceRes.data.status)) {
    return NextResponse.json({ error: "Source card is no longer active." }, { status: 409 });
  }
  if (!DATING_ONE_ON_ONE_ACTIVE_STATUSES.includes(candidateRes.data.status)) {
    return NextResponse.json({ error: "Candidate card is no longer available." }, { status: 409 });
  }
  if (sourceRes.data.user_id === candidateRes.data.user_id || sourceRes.data.sex === candidateRes.data.sex) {
    return NextResponse.json({ error: "Candidate card is not eligible." }, { status: 409 });
  }

  let profiles: Awaited<ReturnType<typeof fetchRecommendationProfiles>>;
  let currentCardIds: Set<string>;
  try {
    profiles = await fetchRecommendationProfiles(admin, [sourceRes.data.user_id, candidateRes.data.user_id]);
    currentCardIds = await getCurrentOneOnOneCardIds(admin, [sourceRes.data, candidateRes.data], profiles);
  } catch (error) {
    console.error("[POST /api/dating/1on1/matches/auto] current identity check failed", error);
    return NextResponse.json({ error: "Failed to validate current identities." }, { status: 500 });
  }
  const sourcePhone = normalizePhoneForOneOnOneBlock(profiles.get(sourceRes.data.user_id)?.phone ?? sourceRes.data.phone ?? "");
  const candidatePhone = normalizePhoneForOneOnOneBlock(profiles.get(candidateRes.data.user_id)?.phone ?? candidateRes.data.phone ?? "");
  if (sourcePhone && candidatePhone === sourcePhone) {
    return NextResponse.json(
      { error: "본인과 동일한 인증 정보의 후보는 선택할 수 없습니다.", code: "SAME_PHONE_IDENTITY" },
      { status: 409 }
    );
  }

  if (!currentCardIds.has(sourceCardId) || !currentCardIds.has(candidateCardId)) {
    return NextResponse.json({
      error: "회원 정보가 변경되었거나 현재 선택할 수 없는 카드입니다. 목록을 다시 불러와 주세요.",
      code: !currentCardIds.has(sourceCardId) ? "STALE_SOURCE_IDENTITY" : "DUPLICATE_CANDIDATE_IDENTITY",
    }, { status: 409 });
  }

  const unifiedBlockResult = await Promise.all([
    hasDatingBlockBetween(admin, sourceRes.data.user_id, candidateRes.data.user_id),
    hasDatingContactPhoneBlockBetween(admin, sourceRes.data.user_id, candidateRes.data.user_id),
  ]).catch((error) => {
    console.error("[POST /api/dating/1on1/matches/auto] unified block lookup failed", error);
    return null;
  });
  if (!unifiedBlockResult) {
    return NextResponse.json({ error: "지인 차단 설정을 확인하지 못했습니다." }, { status: 500 });
  }
  if (unifiedBlockResult.some(Boolean)) {
    return NextResponse.json({ error: "지인 차단된 회원과는 1:1 매칭을 진행할 수 없습니다." }, { status: 409 });
  }

  const phoneBlockMap = await getOneOnOnePhoneBlockMapForUsers(admin, [
    sourceRes.data.user_id,
    candidateRes.data.user_id,
  ]).catch((error) => {
    console.error("[POST /api/dating/1on1/matches/auto] phone block lookup failed", error);
    return null;
  });
  const adminUserBlockPairSet = await getOneOnOneAdminUserBlockPairSetForUsers(admin, [
    sourceRes.data.user_id,
    candidateRes.data.user_id,
  ]).catch((error) => {
    console.error("[POST /api/dating/1on1/matches/auto] admin user block lookup failed", error);
    return null;
  });
  if (!adminUserBlockPairSet) {
    return NextResponse.json({ error: "관리자 지인 차단 설정을 확인하지 못했습니다." }, { status: 500 });
  }
  if (!phoneBlockMap) {
    return NextResponse.json({ error: "차단 번호 설정을 확인하지 못했습니다." }, { status: 500 });
  }
  if (
    isOneOnOnePhoneBlockedPair({
      sourceUserId: sourceRes.data.user_id,
      sourcePhone,
      candidateUserId: candidateRes.data.user_id,
      candidatePhone,
      blockMap: phoneBlockMap,
    })
  ) {
    return NextResponse.json({ error: "차단한 번호와는 1:1 매칭을 진행할 수 없습니다." }, { status: 409 });
  }

  if (
    isOneOnOneAdminUserBlockedPair({
      sourceUserId: sourceRes.data.user_id,
      candidateUserId: candidateRes.data.user_id,
      pairSet: adminUserBlockPairSet,
    })
  ) {
    return NextResponse.json({ error: "지인 차단된 상대와는 1:1 매칭을 진행할 수 없습니다." }, { status: 409 });
  }

  const rejectedPairRes = await admin
    .from("dating_1on1_match_proposals")
    .select("id")
    .or(
      `and(source_user_id.eq.${sourceRes.data.user_id},candidate_user_id.eq.${candidateRes.data.user_id}),and(source_user_id.eq.${candidateRes.data.user_id},candidate_user_id.eq.${sourceRes.data.user_id})`
    )
    .in("state", [...DATING_ONE_ON_ONE_MATCH_PERMANENT_REJECTION_STATES])
    .limit(1)
    .maybeSingle();

  if (rejectedPairRes.error) {
    console.error("[POST /api/dating/1on1/matches/auto] rejection history check failed", rejectedPairRes.error);
    return NextResponse.json({ error: "Failed to validate rejection history." }, { status: 500 });
  }
  if (rejectedPairRes.data) {
    return NextResponse.json(
      {
        error: "이미 거절 이력이 있는 상대입니다. 다른 후보를 확인해주세요.",
        code: "CANDIDATE_PREVIOUSLY_REJECTED",
      },
      { status: 409 }
    );
  }

  const activePairRows = await fetchOneOnOnePairHistory(admin, user.id, {
    activeOnly: true, counterpartUserId: candidateRes.data.user_id,
  }).catch((error) => {
    console.error("[POST /api/dating/1on1/matches/auto] existing pair check failed", error);
    return null;
  });
  if (!activePairRows) {
    return NextResponse.json({ error: "Failed to validate existing pair." }, { status: 500 });
  }
  // Check all rows before expiring anything. In particular, an expired row must
  // not hide another still-live match for the same two members.
  if (activePairRows.some((row) => !isDatingOneOnOnePendingPairExpired(row))) {
    return NextResponse.json({
      error: "이미 진행 중인 상대입니다. 후보 목록을 다시 불러와 주세요.",
      code: "CANDIDATE_ALREADY_HANDLED",
    }, { status: 409 });
  }
  const nowIso = new Date().toISOString();

  for (const pairRow of activePairRows) {
    if (!isDatingOneOnOnePendingPairExpired(pairRow)) continue;

    const expireRes = await admin
      .from("dating_1on1_match_proposals")
      .update({ state: "admin_canceled", updated_at: nowIso })
      .eq("id", pairRow.id)
      .eq("state", pairRow.state)
      .eq("updated_at", pairRow.updated_at)
      .select("id")
      .maybeSingle();
    if (expireRes.error) {
      console.error("[POST /api/dating/1on1/matches/auto] stale pair cleanup failed", expireRes.error);
      return NextResponse.json({ error: "Failed to refresh stale candidate pair." }, { status: 500 });
    }
    if (!expireRes.data) {
      return NextResponse.json(
        {
          error: "후보 상태가 변경되었습니다. 목록을 다시 불러와 주세요.",
          code: "CANDIDATE_PAIR_CHANGED",
        },
        { status: 409 }
      );
    }
  }

  const insertRes = await admin
    .from("dating_1on1_match_proposals")
    .insert({
      source_card_id: sourceRes.data.id,
      source_user_id: sourceRes.data.user_id,
      candidate_card_id: candidateRes.data.id,
      candidate_user_id: candidateRes.data.user_id,
      state: "source_selected",
      source_selected_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .maybeSingle();

  if (insertRes.error) {
    if (insertRes.error.code === "23505") {
      return NextResponse.json(
        {
          error: "이미 진행 중인 상대입니다. 후보 목록을 다시 불러옵니다.",
          code: "CANDIDATE_PAIR_ACTIVE",
        },
        { status: 409 }
      );
    }
    console.error("[POST /api/dating/1on1/matches/auto] insert failed", insertRes.error);
    return NextResponse.json({ error: "Failed to send automatic candidate request." }, { status: 500 });
  }

  const matchId = insertRes.data?.id ?? null;
  if (matchId) {
    try {
      const cards = await getDatingOneOnOneCardsByIds(admin, [sourceCardId, candidateCardId]);
      const notification = buildOneOnOneSelectionReceivedNotification(
        cards.get(sourceCardId)?.name ?? "상대",
        cards.get(candidateCardId)?.name ?? "내 카드",
      );
      await Promise.all([
        sendDatingEmailNotification(
          admin,
          candidateRes.data.user_id,
          notification.emailSubject,
          notification.emailText,
        ),
        notifyDatingUser(admin, {
          userId: candidateRes.data.user_id,
          actorId: sourceRes.data.user_id,
          type: "dating_1on1_selection_received",
          title: notification.pushTitle,
          body: notification.pushBody,
          route: "/dating/1on1",
          meta: { match_id: matchId },
        }),
        sendOneOnOneSelectionSms(admin, {
          matchId,
          sourceUserId: sourceRes.data.user_id,
          recipientUserId: candidateRes.data.user_id,
        }),
        admin
          .from("dating_1on1_candidate_favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("source_card_id", sourceCardId)
          .eq("candidate_card_id", candidateCardId),
      ]);
    } catch (notificationError) {
      console.error("[POST /api/dating/1on1/matches/auto] selection notification failed", notificationError);
    }
  }

  return NextResponse.json({ ok: true, id: matchId });
}

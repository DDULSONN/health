import {
  DATING_ONE_ON_ONE_ACTIVE_STATUSES,
  DATING_ONE_ON_ONE_MATCH_CANDIDATE_SINGLE_TRACK_STATES,
} from "@/lib/dating-1on1";
import {
  getOneOnOnePhoneBlockMapForUsers,
  isOneOnOnePhoneBlockedPair,
} from "@/lib/dating-1on1-phone-blocks";
import {
  getOneOnOneAdminUserBlockPairSetForUsers,
  isOneOnOneAdminUserBlockedPair,
} from "@/lib/dating-1on1-admin-user-blocks";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

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
      sourcePhone: sourceRes.data.phone ?? null,
      candidateUserId: candidateRes.data.user_id,
      candidatePhone: candidateRes.data.phone ?? null,
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

  const [existingPairRes, candidateTrackRes] = await Promise.all([
    admin
      .from("dating_1on1_match_proposals")
      .select("id,state")
      .eq("source_card_id", sourceCardId)
      .eq("candidate_card_id", candidateCardId)
      .limit(1)
      .maybeSingle(),
    admin
      .from("dating_1on1_match_proposals")
      .select("id")
      .eq("candidate_card_id", candidateCardId)
      .in("state", [...DATING_ONE_ON_ONE_MATCH_CANDIDATE_SINGLE_TRACK_STATES])
      .limit(1)
      .maybeSingle(),
  ]);

  if (existingPairRes.error) {
    console.error("[POST /api/dating/1on1/matches/auto] existing pair check failed", existingPairRes.error);
    return NextResponse.json({ error: "Failed to validate existing pair." }, { status: 500 });
  }
  if (candidateTrackRes.error) {
    console.error("[POST /api/dating/1on1/matches/auto] candidate track check failed", candidateTrackRes.error);
    return NextResponse.json({ error: "Failed to validate candidate state." }, { status: 500 });
  }
  if (existingPairRes.data) {
    return NextResponse.json(
      {
        error: "이미 확인한 후보입니다. 새 후보 목록을 다시 불러올게요.",
        code: "CANDIDATE_ALREADY_HANDLED",
      },
      { status: 409 }
    );
  }
  if (candidateTrackRes.data) {
    return NextResponse.json(
      {
        error: "방금 다른 매칭에서 먼저 진행된 후보입니다. 새 후보 목록을 다시 불러올게요.",
        code: "CANDIDATE_ALREADY_IN_ACTIVE_FLOW",
      },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
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
    console.error("[POST /api/dating/1on1/matches/auto] insert failed", insertRes.error);
    return NextResponse.json({ error: "Failed to send automatic candidate request." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: insertRes.data?.id ?? null });
}

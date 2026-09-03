import {
  DATING_ONE_ON_ONE_ACTIVE_STATUSES,
  DATING_ONE_ON_ONE_MATCH_ACTIVE_PAIR_STATES,
  DATING_ONE_ON_ONE_MATCH_PERMANENT_REJECTION_STATES,
  isDatingOneOnOnePendingPairExpired,
} from "@/lib/dating-1on1";
import {
  getOneOnOnePhoneBlockMapForUsers,
  isOneOnOnePhoneBlockedPair,
} from "@/lib/dating-1on1-phone-blocks";
import {
  getOneOnOneAdminUserBlockPairSetForUsers,
  isOneOnOneAdminUserBlockedPair,
} from "@/lib/dating-1on1-admin-user-blocks";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactPhoneBlockBetween } from "@/lib/dating-contact-blocks";
import { fetchRecommendationProfiles } from "@/lib/dating-1on1-recommendation-data";
import { getCurrentOneOnOneCardIds } from "@/lib/dating-1on1-current-cards";
import { fetchOneOnOnePairHistory } from "@/lib/dating-1on1-pair-history";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const FAVORITE_LIMIT = 10;
const TABLE = "dating_1on1_candidate_favorites";

type FavoritePayload = {
  source_card_id?: string;
  candidate_card_id?: string;
};

type CardRow = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  status: string;
  phone: string | null;
};

function isMissingFavoriteSchema(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes(TABLE) || message.includes("schema cache");
}

function parsePayload(body: FavoritePayload | null) {
  return {
    sourceCardId: typeof body?.source_card_id === "string" ? body.source_card_id.trim() : "",
    candidateCardId: typeof body?.candidate_card_id === "string" ? body.candidate_card_id.trim() : "",
  };
}

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { sourceCardId, candidateCardId } = parsePayload(
    (await req.json().catch(() => null)) as FavoritePayload | null,
  );
  if (!sourceCardId || !candidateCardId || sourceCardId === candidateCardId) {
    return NextResponse.json({ error: "찜할 후보 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const cardsRes = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,sex,status,phone")
    .in("id", [sourceCardId, candidateCardId]);
  if (cardsRes.error) {
    console.error("[POST /api/dating/1on1/favorites] cards failed", cardsRes.error);
    return NextResponse.json({ error: "후보 정보를 확인하지 못했습니다." }, { status: 500 });
  }

  const cardMap = new Map(((cardsRes.data ?? []) as CardRow[]).map((card) => [card.id, card]));
  const sourceCard = cardMap.get(sourceCardId);
  const candidateCard = cardMap.get(candidateCardId);
  const activeStatuses = DATING_ONE_ON_ONE_ACTIVE_STATUSES as readonly string[];
  if (
    !sourceCard ||
    !candidateCard ||
    sourceCard.user_id !== user.id ||
    sourceCard.user_id === candidateCard.user_id ||
    sourceCard.sex === candidateCard.sex ||
    !activeStatuses.includes(sourceCard.status) ||
    !activeStatuses.includes(candidateCard.status)
  ) {
    return NextResponse.json({ error: "현재 찜할 수 없는 후보입니다. 목록을 새로고침해 주세요." }, { status: 409 });
  }

  const userIds = [sourceCard.user_id, candidateCard.user_id];
  try {
    const profiles = await fetchRecommendationProfiles(admin, userIds);
    const [currentCardIds, memberBlocked, contactBlocked, phoneBlockMap, adminBlockPairs, pairHistory] = await Promise.all([
      getCurrentOneOnOneCardIds(admin, [sourceCard, candidateCard], profiles),
      hasDatingBlockBetween(admin, sourceCard.user_id, candidateCard.user_id),
      hasDatingContactPhoneBlockBetween(admin, sourceCard.user_id, candidateCard.user_id),
      getOneOnOnePhoneBlockMapForUsers(admin, userIds),
      getOneOnOneAdminUserBlockPairSetForUsers(admin, userIds),
      fetchOneOnOnePairHistory(admin, sourceCard.user_id, { counterpartUserId: candidateCard.user_id }),
    ]);
    const sourceProfile = profiles.get(sourceCard.user_id);
    const candidateProfile = profiles.get(candidateCard.user_id);
    const phoneBlocked = isOneOnOnePhoneBlockedPair({
      sourceUserId: sourceCard.user_id,
      sourcePhone: sourceProfile?.phone,
      candidateUserId: candidateCard.user_id,
      candidatePhone: candidateProfile?.phone,
      blockMap: phoneBlockMap,
    });
    const adminBlocked = isOneOnOneAdminUserBlockedPair({
      sourceUserId: sourceCard.user_id,
      candidateUserId: candidateCard.user_id,
      pairSet: adminBlockPairs,
    });
    const hasUnavailablePairHistory = pairHistory.some((row) =>
      (DATING_ONE_ON_ONE_MATCH_PERMANENT_REJECTION_STATES as readonly string[]).includes(row.state) ||
      (
        (DATING_ONE_ON_ONE_MATCH_ACTIVE_PAIR_STATES as readonly string[]).includes(row.state) &&
        !isDatingOneOnOnePendingPairExpired(row)
      ),
    );
    if (
      !sourceProfile ||
      !candidateProfile ||
      sourceProfile.banned ||
      candidateProfile.banned ||
      !currentCardIds.has(sourceCardId) ||
      !currentCardIds.has(candidateCardId) ||
      memberBlocked ||
      contactBlocked ||
      phoneBlocked ||
      adminBlocked ||
      hasUnavailablePairHistory
    ) {
      return NextResponse.json({ error: "현재 찜할 수 없는 후보입니다. 목록을 새로고침해 주세요." }, { status: 409 });
    }
  } catch (error) {
    console.error("[POST /api/dating/1on1/favorites] eligibility failed", error);
    return NextResponse.json({ error: "후보의 현재 상태를 확인하지 못했습니다." }, { status: 500 });
  }

  const existingRes = await admin
    .from(TABLE)
    .select("id")
    .eq("user_id", user.id)
    .eq("source_card_id", sourceCardId)
    .eq("candidate_card_id", candidateCardId)
    .maybeSingle();
  if (existingRes.error) {
    if (isMissingFavoriteSchema(existingRes.error)) {
      return NextResponse.json({ error: "찜 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
    }
    console.error("[POST /api/dating/1on1/favorites] existing lookup failed", existingRes.error);
    return NextResponse.json({ error: "찜 상태를 확인하지 못했습니다." }, { status: 500 });
  }
  if (existingRes.data) return NextResponse.json({ ok: true, favorite: true });

  const countRes = await admin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("source_card_id", sourceCardId);
  if (countRes.error) {
    console.error("[POST /api/dating/1on1/favorites] count failed", countRes.error);
    return NextResponse.json({ error: "찜 개수를 확인하지 못했습니다." }, { status: 500 });
  }
  if ((countRes.count ?? 0) >= FAVORITE_LIMIT) {
    return NextResponse.json({ error: `찜은 프로필마다 최대 ${FAVORITE_LIMIT}명까지 저장할 수 있습니다.` }, { status: 409 });
  }

  const insertRes = await admin.from(TABLE).insert({
    user_id: user.id,
    source_card_id: sourceCardId,
    candidate_card_id: candidateCardId,
  });
  if (insertRes.error) {
    if (insertRes.error.code === "23505") return NextResponse.json({ ok: true, favorite: true });
    if (String(insertRes.error.message ?? "").includes("ONE_ON_ONE_FAVORITE_LIMIT_REACHED")) {
      return NextResponse.json({ error: `찜은 프로필마다 최대 ${FAVORITE_LIMIT}명까지 저장할 수 있습니다.` }, { status: 409 });
    }
    console.error("[POST /api/dating/1on1/favorites] insert failed", insertRes.error);
    return NextResponse.json({ error: "후보 찜에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, favorite: true });
}

export async function DELETE(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { sourceCardId, candidateCardId } = parsePayload(
    (await req.json().catch(() => null)) as FavoritePayload | null,
  );
  if (!sourceCardId || !candidateCardId) {
    return NextResponse.json({ error: "해제할 찜 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const deleteRes = await admin
    .from(TABLE)
    .delete()
    .eq("user_id", user.id)
    .eq("source_card_id", sourceCardId)
    .eq("candidate_card_id", candidateCardId);
  if (deleteRes.error) {
    if (isMissingFavoriteSchema(deleteRes.error)) {
      return NextResponse.json({ error: "찜 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
    }
    console.error("[DELETE /api/dating/1on1/favorites] failed", deleteRes.error);
    return NextResponse.json({ error: "찜 해제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, favorite: false });
}

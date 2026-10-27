import {
  DATING_ONE_ON_ONE_MATCH_ACTIVE_PAIR_STATES,
  DATING_ONE_ON_ONE_MATCH_PERMANENT_REJECTION_STATES,
  toDatingOneOnOneAge,
} from "@/lib/dating-1on1";
import {
  dedupeOneOnOneCardsByIdentity,
  getOneOnOnePhoneBlockMapForUsers,
  isOneOnOnePhoneBlockedPair,
  normalizePhoneForOneOnOneBlock,
} from "@/lib/dating-1on1-phone-blocks";
import { getDatingBlockedUserIds } from "@/lib/dating-blocks";
import {
  getDatingContactBlockMapForUsers,
  isDatingContactPhoneBlockedPair,
} from "@/lib/dating-contact-blocks";
import {
  getOneOnOneAdminUserBlockPairSetForUsers,
  isOneOnOneAdminUserBlockedPair,
} from "@/lib/dating-1on1-admin-user-blocks";
import {
  getActiveRecommendationRefresh,
  getRecommendationRecoverySeed,
  RECOMMENDATION_REFRESH_HISTORY_MS,
  replayRecommendationRefreshes,
  isRecentlyHandledCandidate,
  sortCandidatesForSource,
  takeBalancedRecommendations,
  takeObservedRecommendations,
  observedCandidateIdsAt,
  hasWiderRecommendationRegion,
  isCandidateInSourceAgeRange,
  isWiderRecommendationRegion,
} from "@/lib/dating-1on1-recommendations";
import type { createAdminClient } from "@/lib/supabase/server";
import { getKstDateString } from "@/lib/weekly";
import {
  ONE_ON_ONE_FREE_EXTRA_CANDIDATES,
  ONE_ON_ONE_FREE_REFRESH_LIMIT,
  ONE_ON_ONE_PLUS_REFRESH_LIMIT,
  getActiveOneOnOnePlusByUserIds,
} from "@/lib/dating-1on1-plus";
import { NextResponse } from "next/server";
import {
  fetchActiveRecommendationRows,
  fetchRecommendationActivity,
  fetchRecommendationDetails,
  fetchRecommendationProfiles,
  latestRecommendationActivity,
  type RecommendationCardRow,
} from "@/lib/dating-1on1-recommendation-data";
import { getCurrentOneOnOneCardIds } from "@/lib/dating-1on1-current-cards";
import { DATING_AGE_INELIGIBLE_MESSAGE, parseDatingBirthYear } from "@/lib/dating-age";
import { fetchOneOnOnePairHistory, type OneOnOnePairHistory } from "@/lib/dating-1on1-pair-history";
import { EXPANSION_TABLE, isExpansionEnabled, selectExpansionCandidates } from "@/lib/dating-1on1-expansion";
import { createImpressionTicket, readCandidateImpressions } from "@/lib/dating-1on1-impressions";
import { readRefreshCompensation } from "@/lib/dating-1on1-refresh-compensation";
import { readRecommendationPage, recommendationSourceKey } from "@/lib/dating-1on1-recommendation-page-store";
import { nextRecommendationPage, restoreRecommendationPage } from "@/lib/dating-1on1-recommendation-page";
import { readRecommendationHistory } from "@/lib/dating-1on1-recommendation-history";
import { getRegionDistanceMeta } from "@/lib/region-distance";
import { readCandidateHides } from "@/lib/dating-candidate-hides";

const RECOMMENDATION_LIMIT = 10;
const FAVORITE_TABLE = "dating_1on1_candidate_favorites";
const RECOMMENDATION_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ACTIVE_PAIR_STATES = new Set<string>(DATING_ONE_ON_ONE_MATCH_ACTIVE_PAIR_STATES);
const RECYCLABLE_PAIR_STATES = new Set(["source_skipped", "admin_canceled"]);

type RecommendationCard = RecommendationCardRow & {
  age: number | null;
  plus_expires_at?: string | null;
  last_active_at?: string | null;
};
type RefreshEventRow = {
  card_id: string;
  refreshed_at: string;
  quota_refunded_at?: string | null;
};
type FavoriteRow = {
  source_card_id: string;
  candidate_card_id: string;
  created_at: string;
};

function getRefreshAvailability(
  refreshEvents: string[],
  legacyRefreshUsedAt: string | null | undefined,
  refreshLimit: number,
  refundedEvents: string[] = []
) {
  const nowMs = Date.now();
  const windowStartMs = nowMs - RECOMMENDATION_REFRESH_COOLDOWN_MS;
  const refundedTimes = new Set(refundedEvents.map((value) => Date.parse(value)));
  const refreshTimes = refreshEvents
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value) && value > windowStartMs && !refundedTimes.has(value))
    .sort((a, b) => a - b);

  if (refreshTimes.length === 0 && legacyRefreshUsedAt) {
    const legacyRefreshMs = Date.parse(legacyRefreshUsedAt);
    if (Number.isFinite(legacyRefreshMs) && legacyRefreshMs > windowStartMs && !refundedTimes.has(legacyRefreshMs)) {
      refreshTimes.push(legacyRefreshMs);
    }
  }

  const usedCount = refreshTimes.length;
  const remainingCount = Math.max(refreshLimit - usedCount, 0);
  // After Plus expires, usage can exceed the new limit. Wait until enough
  // charges expire to free a slot, not merely until the oldest charge expires.
  const nextChargeMs = refreshTimes[Math.max(0, usedCount - refreshLimit)];
  const nextRefreshMs = remainingCount === 0 && nextChargeMs != null
    ? nextChargeMs + RECOMMENDATION_REFRESH_COOLDOWN_MS
    : null;
  return {
    refreshUsed: usedCount > 0,
    refreshUsedCount: usedCount,
    refreshRemaining: remainingCount,
    refreshLimit,
    canRefreshNow: remainingCount > 0,
    nextRefreshAt: nextRefreshMs ? new Date(nextRefreshMs).toISOString() : null,
  };
}

function isMissingRefreshEventSchema(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "").toLowerCase();
  return message.includes("dating_1on1_recommendation_refresh_events") || message.includes("schema cache");
}

function isMissingFavoriteSchema(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes(FAVORITE_TABLE) || message.includes("schema cache");
}

export type RecommendationRefreshPlan = {
  source_card_id: string;
  expected_refresh_used_at: string | null;
  refresh_at: string;
  changed_candidate_count: number;
  rotated_candidate_count: number;
  refresh_limit: number;
  refresh_used_count: number;
  refresh_remaining: number;
  refresh_bonus_remaining: number;
  next_refresh_at: string | null;
  plus_active: boolean;
  persist_page: boolean;
  source_profile_key: string;
  main_candidate_ids: string[];
  extra_candidate_ids: string[];
  monitor?: {
    before_candidate_ids: string[];
    before_user_ids: string[];
    after_user_ids: string[];
    pool_count: number;
    safe_local_change: boolean;
    widened_count: number;
    age_mismatch_count: number;
  };
};

// Only server code may request a plan. Public GET has no seed/preview overrides.
// Both display and consumption use exactly the same safety filters and ranking.
export async function loadOneOnOneRecommendations(admin: ReturnType<typeof createAdminClient>, user: { id: string },
  refreshPlan?: { sourceCardId: string; at: string }, expansion?: { candidateIds?: readonly string[] }) {
  if (refreshPlan && expansion) throw new Error("Expansion cannot consume a refresh.");
  const nowMs = refreshPlan ? Date.parse(refreshPlan.at) : Date.now();
  let ownRows: RecommendationCardRow[];
  let candidateRows: RecommendationCardRow[];
  let profiles: Awaited<ReturnType<typeof fetchRecommendationProfiles>>;
  try {
    ownRows = await fetchActiveRecommendationRows(admin, { userId: user.id });
    // No application means no candidate scans, subscriptions, photos or block lookups.
    if (ownRows.length === 0) return NextResponse.json({ items: [] });
    // Only the newest active application determines the source's gender.
    ownRows = ownRows.slice(0, 1);
    if (parseDatingBirthYear(ownRows[0].birth_year, nowMs) == null) {
      return NextResponse.json({ error: DATING_AGE_INELIGIBLE_MESSAGE, code: "DATING_AGE_INELIGIBLE" }, { status: 403 });
    }
    const sexes = [...new Set(ownRows.map((row) => row.sex === "male" ? "female" as const : "male" as const))];
    candidateRows = await fetchActiveRecommendationRows(admin, { sexes, excludeUserId: user.id });
    profiles = await fetchRecommendationProfiles(admin, [user.id, ...candidateRows.map((row) => row.user_id)]);
  } catch (error) {
    console.error("[GET /api/dating/1on1/recommendations/my] cards failed", error);
    return NextResponse.json({ error: "Failed to load eligible cards." }, { status: 500 });
  }
  if (!profiles.has(user.id) || profiles.get(user.id)?.banned) {
    return NextResponse.json({ error: "Account is not eligible for recommendations." }, { status: 403 });
  }
  if (expansion && !profiles.get(user.id)?.phone) {
    return NextResponse.json({ error: "휴대폰 인증 상태를 확인한 뒤 다시 시도해 주세요." }, { status: 403 });
  }
  const normalize = (row: RecommendationCardRow): RecommendationCard => ({
    ...row,
    age: toDatingOneOnOneAge(row.birth_year),
    phone: profiles.get(row.user_id)?.phone ?? row.phone,
    last_active_at: latestRecommendationActivity(nowMs, row.recommendation_refresh_used_at, profiles.get(row.user_id)?.lastActiveAt),
  });
  const mySourceCards = ownRows.map(normalize);
  // Preserve the full eligible opposite-sex pool, with only small ranking fields.
  // Do not arbitrarily drop older profiles to make the query look faster.
  const candidateUniverse = dedupeOneOnOneCardsByIdentity(candidateRows
    .filter((row) => profiles.has(row.user_id) && !profiles.get(row.user_id)?.banned)
    .map(normalize)).filter((row) => parseDatingBirthYear(row.birth_year, nowMs) != null);

  const sourceCardIds = mySourceCards.map((card) => card.id);
  const adminRecommendationDate = getKstDateString();
  const refreshEventsByCardId = new Map<string, string[]>();
  const refundedEventsByCardId = new Map<string, string[]>();

  const [initialRefreshEventsRes, recoveryRes, impressionResult, bonusRemaining, savedPageResult, recentPages] = await Promise.all([
    admin.from("dating_1on1_recommendation_refresh_events")
      .select("card_id,refreshed_at,quota_refunded_at")
      .in("card_id", sourceCardIds)
      .gt("refreshed_at", new Date(nowMs - RECOMMENDATION_REFRESH_HISTORY_MS).toISOString())
      .order("refreshed_at", { ascending: true }),
    // Primary-key lookup of at most one server-only, already-applied correction.
    admin.from("dating_1on1_recommendation_recoveries")
      .select("card_id,refreshed_at")
      .eq("user_id", user.id)
      .eq("card_id", sourceCardIds[0])
      .maybeSingle(),
    readCandidateImpressions(admin, user.id, nowMs).catch(() => null),
    readRefreshCompensation(admin, user.id).catch(() => null),
    readRecommendationPage(admin, user.id).catch(() => null),
    readRecommendationHistory(admin, user.id, nowMs).catch(() => null),
  ]);
  if (recentPages === null) {
    return NextResponse.json({ error: "최근 후보 이력을 확인하지 못했어요. 횟수는 사용하지 않았으니 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  if (!savedPageResult) {
    return NextResponse.json({ error: "현재 후보 명단을 확인하지 못했어요. 횟수는 사용하지 않았으니 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  if (bonusRemaining === null) {
    return NextResponse.json({ error: "새로고침 이용 횟수를 확인하지 못했어요. 횟수는 사용하지 않았으니 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  if (!impressionResult && (refreshPlan || expansion)) {
    return NextResponse.json({ error: "확인한 후보 이력을 불러오지 못했어요. 횟수는 사용하지 않았으니 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  const candidateIdsByUser = new Map<string, string[]>();
  for (const card of candidateUniverse) {
    const ids = candidateIdsByUser.get(card.user_id) ?? [];
    ids.push(card.id); candidateIdsByUser.set(card.user_id, ids);
  }
  const observations = (impressionResult?.rows ?? []).flatMap(row =>
    (candidateIdsByUser.get(row.candidate_user_id) ?? []).map(id => ({ id, at: Date.parse(row.first_seen_at) })));
  // Rolling deployment: before the additive SQL is installed there are no refunds.
  // Only a confirmed missing-column error may fall back; other read failures fail closed.
  const missingRefundColumn = initialRefreshEventsRes.error?.code === "42703" &&
    initialRefreshEventsRes.error.message.includes("quota_refunded_at");
  const refreshEventsRes = missingRefundColumn
    ? await admin.from("dating_1on1_recommendation_refresh_events").select("card_id,refreshed_at")
      .in("card_id", sourceCardIds)
      .gt("refreshed_at", new Date(nowMs - RECOMMENDATION_REFRESH_HISTORY_MS).toISOString())
      .order("refreshed_at", { ascending: true })
    : initialRefreshEventsRes;
  if (recoveryRes.error && !["42P01", "PGRST205"].includes(recoveryRes.error.code)) {
    console.warn("[GET /api/dating/1on1/recommendations/my] optional recovery unavailable", recoveryRes.error);
  }
  if ((refreshPlan || expansion) && recoveryRes.error) {
    return NextResponse.json({ error: "후보 이력을 확인하지 못했습니다. 횟수는 사용하지 않았으니 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  if (refreshEventsRes.error && (refreshPlan || expansion || !isMissingRefreshEventSchema(refreshEventsRes.error))) {
    console.error("[GET /api/dating/1on1/recommendations/my] refresh events failed", refreshEventsRes.error);
    return NextResponse.json({ error: "Failed to load recommendation refresh usage." }, { status: 500 });
  }
  for (const row of (refreshEventsRes.data ?? []) as RefreshEventRow[]) {
    const events = refreshEventsByCardId.get(row.card_id) ?? [];
    events.push(row.refreshed_at);
    refreshEventsByCardId.set(row.card_id, events);
    // Preserve the original recommendation seeds; refund only the quota charge.
    if (row.quota_refunded_at) {
      const refunded = refundedEventsByCardId.get(row.card_id) ?? [];
      refunded.push(row.refreshed_at);
      refundedEventsByCardId.set(row.card_id, refunded);
    }
  }

  const favoriteRowsRes = await admin
    .from(FAVORITE_TABLE)
    .select("source_card_id,candidate_card_id,created_at")
    .eq("user_id", user.id)
    .in("source_card_id", sourceCardIds)
    .order("created_at", { ascending: false });
  let favoriteRows: FavoriteRow[] = [];
  if (favoriteRowsRes.error) {
    if (refreshPlan || expansion) {
      return NextResponse.json({ error: "찜한 후보를 확인하지 못했습니다. 횟수는 사용하지 않았으니 잠시 후 다시 시도해 주세요." }, { status: 503 });
    }
    if (!isMissingFavoriteSchema(favoriteRowsRes.error)) {
      console.error("[GET /api/dating/1on1/recommendations/my] favorites failed", favoriteRowsRes.error);
    }
  } else {
    favoriteRows = (favoriteRowsRes.data ?? []) as FavoriteRow[];
  }

  const allCandidateUserIds = [...new Set([user.id, ...candidateUniverse.map((card) => card.user_id)])];
  const profilePhoneMap = new Map([...profiles].flatMap(([userId, profile]) => profile.phone ? [[userId, profile.phone] as const] : []));
  let plusByUserId: Awaited<ReturnType<typeof getActiveOneOnOnePlusByUserIds>>;
  let activityByUserId: Map<string, string>;
  let pairRows: OneOnOnePairHistory[];
  let phoneBlockMap: Awaited<ReturnType<typeof getOneOnOnePhoneBlockMapForUsers>>;
  let adminUserBlockPairSet: Awaited<ReturnType<typeof getOneOnOneAdminUserBlockPairSetForUsers>>;
  let contactBlockMap: Awaited<ReturnType<typeof getDatingContactBlockMapForUsers>>;
  let blockedUserIds: Awaited<ReturnType<typeof getDatingBlockedUserIds>>;
  let hiddenCandidates: Awaited<ReturnType<typeof readCandidateHides>>;
  try {
    [
      pairRows,
      phoneBlockMap,
      adminUserBlockPairSet,
      contactBlockMap,
      blockedUserIds,
      plusByUserId,
      activityByUserId,
      hiddenCandidates,
    ] = await Promise.all([
      fetchOneOnOnePairHistory(admin, user.id),
      getOneOnOnePhoneBlockMapForUsers(admin, allCandidateUserIds),
      getOneOnOneAdminUserBlockPairSetForUsers(admin, [user.id]),
      getDatingContactBlockMapForUsers(admin, allCandidateUserIds),
      getDatingBlockedUserIds(admin, user.id),
      getActiveOneOnOnePlusByUserIds(admin, allCandidateUserIds),
      fetchRecommendationActivity(admin, candidateUniverse.map((card) => card.user_id), nowMs).catch((error) => {
        // GET can degrade gracefully, but a quota write needs the full ranking
        // context. Otherwise recovering optional reads could undo the predicted change.
        if (refreshPlan || expansion) throw error;
        // Activity is a ranking hint, not an eligibility check. Keep recommendations
        // available if this optional signal is unavailable; safety queries still fail closed.
        console.warn("[GET /api/dating/1on1/recommendations/my] activity unavailable", error);
        return new Map<string, string>();
      }),
      readCandidateHides(admin, user.id),
    ]);
  } catch (error) {
    console.error("[GET /api/dating/1on1/recommendations/my] recommendation context failed", error);
    return NextResponse.json({ error: "Failed to load recommendation context." }, { status: 500 });
  }

  for (const card of [...mySourceCards, ...candidateUniverse]) {
    card.plus_expires_at = plusByUserId.get(card.user_id)?.expires_at ?? null;
    card.last_active_at = latestRecommendationActivity(nowMs, card.last_active_at, activityByUserId.get(card.user_id));
  }

  const activeUserIds = new Set<string>();
  const handledUserIds = new Set<string>();
  const lastHandledAtByUserId = new Map<string, number>();
  const permanentlyRejectedUserIds = new Set<string>();
  for (const row of pairRows) {
    const otherUserId = row.source_user_id === user.id ? row.candidate_user_id : row.source_user_id;
    if ((DATING_ONE_ON_ONE_MATCH_PERMANENT_REJECTION_STATES as readonly string[]).includes(row.state)) {
      permanentlyRejectedUserIds.add(otherUserId);
    }
    if (ACTIVE_PAIR_STATES.has(row.state)) {
      activeUserIds.add(otherUserId);
      continue;
    }
    if (RECYCLABLE_PAIR_STATES.has(row.state)) {
      handledUserIds.add(otherUserId);
      const basis = row.updated_at ?? row.created_at;
      const parsed = Date.parse(basis ?? "");
      // Unknown timestamps retain the conservative recent-history treatment.
      const endedAt = Number.isFinite(parsed) ? Math.min(nowMs, parsed) : nowMs;
      lastHandledAtByUserId.set(otherUserId, Math.max(lastHandledAtByUserId.get(otherUserId) ?? 0, endedAt));
    }
  }
  const candidateRevisitTimes = new Map(candidateUniverse.map((card) => [card.id, lastHandledAtByUserId.get(card.user_id)]));
  const hiddenUserIds = new Set(hiddenCandidates.rows.map(row => row.candidate_user_id));
  const notHidden = (card: RecommendationCard) => !hiddenUserIds.has(card.user_id);
  const hiddenCardIds = [...new Set([
    ...hiddenCandidates.rows.flatMap(row => row.candidate_card_id ? [row.candidate_card_id] : []),
    ...candidateUniverse.filter(card => hiddenUserIds.has(card.user_id)).map(card => card.id),
  ])];

  const unavailableCardIds = new Set<string>();
  const buildItems = (simulateRefresh = false) => mySourceCards.map((sourceCard) => {
    const handledPairIds = new Set(candidateUniverse.filter((card) => handledUserIds.has(card.user_id)).map((card) => card.id));
    const sourcePhone = sourceCard.phone ? normalizePhoneForOneOnOneBlock(sourceCard.phone) : "";
    const candidates = candidateUniverse.filter((candidateCard) => {
      if (unavailableCardIds.has(candidateCard.id)) return false;
      if (candidateCard.id === sourceCard.id) return false;
      if (candidateCard.user_id === sourceCard.user_id) return false;
      const candidatePhone = candidateCard.phone
        ? normalizePhoneForOneOnOneBlock(candidateCard.phone)
        : "";
      if (sourcePhone && candidatePhone === sourcePhone) return false;
      if (candidateCard.sex === sourceCard.sex) return false;
      if (blockedUserIds.has(candidateCard.user_id)) return false;
      if (permanentlyRejectedUserIds.has(candidateCard.user_id)) return false;
      if (activeUserIds.has(candidateCard.user_id)) return false;
      if (
        isOneOnOnePhoneBlockedPair({
          sourceUserId: sourceCard.user_id,
          sourcePhone: profilePhoneMap.get(sourceCard.user_id) ?? sourceCard.phone,
          candidateUserId: candidateCard.user_id,
          candidatePhone: profilePhoneMap.get(candidateCard.user_id) ?? candidateCard.phone,
          blockMap: phoneBlockMap,
        })
      ) {
        return false;
      }
      if (
        isDatingContactPhoneBlockedPair({
          sourceUserId: sourceCard.user_id,
          sourcePhone: profilePhoneMap.get(sourceCard.user_id) ?? sourceCard.phone,
          candidateUserId: candidateCard.user_id,
          candidatePhone: profilePhoneMap.get(candidateCard.user_id) ?? candidateCard.phone,
          blockMap: contactBlockMap,
        })
      ) {
        return false;
      }
      if (
        isOneOnOneAdminUserBlockedPair({
          sourceUserId: sourceCard.user_id,
          candidateUserId: candidateCard.user_id,
          pairSet: adminUserBlockPairSet,
        })
      ) {
        return false;
      }
      return (
        candidateCard.status === "submitted" ||
        candidateCard.status === "reviewing" ||
        candidateCard.status === "approved"
      );
    });

    const favoriteIds = new Set(
      favoriteRows.filter((row) => row.source_card_id === sourceCard.id).map((row) => row.candidate_card_id),
    );
    const favoriteCandidates = favoriteRows
      .filter((row) => row.source_card_id === sourceCard.id)
      .flatMap((row) => candidates.find((candidate) => candidate.id === row.candidate_card_id) ?? []);
    const unsavedCandidates = candidates.filter((candidate) => !favoriteIds.has(candidate.id)).map((candidate) => ({
      ...candidate,
      last_handled_at: candidateRevisitTimes.get(candidate.id) != null
        ? new Date(candidateRevisitTimes.get(candidate.id)!).toISOString() : null,
    }));
    // New selections and legacy replay must use the same eligible pool, so the
    // planned refresh cannot disagree with its subsequent GET response.
    const selectionCandidates = unsavedCandidates.filter(notHidden);
    const defaultSortedCandidates = sortCandidatesForSource(sourceCard, selectionCandidates, `${adminRecommendationDate}:default`, nowMs);
    const defaultPageAt = Date.parse(`${adminRecommendationDate}T00:00:00+09:00`);
    const dailyObservedIds = observedCandidateIdsAt(observations, defaultPageAt);
    const defaultRecommendations = dailyObservedIds.size ? takeObservedRecommendations(sourceCard, defaultSortedCandidates,
      RECOMMENDATION_LIMIT, dailyObservedIds, new Set(), handledPairIds, nowMs) : takeBalancedRecommendations(
      sourceCard,
      defaultSortedCandidates,
      RECOMMENDATION_LIMIT,
      handledPairIds,
      nowMs
    );
    const activeRefresh = getActiveRecommendationRefresh(sourceCard.recommendation_refresh_used_at, nowMs);
    const refreshSeeds = [...(refreshEventsByCardId.get(sourceCard.id) ?? [])];
    if (
      activeRefresh &&
      !refreshSeeds.some((value) => Math.abs(Date.parse(value) - Date.parse(activeRefresh)) <= 5_000)
    ) {
      // Compatibility for a card refreshed before the event table migration.
      refreshSeeds.push(activeRefresh);
      refreshSeeds.sort((a, b) => Date.parse(a) - Date.parse(b));
    }

    const recoverySeed = getRecommendationRecoverySeed(recoveryRes.error ? null : recoveryRes.data?.refreshed_at, nowMs);
    if (recoverySeed) refreshSeeds.push(recoverySeed);
    if (simulateRefresh && refreshPlan && sourceCard.id === refreshPlan.sourceCardId && !savedPageResult?.available) refreshSeeds.push(refreshPlan.at);
    const hasActiveRefresh = refreshSeeds.some((seed) => getActiveRecommendationRefresh(seed, nowMs));
    const recentHandledIds = new Set(unsavedCandidates.filter((card) => isRecentlyHandledCandidate(card, nowMs)).map((card) => card.id));
    const savedPage = savedPageResult.page;
    const hasSavedPage = savedPage && savedPage.source_card_id === sourceCard.id && activeRefresh &&
      Date.parse(savedPage.refreshed_at) === Date.parse(activeRefresh) &&
      savedPage.source_profile_key === recommendationSourceKey(sourceCard) &&
      (!recoverySeed || Date.parse(recoverySeed) <= Date.parse(savedPage.refreshed_at));
    // Once an exact page and real observations exist, replaying 32 historical
    // pages only to throw them away adds CPU cost and no information.
    const replay = hasSavedPage && observations.length > 0
      ? { recommendations: [] as typeof defaultRecommendations, extraRecommendations: [] as typeof defaultRecommendations,
        shownIds: observedCandidateIdsAt(observations, nowMs) }
      : replayRecommendationRefreshes(sourceCard, selectionCandidates,
      defaultRecommendations, hasActiveRefresh ? refreshSeeds : [], handledPairIds, RECOMMENDATION_LIMIT, nowMs,
      { limit: ONE_ON_ONE_FREE_EXTRA_CANDIDATES, excludeIds: recentHandledIds }, observations);
    let recommendations = hasActiveRefresh ? replay.recommendations : defaultRecommendations;
    let adminRecommendations = replay.extraRecommendations;
    const pageContext = { handled: handledPairIds, extraExcluded: recentHandledIds, observations,
      limit: RECOMMENDATION_LIMIT, extraLimit: ONE_ON_ONE_FREE_EXTRA_CANDIDATES, recentPages: recentPages ?? undefined };
    if (hasSavedPage) {
      // Retain hidden slots only in this already-saved page; final filtering
      // removes them without hiding becoming an implicit charged refresh.
      const savedIds = new Set([...savedPage.main_candidate_ids, ...savedPage.extra_candidate_ids]);
      const restored = restoreRecommendationPage(sourceCard, unsavedCandidates.filter(card => notHidden(card) || savedIds.has(card.id)), savedPage, nowMs, pageContext);
      recommendations = restored.recommendations;
      adminRecommendations = restored.extraRecommendations;
    }
    if (simulateRefresh && refreshPlan && sourceCard.id === refreshPlan.sourceCardId && savedPageResult?.available) {
      const next = nextRecommendationPage(sourceCard, selectionCandidates, { recommendations: recommendations.filter(notHidden), extraRecommendations: adminRecommendations.filter(notHidden) },
        refreshPlan.at, nowMs, pageContext, replay.shownIds);
      recommendations = next.recommendations;
      adminRecommendations = next.extraRecommendations;
    }
    // Extras cannot overlap the current main page. Earlier pages are a soft
    // preference, not a reason to replace compatible local people with remote ones.
    const sourcePlus = plusByUserId.get(sourceCard.user_id) ?? null;
    const refreshLimit = sourcePlus ? ONE_ON_ONE_PLUS_REFRESH_LIMIT : ONE_ON_ONE_FREE_REFRESH_LIMIT;
    const refreshAvailability = getRefreshAvailability(
      refreshEventsByCardId.get(sourceCard.id) ?? [],
      sourceCard.recommendation_refresh_used_at,
      refreshLimit,
      refundedEventsByCardId.get(sourceCard.id) ?? []
    );
    const expansionExclusions = expansion ? new Set([...favoriteIds, ...recommendations.map(card => card.id), ...adminRecommendations.map(card => card.id),
      // A new batch should not recycle a known earlier page. A stored batch is
      // only revalidated, never reranked/refilled as history changes.
      ...(expansion.candidateIds ? [] : observations.length
        ? observedCandidateIdsAt(observations, nowMs) : replay.shownIds)]) : new Set<string>();
    const expansionCandidates = expansion ? selectExpansionCandidates(sourceCard, unsavedCandidates.filter(card => notHidden(card) && profiles.get(card.user_id)?.phone),
      expansionExclusions, adminRecommendationDate, nowMs, expansion.candidateIds) : [];

    return {
      source_card_id: sourceCard.id,
      source_card_status: sourceCard.status,
      refresh_used: refreshAvailability.refreshUsed,
      refresh_used_at: sourceCard.recommendation_refresh_used_at ?? null,
      refresh_used_count: refreshAvailability.refreshUsedCount,
      refresh_remaining: refreshAvailability.refreshRemaining + bonusRemaining,
      refresh_bonus_remaining: bonusRemaining,
      refresh_limit: refreshAvailability.refreshLimit,
      next_refresh_at: bonusRemaining > 0 ? null : refreshAvailability.nextRefreshAt,
      can_refresh: refreshAvailability.canRefreshNow || bonusRemaining > 0,
      recovery_refresh_applied: Boolean(getActiveRecommendationRefresh(recoverySeed, nowMs)),
      candidate_pool_count: candidates.filter(notHidden).length,
      hides_enabled: hiddenCandidates.available,
      hidden_candidate_ids: hiddenCardIds,
      plus: sourcePlus,
      favorite_candidates: favoriteCandidates.filter(notHidden),
      recommendations: recommendations.filter(notHidden),
      admin_recommendation_date: adminRecommendationDate,
      admin_recommendations: adminRecommendations.filter(notHidden),
      admin_recommendation_limit: ONE_ON_ONE_FREE_EXTRA_CANDIDATES,
      ...(expansion ? { expansion_candidates: expansionCandidates } : {}),
    };
  });

  try {
    let items = buildItems();
    let plannedItems = refreshPlan ? buildItems(true) : [];
    const checkedCardIds = new Set<string>();
    // Validate only the short list we intend to display. Refill removed stale
    // identities from the full ranked pool, not by scanning everyone's phones.
    // Each iteration checks new IDs, so even a dirty legacy pool terminates.
    while (true) {
      const pending = [...new Map([
        ...mySourceCards,
        ...[...items, ...plannedItems].flatMap((item) => [...item.favorite_candidates, ...item.recommendations, ...item.admin_recommendations, ...(item.expansion_candidates ?? [])]),
      ].filter((card) => !checkedCardIds.has(card.id)).map((card) => [card.id, card])).values()];
      if (pending.length === 0) break;
      const currentIds = await getCurrentOneOnOneCardIds(admin, pending, profiles);
      const invalid = pending.filter((card) => !currentIds.has(card.id));
      for (const card of pending) checkedCardIds.add(card.id);
      if (invalid.some((card) => card.user_id === user.id)) return NextResponse.json({ items: [] });
      if (invalid.length === 0) break;
      for (const card of invalid) unavailableCardIds.add(card.id);
      items = buildItems();
      plannedItems = refreshPlan ? buildItems(true) : [];
    }
    const details = await fetchRecommendationDetails(admin, [...items, ...plannedItems].flatMap((item) =>
      [...item.favorite_candidates, ...item.recommendations, ...item.admin_recommendations, ...(item.expansion_candidates ?? [])].map((card) => card.id)));
    const hydrate = (cards: RecommendationCard[]) => cards.flatMap((card) => {
      const detail = details.get(card.id);
      // Status is rechecked by the detail query; also drop identities/sex changed mid-request.
      return detail && detail.user_id === card.user_id && detail.sex === card.sex ? [detail] : [];
    });
    if (expansion) {
      const item = items[0];
      const candidates = hydrate(item?.expansion_candidates ?? []);
      return NextResponse.json({ source_card_id: item?.source_card_id ?? null, candidates,
        impression_ticket: impressionResult?.available && item ? createImpressionTicket(user.id, item.source_card_id, candidates.map(card => card.id), nowMs) : null });
    }
    if (refreshPlan) {
      const before = items.find((item) => item.source_card_id === refreshPlan.sourceCardId);
      const after = plannedItems.find((item) => item.source_card_id === refreshPlan.sourceCardId);
      if (!before || !after) return NextResponse.json({ error: "현재 사용 중인 1:1 프로필을 다시 확인해 주세요." }, { status: 409 });
      // Compare people across main + extras, not positions. Moving the same person
      // between the two sections is NOT a new candidate and must not consume quota.
      const oldIds = new Set(hydrate([...before.recommendations, ...before.admin_recommendations]).map((card) => card.user_id));
      const visibleBeforeIds = new Set(oldIds);
      // A different page is not necessarily a new person. Members with exhausted
      // local pools were paying to alternate between already-viewed pages.
      // Use the same 30-day history as ranking, at the planned generation cutoff.
      for (const row of impressionResult?.rows ?? []) {
        const seenAt = Date.parse(row.first_seen_at);
        if (seenAt < nowMs && seenAt >= nowMs - 30 * 86400000) oldIds.add(row.candidate_user_id);
      }
      // A committed page is also a delivery receipt. A missed/delayed browser
      // impression must not charge again when a previously assigned person returns.
      const priorPageIds = new Set((recentPages ?? []).filter(page =>
        page.at < nowMs && page.at >= nowMs - 30 * 86400000).flatMap(page => page.ids));
      for (const card of candidateUniverse) if (priorPageIds.has(card.id)) oldIds.add(card.user_id);
      if (isExpansionEnabled(user.id)) {
        const seen = await admin.from(EXPANSION_TABLE).select("candidate_ids")
          .eq("user_id", user.id).gte("day_key", getKstDateString(new Date(nowMs - RECOMMENDATION_REFRESH_HISTORY_MS)));
        if (seen.error && !["42P01", "PGRST205"].includes(seen.error.code)) {
          return NextResponse.json({ error: "추가 후보 이력을 확인하지 못했어요. 새로고침 횟수는 사용하지 않았어요." }, { status: 503 });
        }
        const seenIds = new Set((seen.data ?? []).flatMap(row => Array.isArray(row.candidate_ids) ? row.candidate_ids as string[] : []));
        // Moving an already revealed expansion candidate into the main page is
        // not a new person and must not consume a paid refresh allowance alone.
        for (const card of candidateUniverse) if (seenIds.has(card.id)) oldIds.add(card.user_id);
      }
      const newIds = new Set(hydrate([...after.recommendations, ...after.admin_recommendations]).map((card) => card.user_id));
      const source = mySourceCards.find(card => card.id === before.source_card_id)!;
      const beforeCards = hydrate([...before.recommendations, ...before.admin_recommendations]);
      const afterCards = hydrate([...after.recommendations, ...after.admin_recommendations]);
      // Monitoring is server-only. A background recovery must not widen a
      // member's region just to manufacture a different page.
      const localAgeMatch = (card: (typeof afterCards)[number]) => {
        const km = getRegionDistanceMeta(source.region, card.region).distanceKm;
        return isCandidateInSourceAgeRange(source, card) && km != null && km <= 90;
      };
      const plan: RecommendationRefreshPlan = {
        source_card_id: before.source_card_id, expected_refresh_used_at: before.refresh_used_at,
        refresh_at: refreshPlan.at,
        changed_candidate_count: [...newIds].filter((id) => !oldIds.has(id)).length,
        rotated_candidate_count: [...newIds].filter((id) => !visibleBeforeIds.has(id)).length,
        refresh_limit: before.refresh_limit, refresh_used_count: before.refresh_used_count,
        refresh_remaining: before.refresh_remaining, refresh_bonus_remaining: before.refresh_bonus_remaining,
        next_refresh_at: before.next_refresh_at,
        plus_active: Boolean(before.plus),
        persist_page: savedPageResult?.available === true,
        source_profile_key: recommendationSourceKey(mySourceCards.find(card => card.id === before.source_card_id)!),
        main_candidate_ids: hydrate(after.recommendations).map(card => card.id),
        extra_candidate_ids: hydrate(after.admin_recommendations).map(card => card.id),
        monitor: {
          before_candidate_ids: beforeCards.map(card => card.id),
          before_user_ids: [...visibleBeforeIds], after_user_ids: [...newIds],
          pool_count: Math.max(0, before.candidate_pool_count - before.favorite_candidates.length),
          widened_count: afterCards.filter(card => isWiderRecommendationRegion(source, card)).length,
          age_mismatch_count: afterCards.filter(card => !isCandidateInSourceAgeRange(source, card)).length,
          safe_local_change: afterCards.length >= beforeCards.length
            && afterCards.some(card => !visibleBeforeIds.has(card.user_id))
            && afterCards.filter(card => !visibleBeforeIds.has(card.user_id)).every(localAgeMatch)
            && afterCards.filter(card => isCandidateInSourceAgeRange(source, card)).length
              >= beforeCards.filter(card => isCandidateInSourceAgeRange(source, card)).length,
        },
      };
      return NextResponse.json({ plan });
    }
    return NextResponse.json({ items: items.map((item) => {
      const source = mySourceCards.find(card => card.id === item.source_card_id);
      // Add presentation metadata only after the final status/identity check.
      // No extra queries or client-side region database, and no exact locations.
      const withRegionNotice = (cards: RecommendationCard[]) => hydrate(cards).map(card => ({
        ...card, recommendation_region_widened: source ? isWiderRecommendationRegion(source, card) : false,
      }));
      const recommendations = withRegionNotice(item.recommendations);
      const adminRecommendations = withRegionNotice(item.admin_recommendations);
      const visibleCandidates = [...recommendations, ...adminRecommendations];
      return {
        ...item,
        favorite_candidates: hydrate(item.favorite_candidates),
        recommendations,
        admin_recommendations: adminRecommendations,
        // Compute after final status/identity checks so removed cards cannot trigger the notice.
        recommendation_region_widened: source ? hasWiderRecommendationRegion(source, visibleCandidates) : false,
        impression_ticket: impressionResult?.available ? createImpressionTicket(user.id, item.source_card_id,
          visibleCandidates.map(card => card.id), nowMs) : null,
      };
    }) });
  } catch (error) {
    console.error("[GET /api/dating/1on1/recommendations/my] details failed", error);
    return NextResponse.json({ error: "Failed to load recommendation details." }, { status: 500 });
  }
}

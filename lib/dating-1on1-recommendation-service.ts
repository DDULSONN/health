import {
  DATING_ONE_ON_ONE_MATCH_PERMANENT_REJECTION_STATES,
  DATING_ONE_ON_ONE_PENDING_PAIR_TTL_MS,
  isDatingOneOnOnePendingPairExpired,
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

const RECOMMENDATION_LIMIT = 10;
const FAVORITE_TABLE = "dating_1on1_candidate_favorites";
const RECOMMENDATION_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ACTIVE_PAIR_STATES = new Set(["proposed", "source_selected", "candidate_accepted", "mutual_accepted"]);
const RECYCLABLE_PAIR_STATES = new Set(["source_skipped", "admin_canceled"]);

type RecommendationCard = RecommendationCardRow & {
  age: number | null;
  plus_expires_at?: string | null;
  last_active_at?: string | null;
};
type RefreshEventRow = {
  card_id: string;
  refreshed_at: string;
};
type FavoriteRow = {
  source_card_id: string;
  candidate_card_id: string;
  created_at: string;
};

function getRefreshAvailability(
  refreshEvents: string[],
  legacyRefreshUsedAt: string | null | undefined,
  refreshLimit: number
) {
  const nowMs = Date.now();
  const windowStartMs = nowMs - RECOMMENDATION_REFRESH_COOLDOWN_MS;
  const refreshTimes = refreshEvents
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value) && value > windowStartMs)
    .sort((a, b) => a - b);

  if (refreshTimes.length === 0 && legacyRefreshUsedAt) {
    const legacyRefreshMs = Date.parse(legacyRefreshUsedAt);
    if (Number.isFinite(legacyRefreshMs) && legacyRefreshMs > windowStartMs) {
      refreshTimes.push(legacyRefreshMs);
    }
  }

  const usedCount = refreshTimes.length;
  const remainingCount = Math.max(refreshLimit - usedCount, 0);
  const nextRefreshMs = remainingCount === 0 && refreshTimes[0]
    ? refreshTimes[0] + RECOMMENDATION_REFRESH_COOLDOWN_MS
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
  refresh_limit: number;
  refresh_used_count: number;
  refresh_remaining: number;
  next_refresh_at: string | null;
  plus_active: boolean;
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

  const [refreshEventsRes, recoveryRes] = await Promise.all([
    admin.from("dating_1on1_recommendation_refresh_events")
      .select("card_id,refreshed_at")
      .in("card_id", sourceCardIds)
      .gt("refreshed_at", new Date(nowMs - RECOMMENDATION_REFRESH_HISTORY_MS).toISOString())
      .order("refreshed_at", { ascending: true }),
    // Primary-key lookup of at most one server-only, already-applied correction.
    admin.from("dating_1on1_recommendation_recoveries")
      .select("card_id,refreshed_at")
      .eq("user_id", user.id)
      .eq("card_id", sourceCardIds[0])
      .maybeSingle(),
  ]);
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
  try {
    [
      pairRows,
      phoneBlockMap,
      adminUserBlockPairSet,
      contactBlockMap,
      blockedUserIds,
      plusByUserId,
      activityByUserId,
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
    if (ACTIVE_PAIR_STATES.has(row.state) && !isDatingOneOnOnePendingPairExpired(row)) {
      activeUserIds.add(otherUserId);
      continue;
    }
    const recyclable =
      RECYCLABLE_PAIR_STATES.has(row.state) || isDatingOneOnOnePendingPairExpired(row);
    if (recyclable) {
      handledUserIds.add(otherUserId);
      const pending = row.state === "proposed" || row.state === "source_selected";
      const basis = pending
        ? (row.state === "source_selected" ? row.source_selected_at ?? row.updated_at ?? row.created_at : row.created_at ?? row.updated_at)
        : row.updated_at ?? row.created_at;
      const parsed = Date.parse(basis ?? "");
      // Unknown timestamps retain the conservative recent-history treatment.
      const endedAt = Number.isFinite(parsed) ? Math.min(nowMs, parsed + (pending ? DATING_ONE_ON_ONE_PENDING_PAIR_TTL_MS : 0)) : nowMs;
      lastHandledAtByUserId.set(otherUserId, Math.max(lastHandledAtByUserId.get(otherUserId) ?? 0, endedAt));
    }
  }
  const candidateRevisitTimes = new Map(candidateUniverse.map((card) => [card.id, lastHandledAtByUserId.get(card.user_id)]));

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
    const defaultSortedCandidates = sortCandidatesForSource(sourceCard, unsavedCandidates, `${adminRecommendationDate}:default`, nowMs);
    const defaultRecommendations = takeBalancedRecommendations(
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
    if (simulateRefresh && refreshPlan && sourceCard.id === refreshPlan.sourceCardId) refreshSeeds.push(refreshPlan.at);
    const hasActiveRefresh = refreshSeeds.some((seed) => getActiveRecommendationRefresh(seed, nowMs));
    const recentHandledIds = new Set(unsavedCandidates.filter((card) => isRecentlyHandledCandidate(card, nowMs)).map((card) => card.id));
    const replay = replayRecommendationRefreshes(sourceCard, unsavedCandidates,
      defaultRecommendations, hasActiveRefresh ? refreshSeeds : [], handledPairIds, RECOMMENDATION_LIMIT, nowMs,
      { limit: ONE_ON_ONE_FREE_EXTRA_CANDIDATES, excludeIds: recentHandledIds });
    const recommendations = hasActiveRefresh ? replay.recommendations : defaultRecommendations;
    // Extras cannot overlap the current main page. Earlier pages are a soft
    // preference, not a reason to replace compatible local people with remote ones.
    const sourcePlus = plusByUserId.get(sourceCard.user_id) ?? null;
    const refreshLimit = sourcePlus ? ONE_ON_ONE_PLUS_REFRESH_LIMIT : ONE_ON_ONE_FREE_REFRESH_LIMIT;
    const refreshAvailability = getRefreshAvailability(
      refreshEventsByCardId.get(sourceCard.id) ?? [],
      sourceCard.recommendation_refresh_used_at,
      refreshLimit
    );
    const adminRecommendations = replay.extraRecommendations;
    const expansionExclusions = expansion ? new Set([...favoriteIds, ...recommendations.map(card => card.id), ...adminRecommendations.map(card => card.id),
      // A new batch should not recycle a known earlier page. A stored batch is
      // only revalidated, never reranked/refilled as history changes.
      ...(expansion.candidateIds ? [] : replay.shownIds)]) : new Set<string>();
    const expansionCandidates = expansion ? selectExpansionCandidates(sourceCard, unsavedCandidates.filter(card => profiles.get(card.user_id)?.phone),
      expansionExclusions, adminRecommendationDate, nowMs, expansion.candidateIds) : [];

    return {
      source_card_id: sourceCard.id,
      source_card_status: sourceCard.status,
      refresh_used: refreshAvailability.refreshUsed,
      refresh_used_at: sourceCard.recommendation_refresh_used_at ?? null,
      refresh_used_count: refreshAvailability.refreshUsedCount,
      refresh_remaining: refreshAvailability.refreshRemaining,
      refresh_limit: refreshAvailability.refreshLimit,
      next_refresh_at: refreshAvailability.nextRefreshAt,
      can_refresh: refreshAvailability.canRefreshNow,
      recovery_refresh_applied: Boolean(getActiveRecommendationRefresh(recoverySeed, nowMs)),
      candidate_pool_count: candidates.length,
      plus: sourcePlus,
      favorite_candidates: favoriteCandidates,
      recommendations: recommendations,
      admin_recommendation_date: adminRecommendationDate,
      admin_recommendations: adminRecommendations,
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
      return NextResponse.json({ source_card_id: item?.source_card_id ?? null, candidates: hydrate(item?.expansion_candidates ?? []) });
    }
    if (refreshPlan) {
      const before = items.find((item) => item.source_card_id === refreshPlan.sourceCardId);
      const after = plannedItems.find((item) => item.source_card_id === refreshPlan.sourceCardId);
      if (!before || !after) return NextResponse.json({ error: "현재 사용 중인 1:1 프로필을 다시 확인해 주세요." }, { status: 409 });
      // Compare people across main + extras, not positions. Moving the same person
      // between the two sections is NOT a new candidate and must not consume quota.
      const oldIds = new Set(hydrate([...before.recommendations, ...before.admin_recommendations]).map((card) => card.user_id));
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
      const plan: RecommendationRefreshPlan = {
        source_card_id: before.source_card_id, expected_refresh_used_at: before.refresh_used_at,
        refresh_at: refreshPlan.at,
        changed_candidate_count: [...newIds].filter((id) => !oldIds.has(id)).length,
        refresh_limit: before.refresh_limit, refresh_used_count: before.refresh_used_count,
        refresh_remaining: before.refresh_remaining, next_refresh_at: before.next_refresh_at,
        plus_active: Boolean(before.plus),
      };
      return NextResponse.json({ plan });
    }
    return NextResponse.json({ items: items.map((item) => ({
      ...item,
      favorite_candidates: hydrate(item.favorite_candidates),
      recommendations: hydrate(item.recommendations),
      admin_recommendations: hydrate(item.admin_recommendations),
    })) });
  } catch (error) {
    console.error("[GET /api/dating/1on1/recommendations/my] details failed", error);
    return NextResponse.json({ error: "Failed to load recommendation details." }, { status: 500 });
  }
}

import {
  DATING_ONE_ON_ONE_MATCH_PERMANENT_REJECTION_STATES,
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
  getRefreshExcludeIds,
  isCandidateInSourceAgeRange,
  sortCandidatesForSource,
  sortRefreshCandidatesForSource,
  takeBalancedRecommendations,
  takeRecommendations,
} from "@/lib/dating-1on1-recommendations";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
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
  type RecommendationCardRow,
} from "@/lib/dating-1on1-recommendation-data";
import { getCurrentOneOnOneCardIds } from "@/lib/dating-1on1-current-cards";
import { fetchOneOnOnePairHistory, type OneOnOnePairHistory } from "@/lib/dating-1on1-pair-history";

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

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowMs = Date.now();
  let ownRows: RecommendationCardRow[];
  let candidateRows: RecommendationCardRow[];
  let profiles: Awaited<ReturnType<typeof fetchRecommendationProfiles>>;
  try {
    ownRows = await fetchActiveRecommendationRows(admin, { userId: user.id });
    // No application means no candidate scans, subscriptions, photos or block lookups.
    if (ownRows.length === 0) return NextResponse.json({ items: [] });
    // Only the newest active application determines the source's gender.
    ownRows = ownRows.slice(0, 1);
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
  const normalize = (row: RecommendationCardRow): RecommendationCard => ({
    ...row,
    age: toDatingOneOnOneAge(row.birth_year),
    phone: profiles.get(row.user_id)?.phone ?? row.phone,
    last_active_at: row.recommendation_refresh_used_at ?? null,
  });
  const mySourceCards = ownRows.map(normalize);
  // Preserve the full eligible opposite-sex pool, with only small ranking fields.
  // Do not arbitrarily drop older profiles to make the query look faster.
  const candidateUniverse = dedupeOneOnOneCardsByIdentity(candidateRows
    .filter((row) => profiles.has(row.user_id) && !profiles.get(row.user_id)?.banned)
    .map(normalize));

  const sourceCardIds = mySourceCards.map((card) => card.id);
  const adminRecommendationDate = getKstDateString();
  const refreshEventsByCardId = new Map<string, string[]>();

  const refreshEventsRes = await admin
    .from("dating_1on1_recommendation_refresh_events")
    .select("card_id,refreshed_at")
    .in("card_id", sourceCardIds)
    .gt("refreshed_at", new Date(Date.now() - RECOMMENDATION_REFRESH_COOLDOWN_MS).toISOString())
    .order("refreshed_at", { ascending: true });
  if (refreshEventsRes.error && !isMissingRefreshEventSchema(refreshEventsRes.error)) {
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
    const activity = activityByUserId.get(card.user_id);
    const refreshMs = Date.parse(card.last_active_at ?? "");
    if (activity && (!Number.isFinite(refreshMs) || refreshMs > nowMs || Date.parse(activity) > refreshMs)) {
      card.last_active_at = activity;
    }
  }

  const activeUserIds = new Set<string>();
  const handledUserIds = new Set<string>();
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
    if (recyclable) handledUserIds.add(otherUserId);
  }

  const unavailableCardIds = new Set<string>();
  const buildItems = () => mySourceCards.map((sourceCard) => {
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
    const unsavedCandidates = candidates.filter((candidate) => !favoriteIds.has(candidate.id));
    const defaultSortedCandidates = sortCandidatesForSource(sourceCard, unsavedCandidates, `${adminRecommendationDate}:default`, nowMs);
    const defaultRecommendations = takeBalancedRecommendations(
      sourceCard,
      defaultSortedCandidates,
      RECOMMENDATION_LIMIT,
      handledPairIds,
      nowMs
    );
    const activeRefresh = getActiveRecommendationRefresh(sourceCard.recommendation_refresh_used_at, nowMs);
    const refreshSeeds = (refreshEventsByCardId.get(sourceCard.id) ?? [])
      .map((value) => getActiveRecommendationRefresh(value, nowMs))
      .filter((value): value is string => Boolean(value));
    if (
      activeRefresh &&
      !refreshSeeds.some((value) => Math.abs(Date.parse(value) - Date.parse(activeRefresh)) <= 5_000)
    ) {
      // Compatibility for a card refreshed before the event table migration.
      refreshSeeds.push(activeRefresh);
      refreshSeeds.sort((a, b) => Date.parse(a) - Date.parse(b));
    }

    let recommendations = defaultRecommendations;
    const previouslyShownRecommendationIds = new Set(handledPairIds);
    const allShownRecommendationIds = new Set(defaultRecommendations.map((candidate) => candidate.id));
    for (const refreshSeed of refreshSeeds) {
      const refreshExcludeIds = getRefreshExcludeIds(
        sourceCard,
        defaultRecommendations,
        refreshSeed
      );
      for (const shownId of previouslyShownRecommendationIds) refreshExcludeIds.add(shownId);
      recommendations = takeBalancedRecommendations(
        sourceCard,
        sortRefreshCandidatesForSource(
          sourceCard,
          unsavedCandidates,
          refreshSeed,
          refreshExcludeIds,
          nowMs
        ),
        RECOMMENDATION_LIMIT,
        refreshExcludeIds,
        nowMs
      );
      for (const candidate of recommendations) {
        previouslyShownRecommendationIds.add(candidate.id);
        allShownRecommendationIds.add(candidate.id);
      }
    }
    const sourcePlus = plusByUserId.get(sourceCard.user_id) ?? null;
    const refreshLimit = sourcePlus ? ONE_ON_ONE_PLUS_REFRESH_LIMIT : ONE_ON_ONE_FREE_REFRESH_LIMIT;
    const refreshAvailability = getRefreshAvailability(
      refreshEventsByCardId.get(sourceCard.id) ?? [],
      sourceCard.recommendation_refresh_used_at,
      refreshLimit
    );
    const adminExcludeIds = new Set([...allShownRecommendationIds, ...handledPairIds]);
    const adminRecommendations = takeRecommendations(
      sortCandidatesForSource(
        sourceCard,
        unsavedCandidates.filter((candidate) => isCandidateInSourceAgeRange(sourceCard, candidate)),
        `${adminRecommendationDate}:admin-extra`,
        nowMs
      ),
      ONE_ON_ONE_FREE_EXTRA_CANDIDATES,
      adminExcludeIds
    );

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
      candidate_pool_count: candidates.length,
      plus: sourcePlus,
      favorite_candidates: favoriteCandidates,
      recommendations: recommendations,
      admin_recommendation_date: adminRecommendationDate,
      admin_recommendations: adminRecommendations,
      admin_recommendation_limit: ONE_ON_ONE_FREE_EXTRA_CANDIDATES,
    };
  });

  try {
    let items = buildItems();
    const checkedCardIds = new Set<string>();
    // Validate only the short list we intend to display. Refill removed stale
    // identities from the full ranked pool, not by scanning everyone's phones.
    // Each iteration checks new IDs, so even a dirty legacy pool terminates.
    while (true) {
      const pending = [...new Map([
        ...mySourceCards,
        ...items.flatMap((item) => [...item.favorite_candidates, ...item.recommendations, ...item.admin_recommendations]),
      ].filter((card) => !checkedCardIds.has(card.id)).map((card) => [card.id, card])).values()];
      if (pending.length === 0) break;
      const currentIds = await getCurrentOneOnOneCardIds(admin, pending, profiles);
      const invalid = pending.filter((card) => !currentIds.has(card.id));
      for (const card of pending) checkedCardIds.add(card.id);
      if (invalid.some((card) => card.user_id === user.id)) return NextResponse.json({ items: [] });
      if (invalid.length === 0) break;
      for (const card of invalid) unavailableCardIds.add(card.id);
      items = buildItems();
    }
    const details = await fetchRecommendationDetails(admin, items.flatMap((item) =>
      [...item.favorite_candidates, ...item.recommendations, ...item.admin_recommendations].map((card) => card.id)));
    const hydrate = (cards: RecommendationCard[]) => cards.flatMap((card) => {
      const detail = details.get(card.id);
      // Status is rechecked by the detail query; also drop identities/sex changed mid-request.
      return detail && detail.user_id === card.user_id && detail.sex === card.sex ? [detail] : [];
    });
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

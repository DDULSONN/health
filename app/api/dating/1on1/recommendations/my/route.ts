import {
  DATING_ONE_ON_ONE_ACTIVE_STATUSES,
  toDatingOneOnOneCardDetail,
} from "@/lib/dating-1on1";
import {
  getOneOnOnePhoneBlockMapForUsers,
  isOneOnOnePhoneBlockedPair,
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
import { getRegionDistanceMeta } from "@/lib/region-distance";
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

const RECOMMENDATION_LIMIT = 10;
const CARD_BATCH_SIZE = 1000;
const RECOMMENDATION_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const AGE_MATCH_MIN_QUOTA = 6;
const PRIORITY_BOOST_MIN_QUOTA = 2;
const NEAR_AGE_GAP = 2;
const CLOSE_REGION_MAX_KM = 90;
const RECENT_CANDIDATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_RECENT_NEARBY_MIN_QUOTA = 4;

type CardRow = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  name: string;
  birth_year: number;
  height_cm: number;
  job: string;
  region: string;
  intro_text: string;
  strengths_text: string;
  preferred_partner_text: string;
  smoking: "non_smoker" | "occasional" | "smoker";
  workout_frequency: "none" | "1_2" | "3_4" | "5_plus" | null;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  created_at: string;
  recommendation_refresh_used_at?: string | null;
  priority_boost_expires_at?: string | null;
  plus_expires_at?: string | null;
  photo_paths: unknown;
  phone: string | null;
};
type RecommendationCard = ReturnType<typeof toDatingOneOnOneCardDetail> & {
  phone: string | null;
  priority_boost_expires_at?: string | null;
  plus_expires_at?: string | null;
};
type RefreshEventRow = {
  card_id: string;
  refreshed_at: string;
};

function getAgeRange(card: { sex: "male" | "female"; age: number | null }) {
  if (card.age == null || !Number.isFinite(card.age)) {
    return { minAge: null as number | null, maxAge: null as number | null };
  }

  return card.sex === "male"
    ? { minAge: Math.max(19, card.age - 4), maxAge: card.age + 1 }
    : { minAge: Math.max(19, card.age - 1), maxAge: card.age + 4 };
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getAgeGap(sourceAge: number | null, candidateAge: number | null): number {
  if (sourceAge == null || candidateAge == null || !Number.isFinite(sourceAge) || !Number.isFinite(candidateAge)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(sourceAge - candidateAge);
}

function isCandidateInSourceAgeRange(sourceCard: RecommendationCard, candidateCard: RecommendationCard) {
  const sourceAgeRange = getAgeRange(sourceCard);
  if (
    sourceAgeRange.minAge == null ||
    sourceAgeRange.maxAge == null ||
    candidateCard.age == null ||
    !Number.isFinite(candidateCard.age)
  ) {
    return false;
  }
  return candidateCard.age >= sourceAgeRange.minAge && candidateCard.age <= sourceAgeRange.maxAge;
}

function getDistanceRank(sourceRegion: string | null, candidateRegion: string | null) {
  const meta = getRegionDistanceMeta(sourceRegion, candidateRegion);

  return {
    sameRegionRank: meta.sameRegion ? 0 : 1,
    sameProvinceRank: meta.sameProvince ? 0 : 1,
    distanceBandRank:
      meta.distanceKm == null ? 4 : meta.distanceKm <= 15 ? 0 : meta.distanceKm <= 40 ? 1 : meta.distanceKm <= 90 ? 2 : 3,
    distanceRank: meta.distanceKm ?? Number.POSITIVE_INFINITY,
  };
}

function isPriorityBoostActive(card: { priority_boost_expires_at?: string | null; plus_expires_at?: string | null }) {
  return [card.priority_boost_expires_at, card.plus_expires_at].some((value) => {
    if (!value) return false;
    const expiresAtMs = new Date(value).getTime();
    return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
  });
}

function isRecentlyCreated(card: { created_at: string }, nowMs = Date.now()) {
  const createdAtMs = Date.parse(card.created_at);
  return Number.isFinite(createdAtMs) && nowMs - createdAtMs <= RECENT_CANDIDATE_WINDOW_MS;
}

function getCreatedAtRank(card: { created_at: string }) {
  const createdAtMs = Date.parse(card.created_at);
  return Number.isFinite(createdAtMs) ? -createdAtMs : Number.POSITIVE_INFINITY;
}

function isCloseRegionCandidate(sourceCard: RecommendationCard, candidateCard: RecommendationCard) {
  const distance = getRegionDistanceMeta(sourceCard.region, candidateCard.region).distanceKm;
  return distance != null && distance <= CLOSE_REGION_MAX_KM;
}

function isRecentNearbyCandidate(sourceCard: RecommendationCard, candidateCard: RecommendationCard) {
  return isRecentlyCreated(candidateCard) && (isCloseRegionCandidate(sourceCard, candidateCard) || isCandidateInSourceAgeRange(sourceCard, candidateCard));
}

function sortCandidatesForSource(
  sourceCard: RecommendationCard,
  candidates: RecommendationCard[],
  seedSuffix: string
) {
  return [...candidates].sort((a, b) => {
    const aDistanceRank = getDistanceRank(sourceCard.region, a.region);
    const bDistanceRank = getDistanceRank(sourceCard.region, b.region);
    if (aDistanceRank.sameRegionRank !== bDistanceRank.sameRegionRank) {
      return aDistanceRank.sameRegionRank - bDistanceRank.sameRegionRank;
    }
    if (aDistanceRank.sameProvinceRank !== bDistanceRank.sameProvinceRank) {
      return aDistanceRank.sameProvinceRank - bDistanceRank.sameProvinceRank;
    }

    if (aDistanceRank.distanceBandRank !== bDistanceRank.distanceBandRank) {
      return aDistanceRank.distanceBandRank - bDistanceRank.distanceBandRank;
    }
    if (aDistanceRank.distanceRank !== bDistanceRank.distanceRank) {
      return aDistanceRank.distanceRank - bDistanceRank.distanceRank;
    }

    const aBoostActive = isPriorityBoostActive(a);
    const bBoostActive = isPriorityBoostActive(b);
    if (aBoostActive !== bBoostActive) {
      return aBoostActive ? -1 : 1;
    }

    const aInAgeRange = isCandidateInSourceAgeRange(sourceCard, a);
    const bInAgeRange = isCandidateInSourceAgeRange(sourceCard, b);
    if (aInAgeRange !== bInAgeRange) {
      return aInAgeRange ? -1 : 1;
    }

    const aAgeGap = getAgeGap(sourceCard.age, a.age);
    const bAgeGap = getAgeGap(sourceCard.age, b.age);
    if (aAgeGap !== bAgeGap) {
      return aAgeGap - bAgeGap;
    }

    const aHash = hashSeed(`${sourceCard.id}:${seedSuffix}:${a.id}`);
    const bHash = hashSeed(`${sourceCard.id}:${seedSuffix}:${b.id}`);
    if (aHash !== bHash) return aHash - bHash;
    return a.id.localeCompare(b.id);
  });
}

function sortRefreshCandidatesForSource(
  sourceCard: RecommendationCard,
  candidates: RecommendationCard[],
  seedSuffix: string,
  preferredExcludeIds: Set<string>
) {
  return [...candidates].sort((a, b) => {
    const aExcluded = preferredExcludeIds.has(a.id);
    const bExcluded = preferredExcludeIds.has(b.id);
    if (aExcluded !== bExcluded) return aExcluded ? 1 : -1;

    const aRecentNearby = isRecentNearbyCandidate(sourceCard, a);
    const bRecentNearby = isRecentNearbyCandidate(sourceCard, b);
    if (aRecentNearby !== bRecentNearby) return aRecentNearby ? -1 : 1;

    const aRecent = isRecentlyCreated(a);
    const bRecent = isRecentlyCreated(b);
    if (aRecent !== bRecent) return aRecent ? -1 : 1;

    const aBoostActive = isPriorityBoostActive(a);
    const bBoostActive = isPriorityBoostActive(b);
    if (aBoostActive !== bBoostActive) return aBoostActive ? -1 : 1;

    const aInAgeRange = isCandidateInSourceAgeRange(sourceCard, a);
    const bInAgeRange = isCandidateInSourceAgeRange(sourceCard, b);
    if (aInAgeRange !== bInAgeRange) return aInAgeRange ? -1 : 1;

    const aDistanceRank = getDistanceRank(sourceCard.region, a.region);
    const bDistanceRank = getDistanceRank(sourceCard.region, b.region);
    const aIsNearby = aDistanceRank.distanceBandRank <= 2;
    const bIsNearby = bDistanceRank.distanceBandRank <= 2;
    if (aIsNearby !== bIsNearby) return aIsNearby ? -1 : 1;

    const aAgeGap = getAgeGap(sourceCard.age, a.age);
    const bAgeGap = getAgeGap(sourceCard.age, b.age);
    const aNearAge = aAgeGap <= NEAR_AGE_GAP;
    const bNearAge = bAgeGap <= NEAR_AGE_GAP;
    if (aNearAge !== bNearAge) return aNearAge ? -1 : 1;

    const aHash = hashSeed(`${sourceCard.id}:${seedSuffix}:explore:${a.id}`);
    const bHash = hashSeed(`${sourceCard.id}:${seedSuffix}:explore:${b.id}`);
    if (aHash !== bHash) return aHash - bHash;

    if (aDistanceRank.distanceBandRank !== bDistanceRank.distanceBandRank) {
      return aDistanceRank.distanceBandRank - bDistanceRank.distanceBandRank;
    }
    if (aAgeGap !== bAgeGap) return aAgeGap - bAgeGap;
    const aCreatedAtRank = getCreatedAtRank(a);
    const bCreatedAtRank = getCreatedAtRank(b);
    if (aCreatedAtRank !== bCreatedAtRank) return aCreatedAtRank - bCreatedAtRank;
    return a.id.localeCompare(b.id);
  });
}

function rotateCandidates<T>(items: T[], offset: number) {
  if (items.length <= 1) return items;
  const normalizedOffset = offset % items.length;
  if (normalizedOffset <= 0) return items;
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
}

function takeRecommendations(
  sortedCandidates: RecommendationCard[],
  limit: number,
  preferredExcludeIds: Set<string> | null = null,
  rotationSeed: string | null = null
) {
  if (!preferredExcludeIds || preferredExcludeIds.size === 0) {
    return sortedCandidates.slice(0, limit);
  }

  const preferredPool = sortedCandidates.filter((candidate) => !preferredExcludeIds.has(candidate.id));
  const rotatedPreferredPool =
    rotationSeed && preferredPool.length > limit
      ? rotateCandidates(preferredPool, hashSeed(rotationSeed) % preferredPool.length)
      : preferredPool;

  const picked: RecommendationCard[] = [];
  for (const candidate of rotatedPreferredPool) {
    if (preferredExcludeIds.has(candidate.id)) continue;
    picked.push(candidate);
    if (picked.length >= limit) {
      return picked;
    }
  }

  for (const candidate of sortedCandidates) {
    if (picked.some((pickedCandidate) => pickedCandidate.id === candidate.id)) continue;
    picked.push(candidate);
    if (picked.length >= limit) {
      return picked;
    }
  }

  return picked;
}

function takeBalancedRecommendations(
  sourceCard: RecommendationCard,
  sortedCandidates: RecommendationCard[],
  limit: number,
  preferredExcludeIds: Set<string> | null = null,
  rotationSeed: string | null = null
) {
  const excludeIds = preferredExcludeIds ?? new Set<string>();
  const picked: RecommendationCard[] = [];
  const pickedIds = new Set<string>();

  const rotateIfUseful = (items: RecommendationCard[], suffix: string) =>
    rotationSeed && items.length > 1 ? rotateCandidates(items, hashSeed(`${rotationSeed}:${suffix}`) % items.length) : items;

  const addFrom = (items: RecommendationCard[], targetCount: number, avoidExcluded: boolean) => {
    for (const candidate of items) {
      if (picked.length >= limit || picked.length >= targetCount) return;
      if (pickedIds.has(candidate.id)) continue;
      if (avoidExcluded && excludeIds.has(candidate.id)) continue;
      picked.push(candidate);
      pickedIds.add(candidate.id);
    }
  };

  const ageMatched = sortedCandidates.filter((candidate) => isCandidateInSourceAgeRange(sourceCard, candidate));
  const nearAge = sortedCandidates.filter((candidate) => getAgeGap(sourceCard.age, candidate.age) <= NEAR_AGE_GAP);
  const closeRegion = sortedCandidates.filter((candidate) => {
    return isCloseRegionCandidate(sourceCard, candidate);
  });
  const recentNearby = sortedCandidates.filter((candidate) => isRecentNearbyCandidate(sourceCard, candidate));
  const boosted = sortedCandidates.filter((candidate) => isPriorityBoostActive(candidate));

  addFrom(rotateIfUseful(boosted, "priority-boost"), Math.min(limit, PRIORITY_BOOST_MIN_QUOTA), true);
  addFrom(rotateIfUseful(recentNearby, "recent-nearby"), Math.min(limit, REFRESH_RECENT_NEARBY_MIN_QUOTA), true);
  addFrom(rotateIfUseful(ageMatched, "age-match"), Math.min(limit, AGE_MATCH_MIN_QUOTA), true);
  addFrom(rotateIfUseful(nearAge, "near-age"), Math.min(limit, Math.max(AGE_MATCH_MIN_QUOTA, 7)), true);
  addFrom(rotateIfUseful(closeRegion, "close-region"), Math.min(limit, Math.max(picked.length, 8)), true);
  addFrom(rotateIfUseful(sortedCandidates, "balanced-rest"), limit, true);

  if (picked.length < limit) {
    addFrom(rotateIfUseful(boosted, "priority-boost-fallback"), Math.min(limit, PRIORITY_BOOST_MIN_QUOTA), false);
    addFrom(rotateIfUseful(recentNearby, "recent-nearby-fallback"), Math.min(limit, REFRESH_RECENT_NEARBY_MIN_QUOTA), false);
    addFrom(rotateIfUseful(ageMatched, "age-match-fallback"), Math.min(limit, AGE_MATCH_MIN_QUOTA), false);
    addFrom(rotateIfUseful(nearAge, "near-age-fallback"), Math.min(limit, Math.max(AGE_MATCH_MIN_QUOTA, 7)), false);
    addFrom(rotateIfUseful(closeRegion, "close-region-fallback"), Math.min(limit, Math.max(picked.length, 8)), false);
    addFrom(rotateIfUseful(sortedCandidates, "balanced-rest-fallback"), limit, false);
  }

  return picked;
}

function isFreshStrongCandidateForRefresh(
  sourceCard: RecommendationCard,
  candidateCard: RecommendationCard,
  refreshUsedAt: string | null | undefined
) {
  if (!refreshUsedAt) return false;

  const refreshMs = Date.parse(refreshUsedAt);
  const candidateCreatedMs = Date.parse(candidateCard.created_at);
  if (!Number.isFinite(refreshMs) || !Number.isFinite(candidateCreatedMs) || candidateCreatedMs <= refreshMs) {
    return false;
  }

  const distance = getRegionDistanceMeta(sourceCard.region, candidateCard.region).distanceKm;
  const closeRegion = distance != null && distance <= CLOSE_REGION_MAX_KM;
  const ageMatched = isCandidateInSourceAgeRange(sourceCard, candidateCard);
  const nearAge = getAgeGap(sourceCard.age, candidateCard.age) <= NEAR_AGE_GAP;

  return closeRegion || ageMatched || nearAge;
}

function getRefreshExcludeIds(
  sourceCard: RecommendationCard,
  defaultRecommendations: RecommendationCard[],
  refreshUsedAt: string | null | undefined
) {
  const excludeIds = new Set(defaultRecommendations.map((candidate) => candidate.id));

  for (const candidate of defaultRecommendations) {
    if (isRecentNearbyCandidate(sourceCard, candidate) || isFreshStrongCandidateForRefresh(sourceCard, candidate, refreshUsedAt)) {
      excludeIds.delete(candidate.id);
    }
  }

  return excludeIds;
}

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

function stripInternalPhone(card: RecommendationCard) {
  return Object.fromEntries(
    Object.entries(card).filter(
      ([key]) => key !== "phone" && key !== "priority_boost_expires_at" && key !== "plus_expires_at"
    )
  ) as Omit<RecommendationCard, "phone" | "priority_boost_expires_at" | "plus_expires_at">;
}

async function fetchAllActiveCards(admin: ReturnType<typeof createAdminClient>) {
  const rows: CardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("dating_1on1_cards")
      .select(
        "id,user_id,sex,name,birth_year,height_cm,job,region,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,created_at,recommendation_refresh_used_at,priority_boost_expires_at,photo_paths,phone"
      )
      .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
      .order("created_at", { ascending: false })
      .range(from, from + CARD_BATCH_SIZE - 1);

    if (error) {
      const message = String(error.message ?? "");
      if (message.includes("priority_boost_expires_at")) {
        const legacyRes = await admin
          .from("dating_1on1_cards")
          .select(
            "id,user_id,sex,name,birth_year,height_cm,job,region,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,created_at,recommendation_refresh_used_at,photo_paths,phone"
          )
          .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
          .order("created_at", { ascending: false })
          .range(from, from + CARD_BATCH_SIZE - 1);
        if (legacyRes.error) throw legacyRes.error;
        const legacyBatch = (legacyRes.data ?? []).map((row) => ({ ...row, priority_boost_expires_at: null })) as CardRow[];
        rows.push(...legacyBatch);
        if (legacyBatch.length < CARD_BATCH_SIZE) break;
        from += CARD_BATCH_SIZE;
        continue;
      }
      throw error;
    }

    const batch = (data ?? []) as CardRow[];
    rows.push(...batch);
    if (batch.length < CARD_BATCH_SIZE) break;
    from += CARD_BATCH_SIZE;
  }

  return rows;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let activeCards: CardRow[];
  try {
    activeCards = await fetchAllActiveCards(admin);
  } catch (error) {
    console.error("[GET /api/dating/1on1/recommendations/my] cards failed", error);
    return NextResponse.json({ error: "Failed to load active cards." }, { status: 500 });
  }

  const plusByUserId = await getActiveOneOnOnePlusByUserIds(
    admin,
    activeCards.map((row) => row.user_id)
  );
  const normalizedCards = activeCards.map((row) => ({
    ...toDatingOneOnOneCardDetail(row),
    phone: row.phone ?? null,
    priority_boost_expires_at: row.priority_boost_expires_at ?? null,
    plus_expires_at: plusByUserId.get(row.user_id)?.expires_at ?? null,
  }));
  const myCards = normalizedCards.filter((card) => card.user_id === user.id);
  const mySourceCards = myCards.filter(
    (card) => card.status === "submitted" || card.status === "reviewing" || card.status === "approved"
  );

  if (mySourceCards.length === 0) {
    return NextResponse.json({ items: [] });
  }

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

  const allCandidateUserIds = normalizedCards.map((card) => card.user_id);
  const [existingPairRes, phoneBlockMap, adminUserBlockPairSet, contactBlockMap, blockedUserIds] = await Promise.all([
    admin
      .from("dating_1on1_match_proposals")
      .select("source_card_id,candidate_card_id")
      .in("source_card_id", sourceCardIds),
    getOneOnOnePhoneBlockMapForUsers(admin, allCandidateUserIds),
    getOneOnOneAdminUserBlockPairSetForUsers(admin, allCandidateUserIds),
    getDatingContactBlockMapForUsers(admin, allCandidateUserIds),
    getDatingBlockedUserIds(admin, user.id),
  ]);

  if (existingPairRes.error) {
    console.error("[GET /api/dating/1on1/recommendations/my] pair lookup failed", existingPairRes.error);
    return NextResponse.json({ error: "Failed to load existing match pairs." }, { status: 500 });
  }

  const existingPairMap = new Map<string, Set<string>>();
  for (const row of existingPairRes.data ?? []) {
    const bucket = existingPairMap.get(row.source_card_id) ?? new Set<string>();
    bucket.add(row.candidate_card_id);
    existingPairMap.set(row.source_card_id, bucket);
  }

  const items = mySourceCards.map((sourceCard) => {
    const excludedIds = existingPairMap.get(sourceCard.id) ?? new Set<string>();
    const candidates = normalizedCards.filter((candidateCard) => {
      if (candidateCard.id === sourceCard.id) return false;
      if (candidateCard.user_id === sourceCard.user_id) return false;
      if (candidateCard.sex === sourceCard.sex) return false;
      if (blockedUserIds.has(candidateCard.user_id)) return false;
      if (excludedIds.has(candidateCard.id)) return false;
      if (
        isOneOnOnePhoneBlockedPair({
          sourceUserId: sourceCard.user_id,
          sourcePhone: sourceCard.phone,
          candidateUserId: candidateCard.user_id,
          candidatePhone: candidateCard.phone,
          blockMap: phoneBlockMap,
        })
      ) {
        return false;
      }
      if (
        isDatingContactPhoneBlockedPair({
          sourceUserId: sourceCard.user_id,
          sourcePhone: sourceCard.phone,
          candidateUserId: candidateCard.user_id,
          candidatePhone: candidateCard.phone,
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

    const defaultSortedCandidates = sortCandidatesForSource(sourceCard, candidates, "default");
    const defaultRecommendations = takeBalancedRecommendations(
      sourceCard,
      defaultSortedCandidates,
      RECOMMENDATION_LIMIT,
      null,
      null
    );
    const refreshExcludeIds = getRefreshExcludeIds(
      sourceCard,
      defaultRecommendations,
      sourceCard.recommendation_refresh_used_at
    );
    const recommendations = sourceCard.recommendation_refresh_used_at
      ? takeBalancedRecommendations(
          sourceCard,
          sortRefreshCandidatesForSource(
            sourceCard,
            candidates,
            sourceCard.recommendation_refresh_used_at,
            refreshExcludeIds
          ),
          RECOMMENDATION_LIMIT,
          refreshExcludeIds,
          `${sourceCard.id}:${sourceCard.recommendation_refresh_used_at}:refresh`
        )
      : defaultRecommendations;
    const sourcePlus = plusByUserId.get(sourceCard.user_id) ?? null;
    const refreshLimit = sourcePlus ? ONE_ON_ONE_PLUS_REFRESH_LIMIT : ONE_ON_ONE_FREE_REFRESH_LIMIT;
    const refreshAvailability = getRefreshAvailability(
      refreshEventsByCardId.get(sourceCard.id) ?? [],
      sourceCard.recommendation_refresh_used_at,
      refreshLimit
    );
    const recommendationIds = new Set(recommendations.map((candidate) => candidate.id));
    const adminRecommendations = takeRecommendations(
      sortCandidatesForSource(
        sourceCard,
        candidates.filter((candidate) => isCandidateInSourceAgeRange(sourceCard, candidate)),
        `${adminRecommendationDate}:admin-extra`
      ),
      ONE_ON_ONE_FREE_EXTRA_CANDIDATES,
      recommendationIds,
      `${sourceCard.id}:${adminRecommendationDate}:admin-extra`
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
      recommendations: recommendations.map(stripInternalPhone),
      admin_recommendation_date: adminRecommendationDate,
      admin_recommendations: adminRecommendations.map(stripInternalPhone),
      admin_recommendation_limit: ONE_ON_ONE_FREE_EXTRA_CANDIDATES,
    };
  });

  return NextResponse.json({ items });
}

import {
  DATING_ONE_ON_ONE_ACTIVE_STATUSES,
  DATING_ONE_ON_ONE_MATCH_CANDIDATE_SINGLE_TRACK_STATES,
  toDatingOneOnOneCardDetail,
} from "@/lib/dating-1on1";
import { getRegionDistanceMeta } from "@/lib/region-distance";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

const RECOMMENDATION_LIMIT = 10;
const CARD_BATCH_SIZE = 1000;
const RECOMMENDATION_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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
  photo_paths: unknown;
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

function sortCandidatesForSource(
  sourceCard: ReturnType<typeof toDatingOneOnOneCardDetail>,
  candidates: ReturnType<typeof toDatingOneOnOneCardDetail>[],
  seedSuffix: string
) {
  const sourceAgeRange = getAgeRange(sourceCard);
  const inAgeRange = (candidateCard: (typeof candidates)[number]) => {
    if (
      sourceAgeRange.minAge == null ||
      sourceAgeRange.maxAge == null ||
      candidateCard.age == null ||
      !Number.isFinite(candidateCard.age)
    ) {
      return false;
    }
    return candidateCard.age >= sourceAgeRange.minAge && candidateCard.age <= sourceAgeRange.maxAge;
  };

  return [...candidates].sort((a, b) => {
    const aDistanceRank = getDistanceRank(sourceCard.region, a.region);
    const bDistanceRank = getDistanceRank(sourceCard.region, b.region);
    if (aDistanceRank.sameRegionRank !== bDistanceRank.sameRegionRank) {
      return aDistanceRank.sameRegionRank - bDistanceRank.sameRegionRank;
    }
    if (aDistanceRank.sameProvinceRank !== bDistanceRank.sameProvinceRank) {
      return aDistanceRank.sameProvinceRank - bDistanceRank.sameProvinceRank;
    }

    const aInAgeRange = inAgeRange(a);
    const bInAgeRange = inAgeRange(b);
    if (aInAgeRange !== bInAgeRange) {
      return aInAgeRange ? -1 : 1;
    }

    const aAgeGap = getAgeGap(sourceCard.age, a.age);
    const bAgeGap = getAgeGap(sourceCard.age, b.age);
    if (aAgeGap !== bAgeGap) {
      return aAgeGap - bAgeGap;
    }

    if (aDistanceRank.distanceBandRank !== bDistanceRank.distanceBandRank) {
      return aDistanceRank.distanceBandRank - bDistanceRank.distanceBandRank;
    }
    if (aDistanceRank.distanceRank !== bDistanceRank.distanceRank) {
      return aDistanceRank.distanceRank - bDistanceRank.distanceRank;
    }

    const aHash = hashSeed(`${sourceCard.id}:${seedSuffix}:${a.id}`);
    const bHash = hashSeed(`${sourceCard.id}:${seedSuffix}:${b.id}`);
    if (aHash !== bHash) return aHash - bHash;
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
  sortedCandidates: ReturnType<typeof toDatingOneOnOneCardDetail>[],
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

  const picked: ReturnType<typeof toDatingOneOnOneCardDetail>[] = [];
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

function getRefreshAvailability(refreshUsedAt?: string | null) {
  if (!refreshUsedAt) {
    return {
      refreshUsed: false,
      canRefreshNow: true,
      nextRefreshAt: null as string | null,
    };
  }

  const refreshMs = Date.parse(refreshUsedAt);
  if (!Number.isFinite(refreshMs)) {
    return {
      refreshUsed: false,
      canRefreshNow: true,
      nextRefreshAt: null as string | null,
    };
  }

  const nextRefreshMs = refreshMs + RECOMMENDATION_REFRESH_COOLDOWN_MS;
  return {
    refreshUsed: true,
    canRefreshNow: nextRefreshMs <= Date.now(),
    nextRefreshAt: new Date(nextRefreshMs).toISOString(),
  };
}

async function fetchAllActiveCards(admin: ReturnType<typeof createAdminClient>) {
  const rows: CardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("dating_1on1_cards")
      .select(
        "id,user_id,sex,name,birth_year,height_cm,job,region,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,created_at,recommendation_refresh_used_at,photo_paths"
      )
      .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
      .order("created_at", { ascending: false })
      .range(from, from + CARD_BATCH_SIZE - 1);

    if (error) throw error;

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

  const normalizedCards = activeCards.map((row) => toDatingOneOnOneCardDetail(row));
  const myCards = normalizedCards.filter((card) => card.user_id === user.id);
  const mySourceCards = myCards.filter(
    (card) => card.status === "submitted" || card.status === "reviewing" || card.status === "approved"
  );

  if (mySourceCards.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const sourceCardIds = mySourceCards.map((card) => card.id);

  const [existingPairRes, blockedCandidateRes] = await Promise.all([
    admin
      .from("dating_1on1_match_proposals")
      .select("source_card_id,candidate_card_id")
      .in("source_card_id", sourceCardIds),
    admin
      .from("dating_1on1_match_proposals")
      .select("candidate_card_id")
      .in("state", [...DATING_ONE_ON_ONE_MATCH_CANDIDATE_SINGLE_TRACK_STATES]),
  ]);

  if (existingPairRes.error) {
    console.error("[GET /api/dating/1on1/recommendations/my] pair lookup failed", existingPairRes.error);
    return NextResponse.json({ error: "Failed to load existing match pairs." }, { status: 500 });
  }
  if (blockedCandidateRes.error) {
    console.error("[GET /api/dating/1on1/recommendations/my] blocked candidates failed", blockedCandidateRes.error);
    return NextResponse.json({ error: "Failed to load blocked candidates." }, { status: 500 });
  }

  const existingPairMap = new Map<string, Set<string>>();
  for (const row of existingPairRes.data ?? []) {
    const bucket = existingPairMap.get(row.source_card_id) ?? new Set<string>();
    bucket.add(row.candidate_card_id);
    existingPairMap.set(row.source_card_id, bucket);
  }
  const blockedCandidateIds = new Set((blockedCandidateRes.data ?? []).map((row) => row.candidate_card_id));

  const items = mySourceCards.map((sourceCard) => {
    const excludedIds = existingPairMap.get(sourceCard.id) ?? new Set<string>();
    const candidates = normalizedCards.filter((candidateCard) => {
      if (candidateCard.id === sourceCard.id) return false;
      if (candidateCard.user_id === sourceCard.user_id) return false;
      if (candidateCard.sex === sourceCard.sex) return false;
      if (blockedCandidateIds.has(candidateCard.id)) return false;
      if (excludedIds.has(candidateCard.id)) return false;
      return (
        candidateCard.status === "submitted" ||
        candidateCard.status === "reviewing" ||
        candidateCard.status === "approved"
      );
    });

    const defaultSortedCandidates = sortCandidatesForSource(sourceCard, candidates, "default");
    const defaultRecommendations = takeRecommendations(defaultSortedCandidates, RECOMMENDATION_LIMIT);
    const recommendations = sourceCard.recommendation_refresh_used_at
      ? takeRecommendations(
          sortCandidatesForSource(sourceCard, candidates, sourceCard.recommendation_refresh_used_at),
          RECOMMENDATION_LIMIT,
          new Set(defaultRecommendations.map((candidate) => candidate.id)),
          `${sourceCard.id}:${sourceCard.recommendation_refresh_used_at}:refresh`
        )
      : defaultRecommendations;
    const refreshAvailability = getRefreshAvailability(sourceCard.recommendation_refresh_used_at);

    return {
      source_card_id: sourceCard.id,
      source_card_status: sourceCard.status,
      refresh_used: refreshAvailability.refreshUsed,
      refresh_used_at: sourceCard.recommendation_refresh_used_at ?? null,
      next_refresh_at: refreshAvailability.nextRefreshAt,
      can_refresh: refreshAvailability.canRefreshNow && candidates.length > RECOMMENDATION_LIMIT,
      recommendations,
    };
  });

  return NextResponse.json({ items });
}

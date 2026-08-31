import { getRegionDistanceMeta } from "@/lib/region-distance";

const DAY_MS = 24 * 60 * 60 * 1000;
const AGE_MATCH_MIN_QUOTA = 6;
const RECENT_MIN_QUOTA = 4;

export type RecommendationCandidate = {
  id: string;
  sex: "male" | "female";
  age: number | null;
  region: string;
  created_at: string;
  priority_boost_expires_at?: string | null;
  plus_expires_at?: string | null;
  last_active_at?: string | null;
};

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getAgeGap(a: number | null, b: number | null) {
  return a != null && b != null && Number.isFinite(a) && Number.isFinite(b)
    ? Math.abs(a - b)
    : Number.POSITIVE_INFINITY;
}

export function isCandidateInSourceAgeRange(source: RecommendationCandidate, candidate: RecommendationCandidate) {
  if (source.age == null || candidate.age == null || !Number.isFinite(source.age) || !Number.isFinite(candidate.age)) {
    return false;
  }
  const minAge = Math.max(19, source.age - (source.sex === "male" ? 4 : 1));
  const maxAge = source.age + (source.sex === "male" ? 1 : 4);
  return candidate.age >= minAge && candidate.age <= maxAge;
}

function isRecent(value: string | null | undefined, nowMs: number) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) && timestamp <= nowMs && timestamp >= nowMs - 7 * DAY_MS;
}

function isCloseRegion(source: RecommendationCandidate, candidate: RecommendationCandidate) {
  const distance = getRegionDistanceMeta(source.region, candidate.region).distanceKm;
  return distance != null && distance <= 90;
}

function isRecentRelevant(source: RecommendationCandidate, candidate: RecommendationCandidate, nowMs: number) {
  return (isRecent(candidate.last_active_at, nowMs) || isRecent(candidate.created_at, nowMs)) &&
    (isCloseRegion(source, candidate) || isCandidateInSourceAgeRange(source, candidate));
}

export function sortCandidatesForSource<T extends RecommendationCandidate>(
  source: RecommendationCandidate,
  candidates: T[],
  seed: string,
  nowMs = Date.now()
): T[] {
  // Compute geography once per candidate, not on every comparison. Shuffle only
  // equivalent ranks, so daily variety cannot override locality or Plus priority.
  const ranked = candidates.map((candidate) => {
    const distance = getRegionDistanceMeta(source.region, candidate.region);
    const km = distance.distanceKm;
    const boost = [candidate.priority_boost_expires_at, candidate.plus_expires_at]
      .some((value) => Date.parse(value ?? "") > nowMs);
    const activityRank = isRecent(candidate.last_active_at, nowMs) ? 0 : isRecent(candidate.created_at, nowMs) ? 1 : 2;
    return {
      candidate,
      ranks: [
        distance.sameRegion ? 0 : 1,
        distance.sameProvince ? 0 : 1,
        km == null ? 4 : km <= 15 ? 0 : km <= 40 ? 1 : km <= 90 ? 2 : 3,
        isCandidateInSourceAgeRange(source, candidate) ? 0 : 1,
        activityRank,
        boost ? 0 : 1,
        km ?? Number.POSITIVE_INFINITY,
        getAgeGap(source.age, candidate.age),
        hashSeed(`${source.id}:${seed}:${candidate.id}`),
      ],
    };
  });
  ranked.sort((a, b) => {
    for (let index = 0; index < a.ranks.length; index += 1) {
      if (a.ranks[index] !== b.ranks[index]) return a.ranks[index] - b.ranks[index];
    }
    return a.candidate.id.localeCompare(b.candidate.id);
  });
  return ranked.map(({ candidate }) => candidate);
}

export function sortRefreshCandidatesForSource<T extends RecommendationCandidate>(
  source: RecommendationCandidate,
  candidates: T[],
  seed: string,
  excludeIds: Set<string>,
  nowMs = Date.now()
) {
  const sorted = sortCandidatesForSource(source, candidates, `refresh:${seed}`, nowMs);
  return [...sorted.filter((card) => !excludeIds.has(card.id)), ...sorted.filter((card) => excludeIds.has(card.id))];
}

export function takeRecommendations<T extends RecommendationCandidate>(
  sortedCandidates: T[],
  limit: number,
  excludeIds: Set<string> = new Set()
): T[] {
  const picked: T[] = [];
  const seen = new Set(excludeIds);
  for (const candidate of sortedCandidates) {
    if (picked.length >= limit) break;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    picked.push(candidate);
  }
  // Extra candidates must never refill from the main list or handled candidates.
  return picked;
}

export function takeBalancedRecommendations<T extends RecommendationCandidate>(
  source: RecommendationCandidate,
  sortedCandidates: T[],
  limit: number,
  preferredExcludeIds: Set<string> = new Set(),
  nowMs = Date.now()
): T[] {
  const picked: T[] = [];
  const seen = new Set<string>();
  const addMatching = (pool: T[], predicate: (card: T) => boolean, quota: number) => {
    let matchingCount = picked.filter(predicate).length;
    for (const candidate of pool) {
      if (picked.length >= limit || matchingCount >= quota) break;
      if (seen.has(candidate.id) || !predicate(candidate)) continue;
      seen.add(candidate.id);
      picked.push(candidate);
      matchingCount += 1;
    }
  };
  const fill = (pool: T[]) => {
    // Reserve the age quota first. Count actual matching cards, not total picks.
    addMatching(pool, (card) => isCandidateInSourceAgeRange(source, card), Math.min(limit, AGE_MATCH_MIN_QUOTA));
    addMatching(pool, (card) => isRecentRelevant(source, card, nowMs), Math.min(limit, RECENT_MIN_QUOTA));
    addMatching(pool, (card) => getAgeGap(source.age, card.age) <= 2, Math.min(limit, 7));
    addMatching(pool, (card) => isCloseRegion(source, card), Math.min(limit, 8));
    addMatching(pool, () => true, limit);
  };
  fill(sortedCandidates.filter((card) => !preferredExcludeIds.has(card.id)));
  // Only soft exclusions may refill a short main list; safety exclusions are
  // removed by the API before this function. A small pool is not discarded.
  if (picked.length < limit) fill(sortedCandidates);
  const order = new Map(sortedCandidates.map((card, index) => [card.id, index]));
  return picked.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

export function getRefreshExcludeIds<T extends RecommendationCandidate>(
  source: RecommendationCandidate,
  defaults: T[],
  refreshUsedAt: string | null | undefined
) {
  const refreshMs = Date.parse(refreshUsedAt ?? "");
  return new Set(defaults.filter((candidate) => {
    const createdMs = Date.parse(candidate.created_at);
    const genuinelyNew = Number.isFinite(refreshMs) && Number.isFinite(createdMs) && createdMs > refreshMs;
    const relevant = isCloseRegion(source, candidate) || isCandidateInSourceAgeRange(source, candidate) ||
      getAgeGap(source.age, candidate.age) <= 2;
    return !(genuinelyNew && relevant);
  }).map((candidate) => candidate.id));
}

export function getActiveRecommendationRefresh(value: string | null | undefined, nowMs = Date.now()) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) && timestamp <= nowMs && nowMs - timestamp < DAY_MS ? value! : null;
}

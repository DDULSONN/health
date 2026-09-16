import { getRegionDistanceMeta } from "@/lib/region-distance";
import { getKstDateString } from "@/lib/weekly";

const DAY_MS = 24 * 60 * 60 * 1000;
const AGE_MATCH_MIN_QUOTA = 6;
const RECENT_MIN_QUOTA = 4;
export const RECOMMENDATION_REFRESH_HISTORY_MS = 7 * DAY_MS;
// A persisted, once-per-account correction, separate from charged refresh events.
// Replay it like a normal refresh; reading candidates never grants another one.
export function getRecommendationRecoverySeed(refreshedAt: string | null | undefined, nowMs = Date.now()) {
  const timestamp = Date.parse(refreshedAt ?? "");
  return Number.isFinite(timestamp) && timestamp <= nowMs && timestamp > nowMs - RECOMMENDATION_REFRESH_HISTORY_MS
    ? refreshedAt! : null;
}

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

// Repetition is only a preference within a compatibility tier, not a reason
// to send a member hundreds of kilometres away from compatible local people.
export function getRecommendationRelevanceTier(source: RecommendationCandidate, candidate: RecommendationCandidate) {
  const km = getRegionDistanceMeta(source.region, candidate.region).distanceKm;
  return relevanceTierAtDistance(source, candidate, km);
}

function relevanceTierAtDistance(source: RecommendationCandidate, candidate: RecommendationCandidate, km: number | null) {
  const ageMatch = isCandidateInSourceAgeRange(source, candidate);
  if (km != null && km <= 90) {
    if (ageMatch) return 0;
    if (getAgeGap(source.age, candidate.age) <= 6) return 1;
    return 4;
  }
  if (km != null && km <= 180) return ageMatch ? 2 : 5;
  if (ageMatch) return km == null ? 6 : 3;
  return 7;
}

function createRecommendationMetaReader(source: RecommendationCandidate) {
  type Meta = { km: number | null; close: boolean; ageMatch: boolean; ageGap: number; tier: number };
  // Request-local only: no personal data cache shared across users or requests.
  const cache = new Map<RecommendationCandidate, Meta>();
  return (candidate: RecommendationCandidate) => {
    let meta = cache.get(candidate);
    if (!meta) {
      const km = getRegionDistanceMeta(source.region, candidate.region).distanceKm;
      meta = { km, close: km != null && km <= 90,
        ageMatch: isCandidateInSourceAgeRange(source, candidate),
        ageGap: getAgeGap(source.age, candidate.age),
        tier: relevanceTierAtDistance(source, candidate, km) };
      cache.set(candidate, meta);
    }
    return meta;
  };
}
type RecommendationMetaReader = ReturnType<typeof createRecommendationMetaReader>;

function groupByRelevance<T extends RecommendationCandidate>(candidates: T[], readMeta: RecommendationMetaReader) {
  const groups = new Map<number, T[]>();
  for (const candidate of candidates) {
    const tier = readMeta(candidate).tier;
    const group = groups.get(tier) ?? [];
    group.push(candidate);
    groups.set(tier, group);
  }
  return [...groups].sort(([a], [b]) => a - b).map(([, group]) => group);
}

export function sortCandidatesForSource<T extends RecommendationCandidate>(
  source: RecommendationCandidate,
  candidates: T[],
  seed: string,
  nowMs = Date.now(),
  readMeta = createRecommendationMetaReader(source)
): T[] {
  // Shuffle before exact kilometre/age tie-breaks within comparable tiers.
  // Otherwise different seeds barely change geographically varied real pools.
  const ranked = candidates.map((candidate) => {
    const meta = readMeta(candidate);
    const km = meta.km;
    const boost = [candidate.priority_boost_expires_at, candidate.plus_expires_at]
      .some((value) => Date.parse(value ?? "") > nowMs);
    const activityRank = isRecent(candidate.last_active_at, nowMs) ? 0 : isRecent(candidate.created_at, nowMs) ? 1 : 2;
    return {
      candidate,
      ranks: [
        meta.tier,
        km == null ? 4 : km <= 40 ? 0 : km <= 90 ? 1 : km <= 180 ? 2 : 3,
        meta.ageMatch ? 0 : 1,
        activityRank,
        boost ? 0 : 1,
        hashSeed(`${source.id}:${seed}:${candidate.id}`),
        km ?? Number.POSITIVE_INFINITY,
        meta.ageGap,
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
  nowMs = Date.now(),
  readMeta = createRecommendationMetaReader(source)
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
    // Give newly registered, compatible local profiles a small entrance slot,
    // including for members who have not used manual refresh yet.
    addMatching(pool, (card) => isRecent(card.created_at, nowMs) &&
      readMeta(card).ageMatch && readMeta(card).close, Math.min(limit, 2));
    // Preserve the age quota as well. Count matching cards, not total picks.
    addMatching(pool, (card) => readMeta(card).ageMatch, Math.min(limit, AGE_MATCH_MIN_QUOTA));
    addMatching(pool, (card) => (isRecent(card.last_active_at, nowMs) || isRecent(card.created_at, nowMs)) &&
      (readMeta(card).close || readMeta(card).ageMatch), Math.min(limit, RECENT_MIN_QUOTA));
    addMatching(pool, (card) => readMeta(card).ageGap <= 2, Math.min(limit, 7));
    addMatching(pool, (card) => readMeta(card).close, Math.min(limit, 8));
    addMatching(pool, () => true, limit);
  };
  for (const group of groupByRelevance(sortedCandidates, readMeta)) {
    fill(group.filter((card) => !preferredExcludeIds.has(card.id)));
    // Widen only after exhausting the more compatible pool. Safety exclusions
    // have already been removed by the API and can never be reintroduced here.
    if (picked.length < limit) fill(group);
    if (picked.length >= limit) break;
  }
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

function existedAt(candidate: RecommendationCandidate, timestamp: number) {
  const created = Date.parse(candidate.created_at);
  return !Number.isFinite(created) || created <= timestamp;
}

function includeNewRelevantCandidates<T extends RecommendationCandidate>(
  source: RecommendationCandidate, candidates: T[], previous: T[], since: number, at: number, limit: number,
  handledIds: Set<string>, readMeta: RecommendationMetaReader
) {
  const newcomers = takeRecommendations(sortCandidatesForSource(source, candidates.filter((card) => {
    const created = Date.parse(card.created_at);
    return created > since && created <= at && readMeta(card).tier === 0 && !handledIds.has(card.id);
  }), `new:${since}`, at, readMeta), Math.min(2, limit));
  const newcomerIds = new Set(newcomers.map((card) => card.id));
  const merged = [...newcomers, ...previous.filter((card) => !newcomerIds.has(card.id))].slice(0, limit);
  // The historical pool may have been smaller. Reserve two fresh slots, but
  // never leave the rest empty when eligible people registered afterwards.
  if (merged.length < limit) {
    const used = new Set(merged.map((card) => card.id));
    merged.push(...takeBalancedRecommendations(source,
      sortCandidatesForSource(source, candidates.filter((card) => !used.has(card.id)), `new-fill:${since}`, at, readMeta),
      limit - merged.length, handledIds, at, readMeta));
  }
  return merged;
}

// Replay a short, bounded history using today's eligible pool. This is a ranking
// hint, never a safety exclusion or an exact historical impression record.
export function replayRecommendationRefreshes<T extends RecommendationCandidate>(
  source: RecommendationCandidate,
  candidates: T[],
  defaults: T[],
  refreshTimes: string[],
  handledIds: Set<string>,
  limit: number,
  nowMs = Date.now()
) {
  const seeds = [...new Set(refreshTimes)].filter((value) => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) && ms <= nowMs && ms > nowMs - RECOMMENDATION_REFRESH_HISTORY_MS;
  }).sort((a, b) => Date.parse(a) - Date.parse(b)).slice(-32);
  const readMeta = createRecommendationMetaReader(source);
  let recommendations = seeds.length ? defaults.filter((card) => existedAt(card, Date.parse(seeds[0]))) : defaults;
  const shownIds = new Set(recommendations.map((card) => card.id));
  const activeShownIds = new Set(shownIds);
  const excluded = new Set([...handledIds, ...shownIds]);
  let previousSeedMs: number | null = null;
  for (const seed of seeds) {
    const seedMs = Date.parse(seed);
    const historicalPool = candidates.filter((card) => existedAt(card, seedMs));
    if (previousSeedMs != null && seedMs - previousSeedMs >= DAY_MS) {
      // Once refresh expires, GET displays that day's defaults again. Rotate
      // away from that visible page, not the stale last refreshed page: in a
      // 20-person pool the latter would return exactly the same ten people.
      recommendations = takeBalancedRecommendations(source,
        sortCandidatesForSource(source, historicalPool,
          `${getKstDateString(new Date(seedMs))}:default`, nowMs, readMeta),
        limit, handledIds, nowMs, readMeta);
    } else if (previousSeedMs != null) {
      recommendations = includeNewRelevantCandidates(source, historicalPool, recommendations, previousSeedMs, seedMs, limit, handledIds, readMeta);
    }
    for (const card of recommendations) { excluded.add(card.id); shownIds.add(card.id); }
    const previousIds = new Set(recommendations.map((card) => card.id));
    const sorted = sortCandidatesForSource(source, historicalPool, `refresh:${seed}`, nowMs, readMeta);
    recommendations = [];
    const pickedIds = new Set<string>();
    for (const group of groupByRelevance(sorted, readMeta)) {
      // Unseen, older pages, previous page — inside the same compatibility tier.
      for (const pool of [
        group.filter((card) => !excluded.has(card.id) && !previousIds.has(card.id)),
        group.filter((card) => !previousIds.has(card.id)),
        group,
      ]) {
        const picked = takeBalancedRecommendations(source, pool.filter((card) => !pickedIds.has(card.id)),
          limit - recommendations.length, new Set(), nowMs, readMeta);
        recommendations.push(...picked);
        for (const card of picked) pickedIds.add(card.id);
        if (recommendations.length >= limit) break;
      }
      if (recommendations.length >= limit) break;
    }
    for (const card of recommendations) { excluded.add(card.id); shownIds.add(card.id); }
    if (getActiveRecommendationRefresh(seed, nowMs)) {
      for (const card of recommendations) activeShownIds.add(card.id);
    }
    previousSeedMs = seedMs;
  }
  if (previousSeedMs != null) {
    recommendations = includeNewRelevantCandidates(source, candidates, recommendations, previousSeedMs, nowMs, limit, handledIds, readMeta);
    for (const card of recommendations) { shownIds.add(card.id); activeShownIds.add(card.id); }
  }
  return { recommendations, shownIds, activeShownIds, seeds };
}

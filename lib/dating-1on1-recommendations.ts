import { getRegionDistanceMeta } from "@/lib/region-distance";
import { getKstDateString } from "@/lib/weekly";

const DAY_MS = 24 * 60 * 60 * 1000;
const AGE_MATCH_MIN_QUOTA = 6;
const RECENT_MIN_QUOTA = 6;
// Approximate straight-line distances between registered regions, not travel
// distances. Keep variety within a band; expand one band at a time when scarce.
const RECOMMENDATION_DISTANCE_BANDS_KM = [40, 90, 180, 250, 330, 450, Infinity];
function distanceBand(km: number | null) {
  return km == null ? RECOMMENDATION_DISTANCE_BANDS_KM.length
    : RECOMMENDATION_DISTANCE_BANDS_KM.findIndex(upper => km <= upper);
}
export const RECOMMENDATION_REFRESH_HISTORY_MS = 7 * DAY_MS;
export function isWiderRecommendationRegion(source: { region: string }, candidate: { region: string }) {
  const km = getRegionDistanceMeta(source.region, candidate.region).distanceKm;
  return km != null && km > 180;
}
// Presentation only: describe the final visible main/extra list, never favorites.
// Unknown regions are not evidence of geographic expansion.
export function hasWiderRecommendationRegion(source: { region: string }, candidates: readonly { region: string }[]) {
  return candidates.some(candidate => isWiderRecommendationRegion(source, candidate));
}
export const RECOMMENDATION_REVISIT_COOLDOWN_MS = 7 * DAY_MS;
export type ObservedCandidate = { id: string; at: number };
// Use history BEFORE the page's generation, never acknowledgements of that page.
export function observedCandidateIdsAt(observations: ObservedCandidate[], at: number) {
  return new Set(observations.filter(row => Number.isFinite(row.at) && row.at < at && row.at >= at - 30 * DAY_MS).map(row => row.id));
}
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
  last_handled_at?: string | null;
};

// A ranking hint only. Never relax a block, rejection, age or active-pair filter.
export function isRecentlyHandledCandidate(candidate: RecommendationCandidate, nowMs = Date.now()) {
  const at = Date.parse(candidate.last_handled_at ?? "");
  return Number.isFinite(at) && at <= nowMs && nowMs - at < RECOMMENDATION_REVISIT_COOLDOWN_MS;
}

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

// Default ranking keeps compatibility first. Refresh may widen known regions
// after nearby unseen candidates run out, but must retain age compatibility.
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

function groupBroaderCandidates<T extends RecommendationCandidate>(candidates: T[], readMeta: RecommendationMetaReader) {
  const groups = new Map<string, { ranks: number[]; cards: T[] }>();
  for (const card of candidates) {
    const { km, ageMatch, ageGap } = readMeta(card);
    // Broaden distance while preserving the preferred age range first. Only
    // after that pool runs out relax age, from smallest gap to largest, and
    // keep nearby regions first within each age group. Unknown regions last.
    const ranks = [km == null ? 1 : 0, ageMatch ? 0 : ageGap + 1, distanceBand(km)];
    const key = ranks.join(':');
    const group: { ranks: number[]; cards: T[] } = groups.get(key) ?? { ranks, cards: [] };
    group.cards.push(card);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    for (let i = 0; i < a.ranks.length; i++) {
      if (a.ranks[i] !== b.ranks[i]) return a.ranks[i] - b.ranks[i];
    }
    return 0;
  }).map(group => group.cards);
}

function groupByRelevance<T extends RecommendationCandidate>(
  candidates: T[], readMeta: RecommendationMetaReader, splitWiderDistanceBands = true
) {
  const groups = new Map<number, T[]>();
  for (const candidate of candidates) {
    const { tier, km } = readMeta(candidate);
    // Quotas must operate inside the widened distance band too: sorting alone
    // lets activity/age quotas pull faraway people past a still-available band.
    // Existing nearby tiers and their variety behavior remain unchanged.
    const key = tier * (RECOMMENDATION_DISTANCE_BANDS_KM.length + 1) +
      (splitWiderDistanceBands && tier === 3 ? distanceBand(km) : 0);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
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
        isRecentlyHandledCandidate(candidate, nowMs) ? 1 : 0,
        distanceBand(km),
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
    // Give newly registered, compatible profiles a small entrance slot inside
    // the current relevance/distance group, never jumping over a nearer group.
    addMatching(pool, (card) => isRecent(card.created_at, nowMs) &&
      readMeta(card).ageMatch && readMeta(card).km != null, Math.min(limit, 2));
    // Within the same compatibility/distance group, prefer people who have
    // actually been active. Filling the age quota first let six inactive cards
    // occupy a ten-card page even when enough equally suitable active ones existed.
    addMatching(pool, (card) => (isRecent(card.last_active_at, nowMs) || isRecent(card.created_at, nowMs)) &&
      (readMeta(card).close || readMeta(card).ageMatch), Math.min(limit, RECENT_MIN_QUOTA));
    addMatching(pool, (card) => readMeta(card).ageMatch, Math.min(limit, AGE_MATCH_MIN_QUOTA));
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

export function takeObservedRecommendations<T extends RecommendationCandidate>(
  source: RecommendationCandidate, sorted: T[], limit: number, observed: Set<string>,
  previous: Set<string>, handled: Set<string>, nowMs: number, allowWiderUnseen = false,
  meta = createRecommendationMetaReader(source), mixNearbyRevisits = false
) {
  if (limit <= 0 || !sorted.length) return [];
  const bestTier = sorted.reduce((best, card) => Math.min(best, meta(card).tier), Infinity);
  // Before repeating locals, broaden only to the existing safe nearby tiers:
  // <=90 km / age gap <=6, or <=180 km / the normal age range. Do not fill with
  // arbitrary distant/unknown-age people just to make the refresh look different.
  // A sparse pool may start at tier 4 or 7. During refresh it must still pass
  // through the age-aware broader ordering, not treat every such card as a fit.
  const suitable = (card: T) => meta(card).tier <= (allowWiderUnseen ? 2 : Math.max(2, bestTier));
  const fresh = (card: T) => suitable(card) && !observed.has(card.id) && !isRecentlyHandledCandidate(card, nowMs);
  // Once the preferred unseen pool is exhausted, expand known regions while
  // keeping age compatibility. Distance alone must not promote large age gaps.
  // All cards are already server-validated adults with safety exclusions applied.
  // Unknown regions come last and are never presented as nearby.
  const broaderFresh = (card: T) => allowWiderUnseen && !previous.has(card.id) && !observed.has(card.id) &&
    !handled.has(card.id) && !isRecentlyHandledCandidate(card, nowMs);
  const picked: T[] = [];
  const used = new Set<string>();
  // Resolve wider groups lazily: a full nearby page needs no nationwide sorts.
  function* pools() {
    yield sorted.filter(card => fresh(card) && !previous.has(card.id));
    // New exact-page refreshes may reserve up to half for compatible locals
    // instead of replacing everyone with distant strangers. Opt in only when
    // planning a persisted page: changing historical replay would silently
    // rewrite old pages and break plan/GET agreement on legacy deployments.
    if (allowWiderUnseen) {
      if (mixNearbyRevisits && sorted.some(card => broaderFresh(card) && meta(card).ageMatch &&
        meta(card).km != null && meta(card).km! > 180)) {
        const nearby = (card: T) => meta(card).close && meta(card).ageGap <= 6;
        const quota = Math.min(limit - picked.length,
          Math.max(0, Math.floor(limit / 2) - picked.filter(nearby).length));
        const locals = sorted.filter(card => nearby(card) && !used.has(card.id) &&
          !handled.has(card.id) && !isRecentlyHandledCandidate(card, nowMs));
        // Prefer nearby people outside BOTH currently visible sections. Only
        // reuse a current local when that small pool is exhausted. The remaining
        // slots still rotate to unseen, age-compatible people by distance band.
        const revisits = takeBalancedRecommendations(source, locals.filter(card => !previous.has(card.id)),
          quota, handled, nowMs, meta);
        revisits.push(...takeBalancedRecommendations(source, locals.filter(card => previous.has(card.id)),
          quota - revisits.length, handled, nowMs, meta));
        yield revisits;
      }
      // Missing/partial impressions must not label a current card as unseen.
      yield* groupBroaderCandidates(sorted.filter(broaderFresh), meta);
      // All eligible people may already have been shown. Still permit another
      // page; the API distinguishes a free repeat rotation from a new-person use.
      yield* groupBroaderCandidates(sorted.filter(card => !previous.has(card.id) && !isRecentlyHandledCandidate(card, nowMs)), meta);
      if (mixNearbyRevisits) {
        // Recent cancellations are a soft ranking preference, not a safety ban.
        // Exhausted exact pages must try other recyclable people before refilling
        // from the same few untouched people on the current main/extra page.
        // Only opt-in NEW pages change; old saved pages and legacy replay stay stable.
        // Blocks, rejections and active pairs were already removed by the service.
        yield* groupBroaderCandidates(sorted.filter(card => !previous.has(card.id)), meta);
      }
      yield sorted.filter(card => suitable(card) && !isRecentlyHandledCandidate(card, nowMs));
      yield* groupBroaderCandidates(sorted.filter(card => !isRecentlyHandledCandidate(card, nowMs)), meta);
    } else {
      yield sorted.filter(fresh);
      yield sorted.filter(card => suitable(card) && !previous.has(card.id));
      yield sorted.filter(suitable);
    }
    yield sorted;
  }
  for (const pool of pools()) {
    const next = takeBalancedRecommendations(source, pool.filter(card => !used.has(card.id)), limit - picked.length, handled, nowMs, meta);
    picked.push(...next); for (const card of next) used.add(card.id);
    if (picked.length >= limit) break;
  }
  // Preserve age-aware expansion order, not global tier order.
  if (allowWiderUnseen) return picked;
  const order = new Map(sorted.map((card, index) => [card.id, index]));
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

export function includeNewRelevantCandidates<T extends RecommendationCandidate>(
  source: RecommendationCandidate, candidates: T[], previous: T[], since: number, at: number, limit: number,
  handledIds: Set<string>, readMeta: RecommendationMetaReader = createRecommendationMetaReader(source), observedBeforeSeed: Set<string> = new Set(),
  preserveCloserCandidates = false
) {
  // A scarce-region member may already be browsing beyond 90 km. Allow new
  // compatible people up to that page's known distance band, not just locals,
  // but never widen an existing page solely because a remote newcomer joined.
  const pageBand = previous.reduce((band, card) => {
    const km = readMeta(card).km;
    return km == null ? band : Math.max(band, distanceBand(km));
  }, distanceBand(90));
  const newcomers = takeRecommendations(sortCandidatesForSource(source, candidates.filter((card) => {
    const created = Date.parse(card.created_at);
    const meta = readMeta(card);
    return created > since && created <= at && meta.ageMatch && meta.km != null && distanceBand(meta.km) <= pageBand &&
      !handledIds.has(card.id) && !observedBeforeSeed.has(card.id) && !isRecentlyHandledCandidate(card, at);
  }), `new:${since}`, at, readMeta), Math.min(2, limit));
  const newcomerIds = new Set(newcomers.map((card) => card.id));
  let merged = [...newcomers, ...previous.filter((card) => !newcomerIds.has(card.id))].slice(0, limit);
  if (preserveCloserCandidates) {
    // Exact pages may come from older rankings with locals at the end. Do not
    // drop those locals merely to prepend a distant newcomer. Keep the saved
    // order, replacing the farthest eligible slot; never expand a page's band.
    // Legacy replay stays unchanged to preserve pre-snapshot plan/GET agreement.
    const retained = previous.slice(0, limit);
    const promoted: T[] = [];
    for (const newcomer of newcomers) {
      const existing = retained.findIndex(card => card.id === newcomer.id);
      if (existing >= 0) retained.splice(existing, 1);
      else if (retained.length + promoted.length >= limit) {
        const incoming = readMeta(newcomer);
        let replace = -1;
        let farthestBand = -1;
        for (let index = 0; index < retained.length; index++) {
          const band = distanceBand(readMeta(retained[index]).km);
          if ((incoming.close || band >= distanceBand(incoming.km)) && band >= farthestBand) {
            replace = index; farthestBand = band;
          }
        }
        if (replace < 0) continue;
        retained.splice(replace, 1);
      }
      promoted.push(newcomer);
    }
    merged = [...promoted, ...retained];
  }
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
  nowMs = Date.now(),
  extraOptions?: { limit: number; excludeIds: Set<string> },
  observations: ObservedCandidate[] = [],
  readMeta = createRecommendationMetaReader(source)
): { recommendations: T[]; shownIds: Set<string>; activeShownIds: Set<string>; seeds: string[]; extraRecommendations: T[] } {
  // SQL returns +00:00 while the server plans with Z. Equal instants must replay
  // the same list; otherwise a checked plan could differ immediately after saving.
  const seeds = [...new Set(refreshTimes.flatMap((value) => Number.isFinite(Date.parse(value))
    ? [new Date(value).toISOString()] : []))].filter((value) => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) && ms <= nowMs && ms > nowMs - RECOMMENDATION_REFRESH_HISTORY_MS;
  }).sort((a, b) => Date.parse(a) - Date.parse(b)).slice(-32);
  let recommendations = seeds.length ? defaults.filter((card) => existedAt(card, Date.parse(seeds[0]))) : defaults;
  const shownIds = new Set(recommendations.map((card) => card.id));
  const activeShownIds = new Set(shownIds);
  const extraSeenIds = new Set<string>();
  let extraRecommendations: T[] = [];
  let previousPageIds = new Set<string>();
  const extraPoolAt = (pool: T[]) => pool.filter((card) =>
    readMeta(card).ageMatch && !extraOptions?.excludeIds.has(card.id) &&
    !recommendations.some((main) => main.id === card.id));
  const rotateExtras = (pool: T[], seed: string, at: number, observationAt = at, allowWiderUnseen = false) => {
    if (!extraOptions?.limit) return;
    const previousIds = new Set([...extraRecommendations.map((card) => card.id), ...previousPageIds]);
    const sorted = sortCandidatesForSource(source, extraPoolAt(pool), seed, at, readMeta);
    const observed = observedCandidateIdsAt(observations, observationAt);
    if (observed.size > 0 || allowWiderUnseen) {
      extraRecommendations = takeObservedRecommendations(source, sorted, extraOptions.limit,
        observed.size > 0 ? observed : shownIds, previousIds, handledIds, at, allowWiderUnseen, readMeta);
      for (const card of extraRecommendations) { extraSeenIds.add(card.id); shownIds.add(card.id); }
      return;
    }
    extraRecommendations = [];
    const pickedIds = new Set<string>();
    // Prefer unseen history across the wider tier before repeating a nearer
    // band. takeBalancedRecommendations then chooses nearest within that pool.
    for (const group of groupByRelevance(sorted, readMeta, false)) {
      for (const preference of [
        group.filter((card) => !activeShownIds.has(card.id) && !extraSeenIds.has(card.id) && !previousIds.has(card.id)),
        group.filter((card) => !extraSeenIds.has(card.id) && !previousIds.has(card.id)),
        group.filter((card) => !previousIds.has(card.id)),
        group,
      ]) {
        const picked = takeBalancedRecommendations(source, preference.filter((card) => !pickedIds.has(card.id)),
          extraOptions.limit - extraRecommendations.length, new Set(), at, readMeta);
        extraRecommendations.push(...picked);
        for (const card of picked) pickedIds.add(card.id);
        if (extraRecommendations.length >= extraOptions.limit) break;
      }
      if (extraRecommendations.length >= extraOptions.limit) break;
    }
    for (const card of extraRecommendations) {
      extraSeenIds.add(card.id);
      // Moving yesterday's extra into the main list is still a repeat to the
      // member. Keep this as a soft preference within the same relevance tier.
      shownIds.add(card.id);
    }
  };
  const initialAt = seeds.length ? Date.parse(seeds[0]) : nowMs;
  const dailyPageAt = Date.parse(`${getKstDateString(new Date(nowMs))}T00:00:00+09:00`);
  const initialPageAt = Date.parse(`${getKstDateString(new Date(initialAt))}T00:00:00+09:00`);
  rotateExtras(candidates.filter((card) => existedAt(card, initialAt)),
    `${getKstDateString(new Date(initialAt))}:admin-extra:initial`, initialAt, initialPageAt);
  let previousSeedMs: number | null = null;
  for (const seed of seeds) {
    const seedMs = Date.parse(seed);
    const historicalPool = candidates.filter((card) => existedAt(card, seedMs));
    if (previousSeedMs != null && seedMs - previousSeedMs >= DAY_MS) {
      // Once refresh expires, GET displays that day's defaults again. Rotate
      // away from that visible page, not the stale last refreshed page: in a
      // 20-person pool the latter would return exactly the same ten people.
      const dayKey = getKstDateString(new Date(seedMs));
      const dailyObserved = observedCandidateIdsAt(observations, Date.parse(`${dayKey}T00:00:00+09:00`));
      const dailySorted = sortCandidatesForSource(source, historicalPool, `${dayKey}:default`, nowMs, readMeta);
      recommendations = dailyObserved.size
        ? takeObservedRecommendations(source, dailySorted, limit, dailyObserved, new Set(), handledIds, nowMs, false, readMeta)
        : takeBalancedRecommendations(source, dailySorted, limit, handledIds, nowMs, readMeta);
      // Reset BOTH sections exactly as a no-active-refresh GET does. Carrying
      // old extra-page preferences into this step excluded the wrong three
      // people and could repeat a current extra as a supposedly new main card.
      extraRecommendations = replayRecommendationRefreshes(source, historicalPool, recommendations,
        [], handledIds, limit, seedMs, extraOptions, observations, readMeta).extraRecommendations;
      for (const card of extraRecommendations) { shownIds.add(card.id); extraSeenIds.add(card.id); }
    } else if (previousSeedMs != null) {
      recommendations = includeNewRelevantCandidates(source, historicalPool, recommendations, previousSeedMs, seedMs, limit, handledIds, readMeta,
        observedCandidateIdsAt(observations, previousSeedMs));
    }
    for (const card of recommendations) shownIds.add(card.id);
    previousPageIds = new Set([...recommendations, ...extraRecommendations].map((card) => card.id));
    const sorted = sortCandidatesForSource(source, historicalPool, `refresh:${seed}`, nowMs, readMeta);
    const observed = observedCandidateIdsAt(observations, seedMs);
    // Use one age/distance policy regardless of impression support. Actual
    // observations take precedence; only legacy clients with no observations
    // use replayed pages as a soft ranking hint. Neither is a safety exclusion.
    recommendations = takeObservedRecommendations(source, sorted, limit,
      observed.size > 0 ? observed : shownIds, previousPageIds, handledIds, nowMs, true, readMeta);
    for (const card of recommendations) shownIds.add(card.id);
    if (getActiveRecommendationRefresh(seed, nowMs)) {
      for (const card of recommendations) activeShownIds.add(card.id);
    }
    rotateExtras(historicalPool, `${getKstDateString(new Date(seedMs))}:admin-extra:${seed}`, seedMs, seedMs, true);
    previousSeedMs = seedMs;
  }
  if (previousSeedMs != null) {
    recommendations = includeNewRelevantCandidates(source, candidates, recommendations, previousSeedMs, nowMs, limit, handledIds, readMeta,
      observedCandidateIdsAt(observations, previousSeedMs));
    for (const card of recommendations) { shownIds.add(card.id); activeShownIds.add(card.id); }
  }
  if (extraOptions?.limit) {
    // Never show today's main cards twice. Historical main pages are only a
    // soft preference: excluding them sent extras far away even when compatible
    // locals remained. Preserve existing extras within each relevance tier.
    const pool = extraPoolAt(candidates);
    const eligible = new Set(pool.map((card) => card.id));
    const retained = extraRecommendations.filter((card) => eligible.has(card.id));
    const used = new Set(retained.map((card) => card.id));
    const sorted = sortCandidatesForSource(source, pool,
      `${getKstDateString(new Date(nowMs))}:admin-extra:fill`, nowMs, readMeta);
    const observed = observedCandidateIdsAt(observations, previousSeedMs ?? dailyPageAt);
    if (observed.size > 0 || previousSeedMs != null) {
      extraRecommendations = [...retained, ...takeObservedRecommendations(source, sorted.filter(card => !used.has(card.id)),
        extraOptions.limit - retained.length, observed.size > 0 ? observed : shownIds,
        previousPageIds, handledIds, nowMs, previousSeedMs != null, readMeta)];
      return { recommendations, shownIds, activeShownIds, seeds, extraRecommendations };
    }
    extraRecommendations = [];
    for (const group of groupByRelevance(sorted, readMeta)) {
      const groupIds = new Set(group.map((card) => card.id));
      extraRecommendations.push(...takeRecommendations(retained.filter((card) => groupIds.has(card.id)),
        extraOptions.limit - extraRecommendations.length));
      extraRecommendations.push(...takeBalancedRecommendations(source, group.filter((card) => !used.has(card.id)),
        extraOptions.limit - extraRecommendations.length, new Set([...extraSeenIds, ...activeShownIds]), nowMs, readMeta));
      if (extraRecommendations.length >= extraOptions.limit) break;
    }
  }
  return { recommendations, shownIds, activeShownIds, seeds, extraRecommendations };
}

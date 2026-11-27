import { getRegionDistanceMeta } from "@/lib/region-distance";
import { isCandidateInSourceAgeRange, isRecentlyHandledCandidate, sortCandidatesForSource, type RecommendationCandidate } from "@/lib/dating-1on1-recommendations";

export const EXPANSION_LIMIT = 3;
export const EXPANSION_TABLE = "dating_1on1_expansion_batches";
export const WINTER_EXPANSION_NEARBY_KM = 90;
const WINTER_ACTIVITY_MS = 7 * 86400000;

// Migration verified before general release. Keep an explicit server-side 0 kill switch.
export function isExpansionEnabled(userId: string, percentage = process.env.DATING_EXPANSION_PERCENT ?? "100"): boolean {
  if (!userId || !percentage || !/^\d{1,3}$/.test(percentage)) return false;
  const amount = Number(percentage);
  if (amount < 1 || amount > 100) return false;
  let hash = 2166136261;
  for (const char of `expansion-v1:${userId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100 < amount;
}

export function selectExpansionCandidates<T extends RecommendationCandidate>(
  source: RecommendationCandidate, candidates: T[], excludedIds: Set<string>,
  day: string, now: number, snapshotIds?: readonly string[],
): T[] {
  const eligible = candidates.filter(candidate => {
    if (candidate.id === source.id || candidate.sex === source.sex || excludedIds.has(candidate.id) ||
        !isCandidateInSourceAgeRange(source, candidate) || isRecentlyHandledCandidate(candidate, now)) return false;
    const distance = getRegionDistanceMeta(source.region, candidate.region).distanceKm;
    const activity = Math.max(Date.parse(candidate.last_active_at ?? "") || 0, Date.parse(candidate.created_at) || 0);
    return distance != null && distance <= 180 && activity <= now && activity >= now - 7 * 86400000;
  });
  if (snapshotIds) {
    const byId = new Map(eligible.map(candidate => [candidate.id, candidate]));
    // Never refill a consumed daily batch when someone is blocked, matched or removed.
    return [...new Set(snapshotIds)].slice(0, EXPANSION_LIMIT).flatMap(id => byId.get(id) ?? []);
  }
  return sortCandidatesForSource(source, eligible, `expansion:${day}`, now).slice(0, EXPANSION_LIMIT);
}

export function isWinterExpansionEnabled(userId: string) {
  return process.env.DATING_WINTER_EXPANSION_ENABLED !== "0" && isExpansionEnabled(userId);
}

// Narrower than the general expansion. Never fill a winter slot by relaxing its
// age or local-distance gate; preserve the ordinary expansion independently.
export function selectWinterExpansionCandidates<T extends RecommendationCandidate & { user_id: string }>(
  source: T, candidates: T[], excludedCardIds: ReadonlySet<string>, excludedUsers: ReadonlySet<string>,
  now: number,
): T[] {
  const eligible = candidates.flatMap(candidate => {
    if (candidate.id === source.id || candidate.user_id === source.user_id || candidate.sex === source.sex ||
        excludedCardIds.has(candidate.id) || excludedUsers.has(candidate.user_id) ||
        !isCandidateInSourceAgeRange(source, candidate) || isRecentlyHandledCandidate(candidate, now)) return [];
    const meta = getRegionDistanceMeta(source.region, candidate.region);
    if (!meta.sameProvince || meta.distanceKm == null || meta.distanceKm > WINTER_EXPANSION_NEARBY_KM) return [];
    const activity = Math.max(Date.parse(candidate.last_active_at ?? "") || 0, Date.parse(candidate.created_at) || 0);
    if (activity > now || activity < now - WINTER_ACTIVITY_MS) return [];
    return [{ candidate, km: meta.distanceKm, activity }];
  });
  const users = new Set<string>();
  return eligible.sort((a, b) => a.km - b.km || b.activity - a.activity || a.candidate.id.localeCompare(b.candidate.id))
    .flatMap(({ candidate }) => {
      if (users.has(candidate.user_id)) return [];
      users.add(candidate.user_id);
      return [candidate];
    }).slice(0, EXPANSION_LIMIT);
}

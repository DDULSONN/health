import { getRegionDistanceMeta } from "@/lib/region-distance";
import {
  isCandidateInSourceAgeRange, isRecentlyHandledCandidate, sortCandidatesForSource,
  type ObservedCandidate, type RecommendationCandidate,
} from "@/lib/dating-1on1-recommendations";

export type RecommendationPageVisit = { at: number; ids: string[] };
type Page<T> = { recommendations: T[]; extraRecommendations: T[] };
type Context = { observations: ObservedCandidate[]; recentPages: RecommendationPageVisit[];
  handled: Set<string>; limit: number; extraLimit: number };

// Called only for an explicit NEW persisted page, with a fully safety-filtered
// pool. GET restoration and historical replay deliberately keep their contracts.
export function rotateRecommendationPage<T extends RecommendationCandidate>(
  source: RecommendationCandidate, candidates: T[], previous: Page<T>, seed: string, at: number, context: Context,
): Page<T> {
  const priorIds = new Set([...previous.recommendations, ...previous.extraRecommendations].map(c => c.id));
  const lastSeen = new Map<string, number>();
  for (const row of context.observations) {
    if (Number.isFinite(row.at) && row.at < at && row.at >= at - 30 * 86400000) {
      lastSeen.set(row.id, Math.max(lastSeen.get(row.id) ?? 0, row.at));
    }
  }
  // Keep exact page order instead of flattening all previously seen people into
  // one boolean set. Back/forward or delayed impression acknowledgement cannot
  // make an earlier page "new" again. History survives refresh quota rollover.
  for (const page of context.recentPages) {
    if (Number.isFinite(page.at) && page.at < at && page.at >= at - 30 * 86400000) {
      for (const id of page.ids) lastSeen.set(id, Math.max(lastSeen.get(id) ?? 0, page.at));
    }
  }
  for (const id of priorIds) lastSeen.set(id, at);
  const recentIds = new Set(priorIds);
  let lastTwoPageIds = new Set(priorIds);
  // A -> B -> A is still a repeat even when the immediate page differs.
  // Use up to three distinct committed pages, then relax this preference only
  // when the compatible pool cannot fill the next page.
  let recentPageCount = 1;
  for (const page of [...context.recentPages].sort((a, b) => b.at - a.at)) {
    if (page.at >= at || page.at < at - 30 * 86400000 || !Number.isFinite(page.at)) continue;
    if (page.ids.every(id => recentIds.has(id))) continue;
    page.ids.forEach(id => recentIds.add(id));
    recentPageCount++;
    if (recentPageCount === 2) lastTwoPageIds = new Set(recentIds);
    if (recentPageCount >= 3) break;
  }
  const sorted = sortCandidatesForSource(source, candidates, `rotation-v2:${seed}`, at);
  const tieOrder = new Map(sorted.map((c, i) => [c.id, i]));
  const metadata = new Map(candidates.map(c => {
    const km = getRegionDistanceMeta(source.region, c.region).distanceKm;
    const gap = source.age != null && c.age != null ? Math.abs(source.age - c.age) : Infinity;
    const ageMatch = isCandidateInSourceAgeRange(source, c);
    const band = km == null ? 7 : km <= 90 ? 0 : km <= 180 ? 1 : km <= 250 ? 2 : km <= 330 ? 3 : km <= 450 ? 4 : 5;
    return [c.id, { km, gap, ageMatch, band,
      near: km != null && km <= 90 && gap <= 6,
      suitable: km != null && ((km <= 180 && ageMatch) || (km <= 90 && gap <= 6)),
      fresh: !lastSeen.has(c.id) && !context.handled.has(c.id) && !isRecentlyHandledCandidate(c, at),
    }] as const;
  }));
  const meta = (c: T) => metadata.get(c.id)!;
  // Keep age compatibility when widening. Within a comparable region/age band,
  // least recently shown wins BEFORE activity/Plus/hash/recent-cancel preferences.
  // Exact km must not pin the same nearest handful forever.
  const ranks = (c: T) => {
    const m = meta(c);
    return [m.km == null ? 1 : 0, m.ageMatch ? 0 : Math.max(1, Math.ceil(m.gap / 3)), m.band,
      lastSeen.get(c.id) ?? 0, tieOrder.get(c.id)!];
  };
  const fair = (rows: T[]) => rows.sort((a, b) => {
    const x = ranks(a), y = ranks(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  const select = (pool: T[], limit: number) => {
    const picked: T[] = [], used = new Set<string>();
    const add = (rows: T[], cap = limit) => {
      for (const c of fair(rows)) {
        if (picked.length >= cap) break;
        if (!used.has(c.id)) { picked.push(c); used.add(c.id); }
      }
    };
    add(pool.filter(c => meta(c).fresh && meta(c).suitable && !priorIds.has(c.id)));
    if (picked.length < limit && pool.some(c => meta(c).fresh && meta(c).ageMatch && (meta(c).km ?? 0) > 180)) {
      const localCount = picked.filter(c => meta(c).near).length;
      const localCap = Math.min(limit, picked.length + Math.max(0, Math.floor(limit / 2) - localCount));
      add(pool.filter(c => meta(c).near && !priorIds.has(c.id)), localCap);
      add(pool.filter(c => meta(c).near), localCap);
    }
    add(pool.filter(c => meta(c).fresh && meta(c).ageMatch && meta(c).km != null && !priorIds.has(c.id)));
    // Revisit suitable people before promoting unrelated ages merely because
    // those unrelated profiles have no previous canceled/skipped request.
    const compatible = (c: T) => meta(c).ageMatch || meta(c).near;
    add(pool.filter(c => compatible(c) && !recentIds.has(c.id)));
    add(pool.filter(c => compatible(c) && !lastTwoPageIds.has(c.id)));
    // Once every compatible off-page person is exhausted, widen by the smallest
    // age gaps, allowing a small comparable age band to rotate too. Exact age
    // sorting alone pins the same handful even with a much larger eligible pool.
    const offPage = pool.filter(c => !priorIds.has(c.id));
    const smallestGap = Math.min(...offPage.map(c => meta(c).gap));
    const adjacentAges = offPage.filter(c => meta(c).gap <= Math.max(6, smallestGap + 3));
    add(adjacentAges.filter(c => !recentIds.has(c.id)));
    add(adjacentAges.filter(c => !lastTwoPageIds.has(c.id)));
    add(pool.filter(c => compatible(c) && !priorIds.has(c.id)));
    add(adjacentAges);
    add(offPage);
    add(pool);
    return picked;
  };
  const recommendations = select(candidates, context.limit);
  const mainIds = new Set(recommendations.map(c => c.id));
  // Recent canceled/skipped requests are not a safety block. Treat them as a
  // ranking hint here too, instead of permanently trapping extras in 3 cards.
  const extraRecommendations = select(candidates.filter(c => !mainIds.has(c.id) && meta(c).ageMatch), context.extraLimit);
  return { recommendations, extraRecommendations };
}

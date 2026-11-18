import { isCandidateInSourceAgeRange, type ObservedCandidate, type RecommendationCandidate } from "@/lib/dating-1on1-recommendations";
import type { RecommendationPageVisit } from "@/lib/dating-1on1-recommendation-rotation";
import { getRegionDistanceMeta } from "@/lib/region-distance";

type Person = RecommendationCandidate & { user_id: string };
type Page<T> = { recommendations: T[]; extraRecommendations: T[] };
export type PartialRefreshChange = { index: number; from: string; to: string; beforeKm: number; afterKm: number };

// Server-only maintenance, not a member refresh or a new recommendation policy.
// The caller provides the SAME fully filtered pool used by the normal planner.
export function partialRecommendationPage<T extends Person>(source: Person, pool: T[], previous: Page<T>,
  context: { observations: ObservedCandidate[]; handled: Set<string>; extraExcluded: Set<string>;
    recentPages?: RecommendationPageVisit[]; expansionIds: Set<string> }, pageAt: number, now: number) {
  const page = { recommendations: [...previous.recommendations], extraRecommendations: [...previous.extraRecommendations] };
  const changes: PartialRefreshChange[] = [];
  const visible = [...page.recommendations, ...page.extraRecommendations];
  const since = Math.max(now - 30 * 86400000, Date.parse(source.created_at));
  const prior = new Set(context.observations.filter(o => o.at >= since && o.at < pageAt).map(o => o.id));
  const repeats = visible.filter(c => prior.has(c.id)).length;
  if (!Number.isFinite(pageAt) || pageAt >= now || visible.length < 5 || repeats < Math.ceil(visible.length / 2))
    return { page, changes, repeats };
  // Page receipts and expansions exclude previously delivered people even when
  // a browser never acknowledged them. Only actual views qualify donor slots.
  const seen = new Set([...context.observations.filter(o => o.at <= now).map(o => o.id),
    ...(context.recentPages ?? []).filter(p => p.at <= now).flatMap(p => p.ids),
    ...visible.map(c => c.id), ...context.expansionIds]);
  const users = new Set(visible.map(c => c.user_id));
  const km = (c: Person) => getRegionDistanceMeta(source.region, c.region).distanceKm;
  const available = pool.filter(c => !seen.has(c.id) && !users.has(c.user_id)
    && !context.handled.has(c.id) && !context.extraExcluded.has(c.id) && isCandidateInSourceAgeRange(source, c)
    && km(c) != null && km(c)! <= 90)
    .sort((a, b) => km(a)! - km(b)! || Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id));
  const donors = page.recommendations.map((c, index) => ({ c, index }))
    .filter(({ c }) => prior.has(c.id) && km(c) != null)
    .sort((a, b) => km(b.c)! - km(a.c)! || b.index - a.index);
  for (const { c, index } of donors) {
    if (changes.length === 3) break;
    const next = available.find(n => !users.has(n.user_id) && km(n)! <= km(c)! + 0.01);
    if (!next) continue;
    users.add(next.user_id);
    page.recommendations[index] = next;
    changes.push({ index, from: c.id, to: next.id, beforeKm: km(c)!, afterKm: km(next)! });
  }
  return { page, changes, repeats };
}

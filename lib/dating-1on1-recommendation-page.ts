import {
  includeNewRelevantCandidates, isCandidateInSourceAgeRange, observedCandidateIdsAt,
  sortCandidatesForSource, takeObservedRecommendations,
  type ObservedCandidate, type RecommendationCandidate,
} from "@/lib/dating-1on1-recommendations";
import type { StoredRecommendationPage } from "@/lib/dating-1on1-recommendation-page-store";
import { rotateRecommendationPage, type RecommendationPageVisit } from "@/lib/dating-1on1-recommendation-rotation";

type Page<T> = { recommendations: T[]; extraRecommendations: T[] };
type Context = { handled: Set<string>; extraExcluded: Set<string>; observations: ObservedCandidate[]; limit: number; extraLimit: number;
  recentPages?: RecommendationPageVisit[] };

// The caller supplies only its fully safety-filtered eligible pool. Saved IDs
// are an ordering receipt, never permission to bypass a block or active match.
export function restoreRecommendationPage<T extends RecommendationCandidate>(
  source: RecommendationCandidate, candidates: T[], saved: StoredRecommendationPage, at: number, context: Context,
): Page<T> {
  const byId = new Map(candidates.map(c => [c.id, c]));
  const seedAt = Date.parse(saved.refreshed_at);
  const observed = observedCandidateIdsAt(context.observations, seedAt);
  const main = [...new Set(saved.main_candidate_ids)].slice(0, context.limit).flatMap(id => byId.get(id) ?? []);
  const savedExtras = new Set(saved.extra_candidate_ids);
  const sorted = sortCandidatesForSource(source, candidates, `saved-fill:${saved.refreshed_at}`, at);
  const mainIds = new Set(main.map(c => c.id));
  main.push(...takeObservedRecommendations(source, sorted.filter(c => !mainIds.has(c.id) && !savedExtras.has(c.id)),
    context.limit - main.length, observed, new Set(), context.handled, at, true));
  // Let eligible newcomers enter without a charged refresh; preserve all safety
  // filtering and keep the historical page stable when views are acknowledged.
  const recommendations = includeNewRelevantCandidates(source, candidates, main, seedAt, at,
    context.limit, context.handled, undefined, observed, true);
  const selected = new Set(recommendations.map(c => c.id));
  const extraPool = sorted.filter(c => !selected.has(c.id) &&
    (context.recentPages !== undefined || !context.extraExcluded.has(c.id)) && isCandidateInSourceAgeRange(source, c));
  const extraById = new Map(extraPool.map(c => [c.id, c]));
  const retained = [...savedExtras].slice(0, context.extraLimit).flatMap(id => extraById.get(id) ?? []);
  const retainedIds = new Set(retained.map(c => c.id));
  return { recommendations, extraRecommendations: [...retained,
    ...takeObservedRecommendations(source, extraPool.filter(c => !retainedIds.has(c.id)), context.extraLimit - retained.length,
      observed, new Set(), context.handled, at, true)] };
}

export function nextRecommendationPage<T extends RecommendationCandidate>(
  source: RecommendationCandidate, candidates: T[], previous: Page<T>, seed: string, at: number, context: Context,
  replayedIds: Set<string> = new Set(),
): Page<T> {
  if (context.recentPages !== undefined) {
    return rotateRecommendationPage(source, candidates, previous, seed, at, { ...context, recentPages: context.recentPages });
  }
  const previousIds = new Set([...previous.recommendations, ...previous.extraRecommendations].map(c => c.id));
  const actual = observedCandidateIdsAt(context.observations, at);
  const observed = actual.size ? actual : new Set([...replayedIds, ...previousIds]);
  const sorted = sortCandidatesForSource(source, candidates, `refresh:${seed}`, at);
  const recommendations = takeObservedRecommendations(source, sorted, context.limit, observed, previousIds, context.handled, at, true, undefined, true);
  const mainIds = new Set(recommendations.map(c => c.id));
  const extraPool = sorted.filter(c => !mainIds.has(c.id) && !context.extraExcluded.has(c.id) && isCandidateInSourceAgeRange(source, c));
  return { recommendations, extraRecommendations: takeObservedRecommendations(source, extraPool,
    context.extraLimit, observed, previousIds, context.handled, at, true, undefined, true) };
}

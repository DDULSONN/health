import { isCandidateInSourceAgeRange, type ObservedCandidate, type RecommendationCandidate } from "@/lib/dating-1on1-recommendations";
import type { RecommendationPageVisit } from "@/lib/dating-1on1-recommendation-rotation";
import { getRegionDistanceMeta } from "@/lib/region-distance";

export type OneOnOneNewCandidateNotice = { state: "waiting" | "updated"; new_candidate_count: number };
const WEEK_MS = 7 * 86400000;

// Presentation metadata only. Use this member's committed pages AND actual
// impressions; merely reloading/acknowledging the current page is not a repeat.
// Missing history means unknown, not an exhausted pool or a reason to upsell.
export function getOneOnOneNewCandidateNotice({ source, visible, observations, pages, pageAt, nowMs }: {
  source: RecommendationCandidate;
  visible: RecommendationCandidate[];
  observations: ObservedCandidate[];
  pages?: RecommendationPageVisit[];
  pageAt: number;
  nowMs: number;
}): OneOnOneNewCandidateNotice | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(pageAt) || pageAt > nowMs || !visible.length) return null;
  const sourceCreated = Date.parse(source.created_at);
  if (!Number.isFinite(sourceCreated)) return null;
  const since = Math.max(nowMs - WEEK_MS, sourceCreated);
  const uniquePages = new Map<number, Set<string>>();
  for (const page of pages ?? []) {
    if (Number.isFinite(page.at) && page.at >= since && page.at <= pageAt && page.ids.length) {
      uniquePages.set(page.at, new Set(page.ids));
    }
  }
  const recent = [...uniquePages].sort(([a], [b]) => b - a).slice(0, 2);
  if (recent.length < 2) return null;
  const [, latestIds] = recent[0], [, previousIds] = recent[1];
  const overlap = [...latestIds].filter(id => previousIds.has(id)).length;
  if (overlap < Math.ceil(Math.max(latestIds.size, previousIds.size) / 2)) return null;
  const seenBeforePage = new Set(observations.filter(row => Number.isFinite(row.at) && row.at >= since && row.at < pageAt).map(row => row.id));
  const uniqueVisible = [...new Map(visible.map(card => [card.id, card])).values()];
  if (uniqueVisible.filter(card => seenBeforePage.has(card.id)).length < Math.ceil(uniqueVisible.length / 2)) return null;
  // Count only eligible arrivals actually included in the final, validated list.
  // Never expose other members' history, identities, pool size or exact location.
  const newCount = uniqueVisible.slice(0, 2).filter(card => {
    const created = Date.parse(card.created_at);
    return created > pageAt && created <= nowMs && !seenBeforePage.has(card.id) &&
      isCandidateInSourceAgeRange(source, card) && getRegionDistanceMeta(source.region, card.region).distanceKm != null;
  }).length;
  return { state: newCount > 0 ? "updated" : "waiting", new_candidate_count: newCount };
}

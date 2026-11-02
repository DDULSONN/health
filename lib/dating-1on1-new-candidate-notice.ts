import { isCandidateInSourceAgeRange, type ObservedCandidate, type RecommendationCandidate } from "@/lib/dating-1on1-recommendations";
import type { RecommendationPageVisit } from "@/lib/dating-1on1-recommendation-rotation";
import { getRegionDistanceMeta } from "@/lib/region-distance";

export type OneOnOneNewCandidateNotice = { state: "waiting" | "updated"; new_candidate_count: number };
const WEEK_MS = 7 * 86400000;

// Presentation metadata only. Actual views before this page are evidence of a
// repeat even when the two latest saved pages differ (or have expired).
// Views of this page itself must never turn an ordinary reload into a repeat.
// Missing impressions mean unknown, not an exhausted pool or a reason to upsell.
export function getOneOnOneNewCandidateNotice({ source, visible, observations, pageAt, nowMs }: {
  source: RecommendationCandidate;
  visible: RecommendationCandidate[];
  observations: ObservedCandidate[];
  pages?: RecommendationPageVisit[]; // Kept for callers; page overlap is not an exposure requirement.
  pageAt: number;
  nowMs: number;
}): OneOnOneNewCandidateNotice | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(pageAt) || pageAt > nowMs || !visible.length) return null;
  const sourceCreated = Date.parse(source.created_at);
  if (!Number.isFinite(sourceCreated)) return null;
  const since = Math.max(nowMs - WEEK_MS, sourceCreated);
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

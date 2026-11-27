import { getRegionDistanceMeta } from "@/lib/region-distance";

export type CandidateViewOptions = { minAge: string; maxAge: string; nearbyFirst: boolean };
export const DEFAULT_CANDIDATE_VIEW: CandidateViewOptions = { minAge: "", maxAge: "", nearbyFirst: false };

export function readCandidateViewRange(options: CandidateViewOptions) {
  const read = (input: string) => {
    if (!input) return null;
    if (!/^\d{2,3}$/.test(input)) return NaN;
    const years = Number(input);
    return years >= 19 && years <= 120 ? years : NaN;
  };
  const min = read(options.minAge);
  const max = read(options.maxAge);
  const valid = !Number.isNaN(min) && !Number.isNaN(max) && (min === null || max === null || min <= max);
  return { min, max, valid };
}

// Presentation only: never load new records or change eligibility, persisted
// ranking, expanded candidates, saved cards, impressions, or refresh quotas.
export function selectCandidateView<T extends { region?: string | null }>(
  candidates: T[], sourceRegion: string | null, options: CandidateViewOptions, ageOf: (candidate: T) => number | null,
) {
  const { min, max, valid } = readCandidateViewRange(options);
  const filtered = valid && (min !== null || max !== null) ? candidates.filter(candidate => {
    const age = ageOf(candidate);
    return typeof age === "number" && Number.isFinite(age) && (min === null || age >= min) && (max === null || age <= max);
  }) : candidates;
  if (!options.nearbyFirst || !sourceRegion || filtered.length < 2) return filtered;
  return filtered.map((card, index) => {
    const meta = getRegionDistanceMeta(sourceRegion, card.region ?? null);
    return { card, index, distance: meta.sameRegion ? 0 : meta.distanceKm ?? Infinity };
  }).sort((a, b) => (a.distance === b.distance ? a.index - b.index : a.distance - b.distance)).map(row => row.card);
}

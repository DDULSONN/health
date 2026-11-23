import { MIN_DATING_AGE } from "@/lib/dating-age";
import { getRegionDistanceMeta } from "@/lib/region-distance";

/** The caller supplies its existing safety-filtered, current candidate pool. */
export type SingleCandidateProfile = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  age: number | null;
  region: string;
  created_at: string;
};

const DISTANCE_BANDS_KM = [40, 90, 180, 250, 330, 450, Infinity] as const;
const YEARS_PER_DISTANCE_BAND = 2;

function hasUsableAdultAge(age: number | null): age is number {
  return age !== null && Number.isSafeInteger(age) && age >= MIN_DATING_AGE;
}

export function isSingleCandidateBestFitAllowed(source: SingleCandidateProfile, candidate: SingleCandidateProfile): boolean {
  return Boolean(source.id && candidate.id && source.id !== candidate.id &&
    source.user_id && candidate.user_id && source.user_id !== candidate.user_id &&
    ((source.sex === "male" && candidate.sex === "female") || (source.sex === "female" && candidate.sex === "male")) &&
    hasUsableAdultAge(source.age) && hasUsableAdultAge(candidate.age));
}

function distanceFromPreferredAge(source: SingleCandidateProfile, sourceAge: number, age: number) {
  // Same existing 1:1 preferred age ranges. Use them as a ranking preference:
  // stepping a year outside the range is not equivalent to a large age gap.
  const youngest = Math.max(MIN_DATING_AGE, sourceAge - (source.sex === "male" ? 4 : 1));
  const oldest = sourceAge + (source.sex === "male" ? 1 : 4);
  return Math.max(youngest - age, age - oldest, 0);
}

/** Ranks all allowed alternatives, including old views after unseen profiles. */
export function rankSingleCandidateAlternatives<T extends SingleCandidateProfile>(
  source: SingleCandidateProfile,
  pool: readonly T[],
  excludedUserIds: ReadonlySet<string>,
  deliveredUserIds: ReadonlySet<string>,
  lastExposedAtByUserId?: ReadonlyMap<string, number>,
): T[] {
  const sourceAge = source.age;
  if (!hasUsableAdultAge(sourceAge)) return [];

  const ranked = pool.flatMap(candidate => {
    const age = candidate.age;
    if (excludedUserIds.has(candidate.user_id) || !isSingleCandidateBestFitAllowed(source, candidate) || !hasUsableAdultAge(age)) return [];
    const measured = getRegionDistanceMeta(source.region, candidate.region).distanceKm;
    const km = measured != null && Number.isFinite(measured) && measured >= 0 ? measured : null;
    const band = km === null ? 0 : DISTANCE_BANDS_KM.findIndex(max => km <= max);
    const ageDeviation = distanceFromPreferredAge(source, sourceAge, age);
    const seen = deliveredUserIds.has(candidate.user_id);
    const exposed = lastExposedAtByUserId?.get(candidate.user_id);
    const lastSeen = seen && typeof exposed === "number" && Number.isFinite(exposed) ? exposed : Infinity;
    const created = Date.parse(candidate.created_at);
    return [{ candidate, ranks: [
      seen ? 1 : 0,
      km === null ? 1 : 0,
      band + Math.ceil(ageDeviation / YEARS_PER_DISTANCE_BAND),
      ageDeviation > 0 ? 1 : 0,
      ageDeviation,
      band,
      // If distance cannot be measured, age is the only fit signal.
      km === null ? Math.abs(sourceAge - age) : 0,
      lastSeen,
      km ?? Infinity,
      Number.isFinite(created) ? -created : Infinity,
    ] }];
  });

  ranked.sort((a, b) => {
    for (let i = 0; i < a.ranks.length; i++) {
      if (a.ranks[i] !== b.ranks[i]) return a.ranks[i] < b.ranks[i] ? -1 : 1;
    }
    return a.candidate.id.localeCompare(b.candidate.id);
  });
  return ranked.map(({ candidate }) => candidate);
}

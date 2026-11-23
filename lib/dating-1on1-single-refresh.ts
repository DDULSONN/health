import { createHash } from "node:crypto";
import { isCandidateInSourceAgeRange, type RecommendationCandidate } from "@/lib/dating-1on1-recommendations";
import { recommendationSourceKey } from "@/lib/dating-1on1-recommendation-page-store";
import type { CandidateImpression } from "@/lib/dating-1on1-impressions";
import { getRegionDistanceMeta } from "@/lib/region-distance";
import type { createAdminClient } from "@/lib/supabase/server";

const HISTORY_MS = 30 * 86400000;
const MAX_LOCAL_DISTANCE_KM = 90;
const MAX_VALIDATION_BATCH = 12;
export const SINGLE_REFRESH_TABLE = "dating_1on1_single_candidate_swaps";

type Person = RecommendationCandidate & { user_id: string };
export type SingleCandidateSwap = {
  generation_key: string;
  from_candidate_card_id: string;
  to_candidate_card_id: string;
  to_candidate_user_id: string;
};
export type SingleCandidateRefreshRequest = {
  sourceCardId: string;
  fromCandidateCardId: string;
  generationKey: string;
  plannedAt: string;
};

export async function readSingleCandidateSwaps(admin: ReturnType<typeof createAdminClient>, userId: string, sourceCardId: string) {
  try {
    const { data, error } = await admin.from(SINGLE_REFRESH_TABLE)
      .select("generation_key,from_candidate_card_id,to_candidate_card_id,to_candidate_user_id")
      .eq("user_id", userId).eq("source_card_id", sourceCardId)
      .order("created_at", { ascending: false }).limit(500);
    return error || !Array.isArray(data) ? null : data as SingleCandidateSwap[];
  } catch {
    // Additive rollout: absent storage is never allowed to break normal reads.
    return null;
  }
}

export function singleCandidateGenerationKey(source: { id: string; sex: string; birth_year: number; region: string }, pageAt: number, refreshAt?: string | null) {
  return createHash("sha256")
    .update(JSON.stringify([source.id, recommendationSourceKey(source), pageAt, refreshAt ? Date.parse(refreshAt) : null]))
    .digest("hex");
}

export function applySingleCandidateSwaps<T extends Person>(
  main: T[], other: Person[], available: T[], swaps: SingleCandidateSwap[], generationKey: string,
): T[] {
  const byId = new Map(available.map(card => [card.id, card]));
  const occupied = new Set([...main, ...other].map(card => card.user_id));
  const swapsByDonor = new Map(swaps.filter(swap => swap.generation_key === generationKey).map(swap => [swap.from_candidate_card_id, swap]));
  return main.flatMap(card => {
    const swap = swapsByDonor.get(card.id);
    if (!swap) return [card];
    const next = byId.get(swap.to_candidate_card_id);
    // Revalidate the exact member before display; a now hidden/blocked/revised
    // replacement is never shown, and no other slot is refilled.
    if (!next || next.user_id !== swap.to_candidate_user_id || occupied.has(next.user_id)) return [];
    occupied.add(next.user_id);
    return [next];
  });
}

export function repeatSingleCandidateIds<T extends Person>(
  main: T[], impressions: CandidateImpression[], swaps: SingleCandidateSwap[], generationKey: string, pageAt: number, now: number,
) {
  const priorViewers = new Set(impressions.filter(({first_seen_at}) => {
    const at = Date.parse(first_seen_at);
    return at < pageAt && at >= now - HISTORY_MS;
  }).map(row => row.candidate_user_id));
  const swapped = new Set(swaps.filter(row => row.generation_key === generationKey).map(row => row.from_candidate_card_id));
  return main.filter(card => priorViewers.has(card.user_id) && !swapped.has(card.id)).map(card => card.id);
}

export function rankUnseenSingleCandidates<T extends Person>(
  source: T, pool: T[], impressions: CandidateImpression[], priorCardIds: Set<string>,
  excludedUserIds: Set<string>,
) {
  const seenUsers = new Set(impressions.map(row => row.candidate_user_id));
  return pool.flatMap(card => {
    if (seenUsers.has(card.user_id) || excludedUserIds.has(card.user_id) ||
      priorCardIds.has(card.id) || !isCandidateInSourceAgeRange(source, card)) return [];
    const km = getRegionDistanceMeta(source.region, card.region).distanceKm;
    return km == null || km > MAX_LOCAL_DISTANCE_KM ? [] : [{card, km}];
  }).sort((a, b) => a.km - b.km ||
    Date.parse(b.card.created_at) - Date.parse(a.card.created_at) || a.card.id.localeCompare(b.card.id))
    .slice(0, MAX_VALIDATION_BATCH).map(entry => entry.card);
}

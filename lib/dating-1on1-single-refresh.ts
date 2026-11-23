import { createHash } from "node:crypto";
import { isCandidateInSourceAgeRange, type RecommendationCandidate } from "@/lib/dating-1on1-recommendations";
import { recommendationSourceKey } from "@/lib/dating-1on1-recommendation-page-store";
import type { CandidateImpression } from "@/lib/dating-1on1-impressions";
import { getRegionDistanceMeta } from "@/lib/region-distance";
import type { createAdminClient } from "@/lib/supabase/server";

const HISTORY_MS = 30 * 86400000;
const MAX_LOCAL_DISTANCE_KM = 90;
const MAX_WIDENED_DISTANCE_KM = 180;
const MAX_RANKED_CANDIDATES = 48;
const MAX_UNRESOLVED_HISTORY_IDS = 4096;
export const SINGLE_REFRESH_VALIDATION_BATCH = 12;
export const SINGLE_REFRESH_TABLE = "dating_1on1_single_candidate_swaps";

type Person = RecommendationCandidate & { user_id: string };
export type SingleCandidateSwap = {
  generation_key: string;
  from_candidate_card_id: string;
  to_candidate_card_id: string;
  to_candidate_user_id: string;
  created_at: string;
};
type SwapRead = { kind: "ready"; rows: SingleCandidateSwap[]; latestAt: string | null } | { kind: "missing" | "error" };
export type SingleCandidateRefreshRequest = {
  sourceCardId: string;
  generationKey: string;
  plannedAt: string;
  signal?: AbortSignal;
} & (
  { mode: "replace"; fromCandidateCardId: string } |
  { mode: "availability"; previousCandidateCardIds?: readonly string[] }
);

export async function readSingleCandidateSwaps(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<SwapRead> {
  try {
    const { data, error, count } = await admin.from(SINGLE_REFRESH_TABLE)
      .select("generation_key,from_candidate_card_id,to_candidate_card_id,to_candidate_user_id,created_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(500);
    if (error) return { kind: ["42P01", "PGRST205"].includes(error.code) ? "missing" : "error" };
    if (!Array.isArray(data) || (count != null ? count !== data.length : data.length >= 500)) return { kind: "error" };
    const rows = data as SingleCandidateSwap[];
    if (rows.some(row => !Number.isFinite(Date.parse(row.created_at)))) return { kind: "error" };
    return { kind: "ready", rows, latestAt: rows[0]?.created_at ?? null };
  } catch {
    // Additive rollout: absent storage is never allowed to break normal reads.
    return { kind: "error" };
  }
}

export async function resolvePreviouslyDeliveredUsers(admin: ReturnType<typeof createAdminClient>, cardIds: Set<string>, current: Person[]) {
  const owners = new Set<string>();
  const knownIds = new Set<string>();
  for (const card of current) if (cardIds.has(card.id)) {
    knownIds.add(card.id);
    owners.add(card.user_id);
  }
  const historicalIds = [...cardIds].filter(id => !knownIds.has(id));
  if (historicalIds.length > MAX_UNRESOLVED_HISTORY_IDS) throw new Error("Single refresh history exceeds its read bound");
  // Include archived revisions; a new profile number does not make an older
  // page delivery new. Project only stable member IDs, never profile details.
  for (let offset = 0; offset < historicalIds.length; offset += 200) {
    const { data, error } = await admin.from("dating_1on1_cards").select("id,user_id").in("id", historicalIds.slice(offset, offset + 200));
    if (error) throw error;
    for (const row of data ?? []) if (typeof row.user_id === "string") owners.add(row.user_id);
  }
  return owners;
}

export function singleCandidateGenerationKey(source: { id: string; sex: string; birth_year: number; region: string }, pageAt: number, refreshAt?: string | null) {
  return createHash("sha256")
    .update(JSON.stringify([source.id, recommendationSourceKey(source), pageAt, refreshAt ? Date.parse(refreshAt) : null]))
    .digest("hex");
}

export function applySingleCandidateSwaps<T extends Person>(
  source: Person, main: T[], other: Person[], available: T[], swaps: SingleCandidateSwap[], generationKey: string,
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
    if (!next || next.user_id !== swap.to_candidate_user_id || occupied.has(next.user_id) ||
      singleCandidateDistance(source, next) == null || !isCandidateInSourceAgeRange(source, next)) return [];
    occupied.add(next.user_id);
    return [next];
  });
}

export function repeatSingleCandidateIds(
  main: Person[], impressions: CandidateImpression[], swaps: SingleCandidateSwap[], generationKey: string, pageAt: number, now: number,
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
  const eligible = pool.flatMap(card => {
    if (seenUsers.has(card.user_id) || excludedUserIds.has(card.user_id) ||
      priorCardIds.has(card.id) || !isCandidateInSourceAgeRange(source, card)) return [];
    const km = singleCandidateDistance(source, card);
    return km == null ? [] : [{card, km}];
  }).sort((a, b) => a.km - b.km ||
    Date.parse(b.card.created_at) - Date.parse(a.card.created_at) || a.card.id.localeCompare(b.card.id));
  return eligible.slice(0, MAX_RANKED_CANDIDATES).map(entry => entry.card);
}

function singleCandidateDistance(source: Pick<Person, "region">, candidate: Pick<Person, "region">) {
  const km = getRegionDistanceMeta(source.region, candidate.region).distanceKm;
  return km != null && Number.isFinite(km) && km <= MAX_WIDENED_DISTANCE_KM ? km : null;
}

export function singleCandidateWidened(source: Pick<Person, "region">, candidate: Pick<Person, "region">) {
  return (singleCandidateDistance(source, candidate) ?? 0) > MAX_LOCAL_DISTANCE_KM;
}

import { EXPANSION_LIMIT, EXPANSION_TABLE, isWinterExpansionEnabled } from "@/lib/dating-1on1-expansion";
import { loadOneOnOneRecommendations } from "@/lib/dating-1on1-recommendation-service";
import type { createAdminClient } from "@/lib/supabase/server";
import { getKstDateString } from "@/lib/weekly";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type OneOnOneWinterAvailability = {
  source_card_id: string;
  day_key: string;
  count: number;
  repeated: boolean;
  claimed: boolean;
};

// Read-only and count-only, also used by the optional new-candidate watcher.
// Never call the shared claim RPC or return profile details from this function.
export async function readOneOnOneWinterAvailability(
  admin: ReturnType<typeof createAdminClient>, user: { id: string }, sourceId?: string, expectedDay?: string,
): Promise<OneOnOneWinterAvailability | null> {
  const day = getKstDateString();
  if ((sourceId && !UUID.test(sourceId)) || (expectedDay && day !== expectedDay) || !isWinterExpansionEnabled(user.id)) return null;
  try {
    const saved = await admin.from(EXPANSION_TABLE).select("source_card_id,candidate_ids")
      .eq("user_id", user.id).eq("day_key", day).maybeSingle();
    if (saved.error || getKstDateString() !== day) return null;
    if (saved.data) {
      if (typeof saved.data.source_card_id !== "string" || !UUID.test(saved.data.source_card_id) ||
          (sourceId && sourceId !== saved.data.source_card_id) || !Array.isArray(saved.data.candidate_ids)) return null;
      if (saved.data.candidate_ids.length || expectedDay)
        return { source_card_id: saved.data.source_card_id, day_key: day, count: 0, repeated: false, claimed: true };
    }
    const response = await loadOneOnOneRecommendations(admin, user, undefined, { winter: { sourceCardId: sourceId, countOnly: true } });
    if (!response.ok || getKstDateString() !== day) return null;
    const value = await response.json() as { source_card_id?: string; count?: number; repeated?: boolean };
    if (typeof value.source_card_id !== "string" || !UUID.test(value.source_card_id) ||
        (sourceId && sourceId !== value.source_card_id) || typeof value.repeated !== "boolean" ||
        typeof value.count !== "number" || !Number.isInteger(value.count) || value.count < 0 || value.count > EXPANSION_LIMIT ||
        (!value.repeated && value.count !== 0)) return null;
    // An already claimed empty list cannot be opened twice, but a repeat viewer
    // can still ask to be notified when another day's recommendations qualify.
    if (saved.data && saved.data.source_card_id !== value.source_card_id) return null;
    return { source_card_id: value.source_card_id, day_key: day, count: saved.data ? 0 : value.count,
      repeated: value.repeated, claimed: Boolean(saved.data) };
  } catch {
    return null;
  }
}

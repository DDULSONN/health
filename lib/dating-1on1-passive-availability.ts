import { DATING_ONE_ON_ONE_ACTIVE_STATUSES } from "@/lib/dating-1on1";
import { parseDatingBirthYear } from "@/lib/dating-age";
import { fetchRecommendationProfiles } from "@/lib/dating-1on1-recommendation-data";
import type { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// A signed deck's issued time makes this a conservative signal of a new
// registration, not a recommendation or a source of actionable IDs. Only the
// authoritative path may turn a potential arrival into an availability notice.
export async function probeOneOnOneRegistrationAfterDeck(admin: Admin, input: {
  userId: string;
  sourceCardId: string;
  issuedAt: number;
  now: number;
  signal: AbortSignal;
}): Promise<"stale" | "ineligible" | "unchanged" | "verify" | "unavailable"> {
  const { userId, sourceCardId, issuedAt, now, signal } = input;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(now) || issuedAt > now || signal.aborted) return "unavailable";
  const [own, profiles] = await Promise.all([
    admin.from("dating_1on1_cards").select("id,sex,birth_year")
      .eq("user_id", userId).in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
    fetchRecommendationProfiles(admin, [userId]),
  ]);
  if (own.error || signal.aborted) return "unavailable";
  if (own.data?.id !== sourceCardId) return "stale";
  const viewer = profiles.get(userId);
  if (!viewer?.phone || viewer.banned || parseDatingBirthYear(own.data.birth_year, now) == null ||
    !["male", "female"].includes(own.data.sex)) return "ineligible";

  // The existing created_at index bounds the new-registration date window;
  // read only one qualifying ID and never return it across the route boundary.
  const probe = await admin.from("dating_1on1_cards").select("id")
    .eq("sex", own.data.sex === "male" ? "female" : "male").neq("user_id", userId)
    .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
    .gt("created_at", new Date(issuedAt).toISOString()).lte("created_at", new Date(now).toISOString())
    .order("created_at", { ascending: false }).limit(1);
  if (probe.error || signal.aborted || !Array.isArray(probe.data)) return "unavailable";
  return probe.data.length ? "verify" : "unchanged";
}

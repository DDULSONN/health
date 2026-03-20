import { syncOpenCardQueue } from "@/lib/dating-cards-queue";
import { getOpenCardLimitBySex } from "@/lib/dating-open";
import { extractCityFromRegion } from "@/lib/region-city";
import { createAdminClient } from "@/lib/supabase/server";
import { publicCachedJson } from "@/lib/http-cache";
import { shouldRunAtMostEvery } from "@/lib/throttled-task";

const OPEN_CARD_STATS_SYNC_INTERVAL_SEC = 45;

type RegionDistribution = { city: string; count: number };

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("could not find the table")
  );
}

async function countPublic(adminClient: ReturnType<typeof createAdminClient>, sex: "male" | "female") {
  let { count, error } = await adminClient
    .from("dating_cards")
    .select("id", { head: true, count: "exact" })
    .eq("sex", sex)
    .eq("status", "public")
    .gt("expires_at", new Date().toISOString());

  if (error && isMissingColumnError(error)) {
    const legacy = await adminClient
      .from("dating_cards")
      .select("id", { head: true, count: "exact" })
      .eq("sex", sex)
      .eq("status", "public");
    count = legacy.count;
    error = legacy.error;
  }

  if (error) throw error;
  return count ?? 0;
}

async function countPending(adminClient: ReturnType<typeof createAdminClient>, sex: "male" | "female") {
  const { count, error } = await adminClient
    .from("dating_cards")
    .select("id", { head: true, count: "exact" })
    .eq("sex", sex)
    .eq("status", "pending");

  if (error) throw error;
  return count ?? 0;
}

async function pendingRegionDistribution(
  adminClient: ReturnType<typeof createAdminClient>,
  sex: "male" | "female"
): Promise<RegionDistribution[]> {
  const { data, error } = await adminClient
    .from("dating_cards")
    .select("region")
    .eq("sex", sex)
    .eq("status", "pending")
    .limit(5000);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const counts = new Map<string, number>();

  for (const row of rows) {
    const city = extractCityFromRegion((row as { region?: string | null }).region ?? null);
    if (!city) continue;
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "ko"))
    .slice(0, 8);
}

async function countAcceptedMatches(adminClient: ReturnType<typeof createAdminClient>) {
  const acceptedRes = await adminClient
    .from("dating_card_applications")
    .select("id", { head: true, count: "exact" })
    .eq("status", "accepted");

  if (acceptedRes.error) throw acceptedRes.error;

  const swipeRes = await adminClient
    .from("dating_card_swipe_matches")
    .select("id", { head: true, count: "exact" });

  if (swipeRes.error && !isMissingRelationError(swipeRes.error)) {
    throw swipeRes.error;
  }

  const acceptedCount = acceptedRes.count ?? 0;
  const swipeCount = isMissingRelationError(swipeRes.error) ? 0 : (swipeRes.count ?? 0);
  return acceptedCount + swipeCount;
}

export async function GET() {
  const adminClient = createAdminClient();
  const requestId = crypto.randomUUID();

  try {
    if (await shouldRunAtMostEvery("dating:open-cards:stats-sync", OPEN_CARD_STATS_SYNC_INTERVAL_SEC)) {
      await syncOpenCardQueue(adminClient);
    }
  } catch (error) {
    console.error("[GET /api/dating/cards/queue-stats] queue sync failed", {
      requestId,
      error,
    });
  }

  const safeCount = async (label: string, fn: () => Promise<number>) => {
    try {
      return await fn();
    } catch (error) {
      console.error("[GET /api/dating/cards/queue-stats] count failed", { requestId, label, error });
      return 0;
    }
  };

  try {
    const [malePublic, femalePublic, malePending, femalePending, malePendingRegions, femalePendingRegions, acceptedMatches] = await Promise.all([
      safeCount("malePublic", () => countPublic(adminClient, "male")),
      safeCount("femalePublic", () => countPublic(adminClient, "female")),
      safeCount("malePending", () => countPending(adminClient, "male")),
      safeCount("femalePending", () => countPending(adminClient, "female")),
      pendingRegionDistribution(adminClient, "male").catch((error) => {
        console.error("[GET /api/dating/cards/queue-stats] region failed", { requestId, sex: "male", error });
        return [];
      }),
      pendingRegionDistribution(adminClient, "female").catch((error) => {
        console.error("[GET /api/dating/cards/queue-stats] region failed", { requestId, sex: "female", error });
        return [];
      }),
      safeCount("acceptedMatches", () => countAcceptedMatches(adminClient)),
    ]);

    return publicCachedJson(
      {
        male: {
          public_count: malePublic,
          pending_count: malePending,
          slot_limit: getOpenCardLimitBySex("male"),
          pending_regions: malePendingRegions,
        },
        female: {
          public_count: femalePublic,
          pending_count: femalePending,
          slot_limit: getOpenCardLimitBySex("female"),
          pending_regions: femalePendingRegions,
        },
        accepted_matches_count: acceptedMatches,
      },
      { sMaxAge: 20, staleWhileRevalidate: 40 }
    );
  } catch (error) {
    console.error("[GET /api/dating/cards/queue-stats] failed", { requestId, error });
    return publicCachedJson(
      {
        male: { public_count: 0, pending_count: 0, slot_limit: getOpenCardLimitBySex("male"), pending_regions: [] },
        female: { public_count: 0, pending_count: 0, slot_limit: getOpenCardLimitBySex("female"), pending_regions: [] },
        accepted_matches_count: 0,
      },
      { status: 200, sMaxAge: 20, staleWhileRevalidate: 40 }
    );
  }
}

import { syncOpenCardQueue } from "@/lib/dating-cards-queue";
import { countCumulativeOneOnOneApplicants, countCumulativeOneOnOneMatches } from "@/lib/dating-1on1-metrics";
import { countCumulativeTotalDatingMatches } from "@/lib/dating-match-metrics";
import {
  getKstDayRangeUtc,
  getOpenCardEffectiveLimitBySex,
  getOpenCardLimitBySex,
  readOpenCardPublicSlotSetting,
} from "@/lib/dating-open";
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
  return countCumulativeTotalDatingMatches(adminClient);
}

async function countOneOnOneApplicants(adminClient: ReturnType<typeof createAdminClient>) {
  return countCumulativeOneOnOneApplicants(adminClient);
}

async function countOneOnOneMatches(adminClient: ReturnType<typeof createAdminClient>) {
  return countCumulativeOneOnOneMatches(adminClient);
}

async function countTodayDatingReactions(adminClient: ReturnType<typeof createAdminClient>) {
  const { startUtcIso, endUtcIso } = getKstDayRangeUtc();
  const [openRes, paidRes, swipeLikeRes, oneOnOneRes] = await Promise.all([
    adminClient
      .from("dating_card_applications")
      .select("id", { head: true, count: "exact" })
      .gte("created_at", startUtcIso)
      .lt("created_at", endUtcIso),
    adminClient
      .from("dating_paid_card_applications")
      .select("id", { head: true, count: "exact" })
      .gte("created_at", startUtcIso)
      .lt("created_at", endUtcIso),
    adminClient
      .from("dating_card_swipes")
      .select("id", { head: true, count: "exact" })
      .eq("action", "like")
      .gte("created_at", startUtcIso)
      .lt("created_at", endUtcIso),
    adminClient
      .from("dating_1on1_match_proposals")
      .select("id", { head: true, count: "exact" })
      .eq("state", "mutual_accepted")
      .gte("source_final_responded_at", startUtcIso)
      .lt("source_final_responded_at", endUtcIso),
  ]);

  if (openRes.error) throw openRes.error;
  if (paidRes.error) throw paidRes.error;
  if (swipeLikeRes.error) throw swipeLikeRes.error;
  if (oneOnOneRes.error) throw oneOnOneRes.error;

  const openCardApplications = openRes.count ?? 0;
  const paidCardApplications = paidRes.count ?? 0;
  const swipeLikes = swipeLikeRes.count ?? 0;
  const oneOnOneMutualMatches = oneOnOneRes.count ?? 0;

  return {
    total: openCardApplications + paidCardApplications + swipeLikes + oneOnOneMutualMatches,
    openCardApplications,
    paidCardApplications,
    swipeLikes,
    oneOnOneMutualMatches,
  };
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
    const [
      malePublic,
      femalePublic,
      malePending,
      femalePending,
      malePendingRegions,
      femalePendingRegions,
      acceptedMatches,
      oneOnOneApplicants,
      oneOnOneMatches,
      todayDatingReactions,
      publicSlotSetting,
      maleSlotLimit,
      femaleSlotLimit,
    ] = await Promise.all([
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
      safeCount("oneOnOneApplicants", () => countOneOnOneApplicants(adminClient)),
      safeCount("oneOnOneMatches", () => countOneOnOneMatches(adminClient)),
      countTodayDatingReactions(adminClient).catch((error) => {
        console.error("[GET /api/dating/cards/queue-stats] count failed", { requestId, label: "todayDatingReactions", error });
        return { total: 0, openCardApplications: 0, paidCardApplications: 0, swipeLikes: 0, oneOnOneMutualMatches: 0 };
      }),
      readOpenCardPublicSlotSetting(adminClient),
      getOpenCardEffectiveLimitBySex(adminClient, "male"),
      getOpenCardEffectiveLimitBySex(adminClient, "female"),
    ]);

    return publicCachedJson(
      {
        male: {
          public_count: malePublic,
          pending_count: malePending,
          slot_limit: maleSlotLimit,
          base_slot_limit: getOpenCardLimitBySex("male"),
          extra_public_slots: publicSlotSetting.maleExtra,
          pending_regions: malePendingRegions,
        },
        female: {
          public_count: femalePublic,
          pending_count: femalePending,
          slot_limit: femaleSlotLimit,
          base_slot_limit: getOpenCardLimitBySex("female"),
          extra_public_slots: publicSlotSetting.femaleExtra,
          pending_regions: femalePendingRegions,
        },
        accepted_matches_count: acceptedMatches,
        recent_open_card_applications_24h_count: todayDatingReactions.total,
        today_open_card_applications_count: todayDatingReactions.openCardApplications,
        today_paid_card_applications_count: todayDatingReactions.paidCardApplications,
        today_swipe_likes_count: todayDatingReactions.swipeLikes,
        today_one_on_one_mutual_matches_count: todayDatingReactions.oneOnOneMutualMatches,
        today_dating_reactions_count: todayDatingReactions.total,
        one_on_one_applicants_count: oneOnOneApplicants,
        one_on_one_matches_count: oneOnOneMatches,
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
        recent_open_card_applications_24h_count: 0,
        today_open_card_applications_count: 0,
        today_paid_card_applications_count: 0,
        today_swipe_likes_count: 0,
        today_one_on_one_mutual_matches_count: 0,
        today_dating_reactions_count: 0,
        one_on_one_applicants_count: 0,
        one_on_one_matches_count: 0,
      },
      { status: 200, sMaxAge: 20, staleWhileRevalidate: 40 }
    );
  }
}

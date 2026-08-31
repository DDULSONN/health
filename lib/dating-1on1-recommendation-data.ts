import {
  DATING_ONE_ON_ONE_ACTIVE_STATUSES,
  toDatingOneOnOneCardDetail,
} from "@/lib/dating-1on1";
import { normalizeDatingContactPhone } from "@/lib/dating-contact-blocks";
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;
const BATCH_SIZE = 500;
const USER_BATCH_SIZE = 200;
const SUMMARY_FIELDS = "id,user_id,sex,birth_year,region,status,created_at,recommendation_refresh_used_at,phone";
const DETAIL_FIELDS = "id,user_id,sex,name,birth_year,height_cm,job,region,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,created_at,recommendation_refresh_used_at,photo_paths";

export type RecommendationCardRow = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  birth_year: number;
  region: string;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  created_at: string;
  recommendation_refresh_used_at?: string | null;
  priority_boost_expires_at?: string | null;
  phone: string | null;
};

export async function fetchActiveRecommendationRows(
  admin: AdminClient,
  scope: { userId: string } | { sexes: Array<"male" | "female">; excludeUserId: string }
) {
  if ("sexes" in scope && scope.sexes.length === 0) return [];
  const rows: RecommendationCardRow[] = [];
  let hasBoostColumn = true;
  for (let from = 0; ; from += BATCH_SIZE) {
    const read = (includeBoost: boolean) => {
      let query = admin.from("dating_1on1_cards")
        .select(includeBoost ? `${SUMMARY_FIELDS},priority_boost_expires_at` : SUMMARY_FIELDS)
        .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES]);
      query = "userId" in scope
        ? query.eq("user_id", scope.userId)
        : query.in("sex", scope.sexes).neq("user_id", scope.excludeUserId);
      return query.order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(from, from + BATCH_SIZE - 1);
    };
    let result = await read(hasBoostColumn);
    if (hasBoostColumn && result.error && ["42703", "PGRST204"].includes(result.error.code) &&
      result.error.message.includes("priority_boost_expires_at")) {
      hasBoostColumn = false;
      result = await read(false);
    }
    if (result.error) throw result.error;
    const batch = (result.data ?? []) as unknown as RecommendationCardRow[];
    rows.push(...batch);
    if (batch.length < BATCH_SIZE) return rows;
  }
}

export async function fetchRecommendationProfiles(admin: AdminClient, userIds: string[]) {
  const uniqueIds = [...new Set(userIds)];
  const profiles = new Map<string, { phone: string | null; banned: boolean }>();
  for (let start = 0; start < uniqueIds.length; start += USER_BATCH_SIZE) {
    const { data, error } = await admin.from("profiles").select("user_id,phone_e164,is_banned")
      .in("user_id", uniqueIds.slice(start, start + USER_BATCH_SIZE));
    // Eligibility checks fail closed. Do not treat a failed ban lookup as safe.
    if (error) throw error;
    for (const row of data ?? []) {
      profiles.set(row.user_id, {
        phone: normalizeDatingContactPhone(String(row.phone_e164 ?? "")) || null,
        banned: row.is_banned === true,
      });
    }
  }
  return profiles;
}

export async function fetchRecommendationDetails(admin: AdminClient, cardIds: string[]) {
  const uniqueIds = [...new Set(cardIds)];
  const details = new Map<string, ReturnType<typeof toDatingOneOnOneCardDetail>>();
  for (let start = 0; start < uniqueIds.length; start += USER_BATCH_SIZE) {
    const { data, error } = await admin.from("dating_1on1_cards").select(DETAIL_FIELDS)
      .in("id", uniqueIds.slice(start, start + USER_BATCH_SIZE))
      .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES]);
    if (error) throw error;
    for (const row of data ?? []) {
      // Generate image URLs only for the cards that will actually be returned.
      details.set(row.id, toDatingOneOnOneCardDetail(row));
    }
  }
  return details;
}

export async function fetchRecommendationActivity(admin: AdminClient, userIds: string[], nowMs = Date.now()) {
  const uniqueIds = [...new Set(userIds)];
  const since = new Date(nowMs - 7 * 86400000).toISOString();
  const activity = new Map<string, string>();
  // Do not count receiving an unsolicited proposal or admin updated_at as activity.
  // These timestamps record the participant who actually selected/responded.
  const readActions = async (
    chunk: string[],
    userColumn: "source_user_id" | "candidate_user_id",
    timeColumn: "source_selected_at" | "candidate_responded_at"
  ) => {
    let remainingIds = chunk;
    while (remainingIds.length > 0) {
      const { data, error } = await admin.from("dating_1on1_match_proposals")
        .select(`id,${userColumn},${timeColumn}`).in(userColumn, remainingIds).gte(timeColumn, since)
        .lte(timeColumn, new Date(nowMs).toISOString())
        .order(timeColumn, { ascending: false }).order("id", { ascending: false })
        .range(0, BATCH_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<Record<string, string>>;
      for (const row of rows) {
        const userId = row[userColumn];
        const value = row[timeColumn];
        const timestamp = Date.parse(value);
        if (!userId || !Number.isFinite(timestamp) || timestamp > nowMs) continue;
        if (timestamp > Date.parse(activity.get(userId) ?? "1970-01-01")) activity.set(userId, value);
      }
      if (rows.length < BATCH_SIZE) return;
      // One recent action is sufficient for activity ranking. Once a member is
      // found, exclude them from the next batch instead of reading their entire
      // activity history (one busy member may have thousands of proposals).
      const foundIds = new Set(rows.map((row) => row[userColumn]));
      const nextIds = remainingIds.filter((id) => !foundIds.has(id));
      if (nextIds.length === remainingIds.length) throw new Error("Activity query made no progress.");
      remainingIds = nextIds;
    }
  };
  for (let start = 0; start < uniqueIds.length; start += USER_BATCH_SIZE) {
    const chunk = uniqueIds.slice(start, start + USER_BATCH_SIZE);
    await Promise.all([
      readActions(chunk, "source_user_id", "source_selected_at"),
      readActions(chunk, "candidate_user_id", "candidate_responded_at"),
    ]);
  }
  return activity;
}

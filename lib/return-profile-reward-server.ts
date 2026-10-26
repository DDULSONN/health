import type { SupabaseClient } from "@supabase/supabase-js";
import { isReturnProfileReward, type ReturnProfileReward } from "@/lib/return-profile-reward";
import { isFirstProfileReward, type ProfileReward } from "@/lib/first-profile-reward";

export async function readReturnProfileReward(admin: SupabaseClient, userId: string, claim = false): Promise<ReturnProfileReward | null> {
  const { data, error } = await admin.rpc(claim ? "claim_return_profile_reward" : "return_profile_reward_status", {
    p_user_id: userId,
  }).abortSignal(AbortSignal.timeout(4000));
  // Optional migration: no unverified reward promise before SQL is installed/activated.
  if (error && ["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code)) return null;
  if (error) throw new Error("RETURN_REWARD_UNAVAILABLE");
  if (data === null) return null;
  if (!isReturnProfileReward(data)) throw new Error("RETURN_REWARD_INVALID_RESPONSE");
  return data;
}

export async function grantReturnProfileRewardSafely(admin: SupabaseClient, userId: string) {
  try { await readProfileReward(admin, userId, true); }
  catch { console.warn("[return-profile-reward] reward deferred; registration is preserved"); }
}

// One existing banner/API, not a second auth subscription or client-side request.
// Preserve the five-credit promise; the new SQL also excludes that fixed cohort.
export async function readProfileReward(admin: SupabaseClient, userId: string, claim = false): Promise<ProfileReward | null> {
  const returning = await readReturnProfileReward(admin, userId, claim);
  if (returning) return returning;
  const { data, error } = await admin.rpc(claim ? "claim_first_profile_reward" : "first_profile_reward_status", {
    p_user_id: userId,
  }).abortSignal(AbortSignal.timeout(4000));
  if (error && ["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code)) return null;
  if (error) throw new Error("FIRST_REWARD_UNAVAILABLE");
  if (data === null) return null;
  if (!isFirstProfileReward(data)) throw new Error("FIRST_REWARD_INVALID_RESPONSE");
  return data;
}

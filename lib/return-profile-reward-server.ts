import type { SupabaseClient } from "@supabase/supabase-js";
import { isReturnProfileReward, type ReturnProfileReward } from "@/lib/return-profile-reward";

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
  try { await readReturnProfileReward(admin, userId, true); }
  catch { console.warn("[return-profile-reward] reward deferred; registration is preserved"); }
}

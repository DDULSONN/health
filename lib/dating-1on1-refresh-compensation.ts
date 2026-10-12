import type { createAdminClient } from "@/lib/supabase/server";

export const REFRESH_COMPENSATION_TABLE = "dating_1on1_refresh_compensations";

// One indexed account lookup, never a global scan or a client-writable balance.
export async function readRefreshCompensation(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const result = await admin.from(REFRESH_COMPENSATION_TABLE)
    .select("granted_count,used_count").eq("user_id", userId);
  if (result.error) {
    // Rolling deployment before this optional additive migration has no grants.
    if (["42P01", "PGRST205"].includes(result.error.code)) return 0;
    throw result.error;
  }
  let remaining = 0;
  for (const row of result.data ?? []) {
    if (!Number.isSafeInteger(row.granted_count) || !Number.isSafeInteger(row.used_count) ||
      row.granted_count < 1 || row.granted_count > 20 || row.used_count < 0 || row.used_count > row.granted_count) {
      throw new Error("Invalid compensation balance");
    }
    remaining += row.granted_count - row.used_count;
  }
  return remaining;
}

// The transaction returns total remaining without changing its stable RPC signature.
export function compensationFromRefreshResult(limit: number, used: number, remaining: number) {
  return Math.max(0, remaining - Math.max(0, limit - used));
}

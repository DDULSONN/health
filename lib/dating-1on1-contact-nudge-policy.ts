import type { createAdminClient } from "@/lib/supabase/server";

// The database trigger remains authoritative. During a rolling deployment, an
// old/missing policy RPC keeps the old waiting period rather than promising a
// send that the installed trigger would reject. This never affects payment.
export async function loadOneOnOneContactNudgeDelayHours(admin: Pick<ReturnType<typeof createAdminClient>, "rpc">) {
  try {
    const result = await admin.rpc("dating_1on1_contact_nudge_delay_hours").abortSignal(AbortSignal.timeout(2000));
    return !result.error && result.data === 0 ? 0 : 24;
  } catch {
    return 24;
  }
}

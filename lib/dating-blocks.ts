import type { SupabaseClient } from "@supabase/supabase-js";

type BlockRow = {
  blocker_user_id: string;
  blocked_user_id: string;
  reason: string | null;
  created_at: string;
};

export function isMissingDatingBlocksTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("dating_user_blocks") ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
}

export async function getDatingBlockedUserIds(
  adminClient: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const res = await adminClient
    .from("dating_user_blocks")
    .select("blocker_user_id, blocked_user_id")
    .or(`blocker_user_id.eq.${userId},blocked_user_id.eq.${userId}`)
    .limit(5000);

  if (res.error) {
    if (isMissingDatingBlocksTableError(res.error)) {
      return new Set();
    }
    throw res.error;
  }

  const blockedIds = new Set<string>();
  for (const row of (res.data ?? []) as BlockRow[]) {
    const otherUserId = row.blocker_user_id === userId ? row.blocked_user_id : row.blocker_user_id;
    if (otherUserId) blockedIds.add(otherUserId);
  }
  return blockedIds;
}

export async function hasDatingBlockBetween(
  adminClient: SupabaseClient,
  userId: string,
  otherUserId: string
): Promise<boolean> {
  if (!userId || !otherUserId || userId === otherUserId) return false;

  const res = await adminClient
    .from("dating_user_blocks")
    .select("id")
    .or(
      `and(blocker_user_id.eq.${userId},blocked_user_id.eq.${otherUserId}),and(blocker_user_id.eq.${otherUserId},blocked_user_id.eq.${userId})`
    )
    .limit(1)
    .maybeSingle();

  if (res.error) {
    if (isMissingDatingBlocksTableError(res.error)) {
      return false;
    }
    throw res.error;
  }

  return Boolean(res.data?.id);
}

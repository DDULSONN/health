import type { SupabaseClient } from "@supabase/supabase-js";

type AdminUserBlockPairRow = {
  user_a_id: string | null;
  user_b_id: string | null;
};

export type OneOnOneAdminUserBlockPairSet = Set<string>;

const ADMIN_USER_BLOCK_BATCH_SIZE = 500;

export function getOneOnOneAdminUserBlockPairKey(userAId: string, userBId: string) {
  const userIds = [String(userAId ?? "").trim(), String(userBId ?? "").trim()].filter(Boolean).sort();
  return userIds.length === 2 ? `${userIds[0]}:${userIds[1]}` : "";
}

export function isMissingOneOnOneAdminUserBlocksTableError(
  error: { message?: string; code?: string } | null | undefined
) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "42P01" ||
    message.includes("dating_1on1_admin_user_blocks") ||
    message.includes("schema cache")
  );
}

export async function getOneOnOneAdminUserBlockPairSetForUsers(
  adminClient: SupabaseClient,
  userIds: string[]
): Promise<OneOnOneAdminUserBlockPairSet> {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const pairSet: OneOnOneAdminUserBlockPairSet = new Set();
  if (uniqueUserIds.length === 0) return pairSet;

  const addRows = (rows: AdminUserBlockPairRow[]) => {
    for (const row of rows) {
      const key = getOneOnOneAdminUserBlockPairKey(row.user_a_id ?? "", row.user_b_id ?? "");
      if (key) pairSet.add(key);
    }
  };

  for (let start = 0; start < uniqueUserIds.length; start += ADMIN_USER_BLOCK_BATCH_SIZE) {
    const chunk = uniqueUserIds.slice(start, start + ADMIN_USER_BLOCK_BATCH_SIZE);
    const [aRes, bRes] = await Promise.all([
      adminClient
        .from("dating_1on1_admin_user_blocks")
        .select("user_a_id,user_b_id")
        .in("user_a_id", chunk),
      adminClient
        .from("dating_1on1_admin_user_blocks")
        .select("user_a_id,user_b_id")
        .in("user_b_id", chunk),
    ]);

    for (const res of [aRes, bRes]) {
      if (res.error) {
        if (isMissingOneOnOneAdminUserBlocksTableError(res.error)) return new Set();
        throw res.error;
      }
      addRows((res.data ?? []) as AdminUserBlockPairRow[]);
    }
  }

  return pairSet;
}

export function isOneOnOneAdminUserBlockedPair({
  sourceUserId,
  candidateUserId,
  pairSet,
}: {
  sourceUserId: string;
  candidateUserId: string;
  pairSet: OneOnOneAdminUserBlockPairSet;
}) {
  if (!sourceUserId || !candidateUserId || sourceUserId === candidateUserId) return false;
  return pairSet.has(getOneOnOneAdminUserBlockPairKey(sourceUserId, candidateUserId));
}

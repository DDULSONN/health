import type { SupabaseClient } from "@supabase/supabase-js";
import { DATING_ONE_ON_ONE_ACTIVE_STATUSES } from "@/lib/dating-1on1";

const USER_ARCHIVED_TAG = "one_on_one_user_deleted";
const STALE_PHONE_ARCHIVED_TAG = "one_on_one_stale_phone_archived";

type ActiveIdentityCardRow = {
  id: string;
  admin_tags: unknown;
};

function appendTags(value: unknown, ...nextTags: string[]) {
  const currentTags = Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  return Array.from(new Set([...nextTags, ...currentTags])).slice(0, 20);
}

export async function reconcileOneOnOnePhoneIdentity(options: {
  admin: SupabaseClient;
  userId: string;
  phoneE164: string;
}) {
  const { admin, userId, phoneE164 } = options;
  const ownerRes = await admin
    .from("profiles")
    .select("user_id")
    .eq("phone_e164", phoneE164)
    .eq("phone_verified", true)
    .neq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (ownerRes.error) throw ownerRes.error;
  if (ownerRes.data) {
    return { conflictingVerifiedOwner: true, archivedCardCount: 0 };
  }

  const staleCardsRes = await admin
    .from("dating_1on1_cards")
    .select("id,admin_tags")
    .eq("phone", phoneE164)
    .neq("user_id", userId)
    .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES]);
  if (staleCardsRes.error) throw staleCardsRes.error;

  let archivedCardCount = 0;
  for (const card of (staleCardsRes.data ?? []) as ActiveIdentityCardRow[]) {
    const nowIso = new Date().toISOString();
    const archiveRes = await admin
      .from("dating_1on1_cards")
      .update({
        status: "rejected",
        admin_tags: appendTags(card.admin_tags, USER_ARCHIVED_TAG, STALE_PHONE_ARCHIVED_TAG),
        updated_at: nowIso,
      })
      .eq("id", card.id)
      .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
      .select("id")
      .maybeSingle();
    if (archiveRes.error) throw archiveRes.error;
    if (archiveRes.data) archivedCardCount += 1;
  }

  return { conflictingVerifiedOwner: false, archivedCardCount };
}

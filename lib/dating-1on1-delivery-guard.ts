import type { SupabaseClient } from "@supabase/supabase-js";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactPhoneBlockBetween } from "@/lib/dating-contact-blocks";
import { isCurrentOneOnOneNotification } from "@/lib/dating-1on1-notification-guard";
import { fetchMarketingUnsubscribedUserIds } from "@/lib/marketing-email";

// External messages cannot be recalled. Recheck both accounts and relationship
// immediately before delivery; an unavailable safety check is NOT permission.
export async function canDeliverOneOnOneNotification(
  admin: SupabaseClient, matchId: string, type: string, recipientId: string,
): Promise<boolean> {
  try {
    if (!await isCurrentOneOnOneNotification(admin, matchId, type, recipientId)) return false;
    const match = await admin.from("dating_1on1_match_proposals")
      .select("source_user_id,candidate_user_id").eq("id", matchId).maybeSingle();
    if (match.error || !match.data) return false;
    const ids = [match.data.source_user_id, match.data.candidate_user_id];
    if (!ids.includes(recipientId) || ids.some(id => !id) || ids[0] === ids[1]) return false;
    const [profiles, blocked, contactBlocked, optedOut, ...accounts] = await Promise.all([
      admin.from("profiles").select("user_id,is_banned").in("user_id", ids),
      hasDatingBlockBetween(admin, ids[0], ids[1]),
      hasDatingContactPhoneBlockBetween(admin, ids[0], ids[1]),
      fetchMarketingUnsubscribedUserIds(admin, [recipientId], "dating_notifications"),
      ...ids.map(id => admin.auth.admin.getUserById(id)),
    ]);
    if (profiles.error || blocked || contactBlocked || optedOut.has(recipientId)) return false;
    if (ids.some(id => !profiles.data?.some(profile => profile.user_id === id && profile.is_banned !== true))) return false;
    if (accounts.some(result => {
      const user = result.data?.user as { deleted_at?: string | null; banned_until?: string | null } | null;
      return result.error || !user || user.deleted_at || Date.parse(user.banned_until ?? "") > Date.now();
    })) return false;
    return await isCurrentOneOnOneNotification(admin, matchId, type, recipientId);
  } catch {
    return false;
  }
}

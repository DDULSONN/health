import type { SupabaseClient } from "@supabase/supabase-js";
import { hashDatingContactBlockValue } from "@/lib/dating-contact-blocks";
import { hashOneOnOneBlockedPhone } from "@/lib/dating-1on1-phone-blocks";

export type PrivateChatInboxItem = {
  match_id: string; peer_name: string; last_message: string; last_message_at: string; unread_count: number;
};
export async function loadPrivateChatInbox(admin: SupabaseClient, userId: string): Promise<PrivateChatInboxItem[]> {
  const contexts = await admin.rpc("private_chat_contexts", { p_user: userId });
  if (contexts.error || !Array.isArray(contexts.data)) throw new Error("PRIVATE_INBOX_UNAVAILABLE");
  if (!contexts.data.length) return [];
  const params = contexts.data.map((row: { match_id: string; phones: string[]; instagram: string }) => ({
    match_id: row.match_id, phones: row.phones,
    contact_hashes: row.phones.map(phone => hashDatingContactBlockValue("phone", phone)),
    legacy_hashes: row.phones.map(phone => hashOneOnOneBlockedPhone(phone)),
    instagram_hash: hashDatingContactBlockValue("instagram", row.instagram),
  }));
  const result = await admin.rpc("private_chat_inbox", { p_user: userId, p_contexts: params });
  if (result.error || !Array.isArray(result.data)) throw new Error("PRIVATE_INBOX_UNAVAILABLE");
  return result.data as PrivateChatInboxItem[];
}

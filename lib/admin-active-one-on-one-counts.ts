import type { SupabaseClient } from "@supabase/supabase-js";
import { DATING_ONE_ON_ONE_ACTIVE_STATUSES } from "@/lib/dating-1on1";
import { parseDatingBirthYear } from "@/lib/dating-age";
import { normalizePhoneForOneOnOneBlock } from "@/lib/dating-1on1-phone-blocks";

export type ActiveOneOnOneCounts = { total: number; male: number; female: number };
type Card = {
  id: string;
  user_id: string;
  sex: string | null;
  phone: string | null;
  birth_year: number | null;
  created_at: string;
};
type Profile = { user_id: string; phone_e164: string | null; is_banned: boolean | null };
const PAGE_SIZE = 500;
const USER_BATCH_SIZE = 200;
const PROFILE_CONCURRENCY = 4;

// Admin-only, read-only aggregate. Never send identity rows or photos to the UI.
export async function fetchActiveOneOnOneCounts(
  admin: SupabaseClient,
  nowMs = Date.now(),
): Promise<ActiveOneOnOneCounts> {
  const cards: Card[] = [];
  let cursor: string | null = null;
  for (;;) {
    let query = admin.from("dating_1on1_cards")
      .select("id,user_id,sex,phone,birth_year,created_at")
      .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
      .order("id", { ascending: true }).limit(PAGE_SIZE);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw error; // Missing schema/read failures must not appear as zero members.
    const page = (data ?? []) as Card[];
    cards.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }

  const profiles = new Map<string, Profile>();
  const userIds = [...new Set(cards.map((card) => card.user_id))];
  for (let start = 0; start < userIds.length; start += USER_BATCH_SIZE * PROFILE_CONCURRENCY) {
    const batches = await Promise.all(Array.from({ length: PROFILE_CONCURRENCY }, async (_, index) => {
      const ids = userIds.slice(start + index * USER_BATCH_SIZE, start + (index + 1) * USER_BATCH_SIZE);
      if (ids.length === 0) return [];
      const { data, error } = await admin.from("profiles").select("user_id,phone_e164,is_banned").in("user_id", ids);
      if (error) throw error;
      return (data ?? []) as Profile[];
    }));
    for (const batch of batches) for (const profile of batch) profiles.set(profile.user_id, profile);
  }

  // Mirror the current-card identity rule without refetching the whole pool for
  // each member. A newer ineligible profile must not resurrect an older one.
  cards.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const seenUsers = new Set<string>();
  const seenPhones = new Set<string>();
  const counts: ActiveOneOnOneCounts = { total: 0, male: 0, female: 0 };
  for (const card of cards) {
    const profile = profiles.get(card.user_id);
    const verifiedPhone = normalizePhoneForOneOnOneBlock(profile?.phone_e164 ?? "");
    const phone = verifiedPhone || normalizePhoneForOneOnOneBlock(card.phone ?? "");
    const duplicate = seenUsers.has(card.user_id) || Boolean(phone && seenPhones.has(phone));
    seenUsers.add(card.user_id);
    if (phone) seenPhones.add(phone);
    if (duplicate || !profile || profile.is_banned === true || parseDatingBirthYear(card.birth_year, nowMs) == null) continue;
    if (card.sex !== "male" && card.sex !== "female") continue;
    counts[card.sex] += 1;
    counts.total += 1;
  }
  return counts;
}

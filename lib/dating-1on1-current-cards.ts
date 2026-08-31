import { DATING_ONE_ON_ONE_ACTIVE_STATUSES } from "@/lib/dating-1on1";
import { normalizePhoneForOneOnOneBlock } from "@/lib/dating-1on1-phone-blocks";
import { fetchRecommendationProfiles } from "@/lib/dating-1on1-recommendation-data";
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;
type IdentityCard = { id: string; user_id: string; phone: string | null; created_at: string };
type CardInput = Pick<IdentityCard, "id" | "user_id" | "phone">;
const FIELDS = "id,user_id,phone,created_at";
const CHUNK = 200;
const PAGE = 500;

function phoneVariants(raw: string) {
  const normalized = normalizePhoneForOneOnOneBlock(raw);
  if (!normalized) return [];
  const values = [raw, normalized, normalized.slice(1)];
  if (normalized.startsWith("+82")) {
    const local = `0${normalized.slice(3)}`;
    values.push(local, local.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3"));
  }
  return values;
}

// Use this same check when displaying AND selecting candidates. Read only tiny
// identity rows for the relevant members/phones, including the other sex. Never
// fetch the other sex's introductions or photos to establish current identity.
export async function getCurrentOneOnOneCardIds(
  admin: AdminClient,
  cards: CardInput[],
  knownProfiles?: Awaited<ReturnType<typeof fetchRecommendationProfiles>>,
) {
  if (cards.length === 0) return new Set<string>();
  const profiles = new Map(knownProfiles ?? await fetchRecommendationProfiles(admin, cards.map((row) => row.user_id)));
  const phones = [...new Set(cards.flatMap((row) =>
    phoneVariants(profiles.get(row.user_id)?.phone ?? row.phone ?? "")))];
  const userIds = new Set(cards.map((row) => row.user_id));
  // Include accounts that share a verified phone even if an old card stored a
  // different number. Verified phone always takes precedence over card snapshots.
  for (let start = 0; start < phones.length; start += CHUNK) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from("profiles").select("user_id,phone_e164,is_banned")
        .in("phone_e164", phones.slice(start, start + CHUNK))
        .order("user_id", { ascending: false }).range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        userIds.add(row.user_id);
        profiles.set(row.user_id, { phone: normalizePhoneForOneOnOneBlock(row.phone_e164 ?? "") || null, banned: row.is_banned === true });
      }
      if ((data ?? []).length < PAGE) break;
    }
  }
  const identities = new Map<string, IdentityCard>();
  for (const [column, values] of [["user_id", [...userIds]], ["phone", phones]] as const) {
    for (let start = 0; start < values.length; start += CHUNK) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin.from("dating_1on1_cards").select(FIELDS)
          .in(column, values.slice(start, start + CHUNK)).in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
          .order("created_at", { ascending: false }).order("id", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of (data ?? []) as IdentityCard[]) identities.set(row.id, row);
        if ((data ?? []).length < PAGE) break;
      }
    }
  }
  const missingUserIds = [...new Set([...identities.values()].map((row) => row.user_id))].filter((id) => !profiles.has(id));
  for (const [id, profile] of await fetchRecommendationProfiles(admin, missingUserIds)) profiles.set(id, profile);
  const ordered = [...identities.values()].sort((a, b) => {
    const time = Date.parse(b.created_at) - Date.parse(a.created_at);
    return time || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
  });
  const latestUsers = new Map<string, string>();
  const latestPhones = new Map<string, string>();
  for (const row of ordered) {
    const phone = normalizePhoneForOneOnOneBlock(profiles.get(row.user_id)?.phone ?? row.phone ?? "");
    if (!latestUsers.has(row.user_id)) latestUsers.set(row.user_id, row.id);
    if (phone && !latestPhones.has(phone)) latestPhones.set(phone, row.id);
  }
  return new Set(cards.filter((row) => {
    const profile = profiles.get(row.user_id);
    const phone = normalizePhoneForOneOnOneBlock(profile?.phone ?? row.phone ?? "");
    return profile && !profile.banned && latestUsers.get(row.user_id) === row.id &&
      (!phone || latestPhones.get(phone) === row.id);
  }).map((row) => row.id));
}

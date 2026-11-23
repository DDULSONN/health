import type { SupabaseClient } from "@supabase/supabase-js";
import { careMatchNames, type parseCareCursor } from "@/lib/contact-care-server";
import { hashDatingContactBlockValue, normalizeDatingContactInstagram, normalizeDatingContactPhone } from "@/lib/dating-contact-blocks";
import { hashOneOnOneBlockedPhone } from "@/lib/dating-1on1-phone-blocks";

type Cursor = ReturnType<typeof parseCareCursor>;
type Row = { id: string; created_at: string; source_user_id: string; candidate_user_id: string; source_card_id: string; candidate_card_id: string };
const other = (row: Row, me: string) => row.source_user_id === me ? row.candidate_user_id : row.source_user_id;
const size = 30;

// All lookups are server-only and fail closed. Explicit pair queries are bounded
// by this page's participants, not by a global limit on a member's block history.
export async function getContactExchangeBlockedPeers(db: SupabaseClient, me: string, peers: string[]) {
  const blocked = new Set<string>();
  if (!peers.length) return blocked;
  async function pairs(table: string, from: string, to: string) {
    const { data, error } = await db.from(table).select(to).eq(from, me).in(to, peers);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Record<string,string>[]) blocked.add(row[to]);
  }
  // An owner may have many saved contact hashes/cards. Never treat a truncated
  // or failed query as an empty block list. Stable primary-key order on all pages.
  async function records(table: string, fields: string, owner: string) {
    const rows: Record<string,string>[] = [];
    for (let start = 0; ; start += 500) {
      const { data, error } = await db.from(table).select(fields).in(owner, [me, ...peers])
        .order("id", { ascending: true }).range(start, start + 499);
      if (error) throw error;
      rows.push(...(data ?? []) as unknown as Record<string,string>[]);
      if (!data || data.length < 500) return rows;
    }
  }
  const [contacts, legacy, profiles] = await Promise.all([
    records("dating_contact_blocks", "user_id,block_type,value_hash", "user_id"),
    records("dating_1on1_phone_blocks", "user_id,phone_hash", "user_id"),
    db.from("profiles").select("user_id,phone_e164,phone_verified,is_banned").in("user_id", [me, ...peers]),
    pairs("dating_user_blocks", "blocker_user_id", "blocked_user_id"),
    pairs("dating_user_blocks", "blocked_user_id", "blocker_user_id"),
    pairs("dating_1on1_admin_user_blocks", "user_a_id", "user_b_id"),
    pairs("dating_1on1_admin_user_blocks", "user_b_id", "user_a_id"),
  ]);
  if (profiles.error) throw profiles.error;
  const hashes = new Set(contacts.map(r => `${r.user_id}:${r.block_type}:${r.value_hash}`));
  for (const r of legacy) hashes.add(`${r.user_id}:legacy:${r.phone_hash}`);
  const identities = new Map<string,string[]>();
  for (const r of profiles.data ?? []) {
    if (r.is_banned || r.phone_verified !== true) continue;
    const phone = normalizeDatingContactPhone(r.phone_e164 ?? "");
    if (phone) identities.set(r.user_id, ["phone:" + hashDatingContactBlockValue("phone", phone), "legacy:" + hashOneOnOneBlockedPhone(phone)]);
  }
  // Matching the existing redemption guard: when a participant is gone,
  // suspended or no longer verified, don't offer a stale profile for exchange.
  if (!identities.has(me)) return new Set(peers);
  for (const peer of peers) if (!identities.has(peer)) blocked.add(peer);
  if (contacts.some(r => r.block_type === "instagram")) {
    for (const r of await records("dating_cards", "owner_user_id,instagram_id", "owner_user_id")) {
      const handle = normalizeDatingContactInstagram(r.instagram_id ?? "");
      if (!handle) continue;
      const keys = identities.get(r.owner_user_id) ?? [];
      keys.push("instagram:" + hashDatingContactBlockValue("instagram", handle));
      identities.set(r.owner_user_id, keys);
    }
  }
  const hides = (owner: string, person: string) => identities.get(person)?.some(h => hashes.has(owner + ":" + h));
  for (const peer of peers) if (hides(me, peer) || hides(peer, me)) blocked.add(peer);
  return blocked;
}

export async function careTargetPage(db: SupabaseClient, me: string, cursor: Cursor, exclude: string | null, onlyId?: string) {
  const visible: Row[] = [];
  let after = cursor;
  let batch = size + 1;
  const visibility = new Map<string, boolean>();
  while (visible.length <= size) {
    let query = db.from("dating_1on1_match_proposals").select("id,created_at,source_user_id,candidate_user_id,source_card_id,candidate_card_id")
      .or(`source_user_id.eq.${me},candidate_user_id.eq.${me}`).eq("state", "mutual_accepted")
      .in("contact_exchange_status", ["none", "awaiting_applicant_payment"])
      .is("contact_exchange_paid_at", null).is("contact_exchange_approved_at", null);
    if (onlyId) query = query.eq("id", onlyId);
    if (exclude) query = query.neq("id", exclude);
    if (after) query = query.or(`created_at.lt.${after.at},and(created_at.eq.${after.at},id.lt.${after.id})`);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(batch);
    if (error) throw error;
    const rows: Row[] = data ?? [];
    const peers = [...new Set(rows.map(r => other(r, me)).filter(p => p && p !== me && !visibility.has(p)))];
    const blocked = await getContactExchangeBlockedPeers(db, me, peers);
    for (const peer of peers) visibility.set(peer, !blocked.has(peer));
    visible.push(...rows.filter(r => visibility.get(other(r, me))));
    if (rows.length < batch) break;
    const last = rows[rows.length - 1];
    after = { at: last.created_at, id: last.id };
    batch = 90; // Skip longer runs of hidden rows, still using bounded lookups.
  }
  const page = visible.slice(0, size);
  const names = await careMatchNames(db, page, me);
  const last = page.at(-1);
  // The public cursor always describes a visible row; never expose a hidden ID
  // as a boundary, even when an entire internal batch was blocked.
  return { matches: page.map(r => ({ id: r.id, name: names.get(r.id)! })),
    next_matches_cursor: visible.length > size && last ? last.created_at + "|" + last.id : null };
}

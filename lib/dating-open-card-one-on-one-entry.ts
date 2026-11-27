import type { SupabaseClient } from "@supabase/supabase-js";
import { getContactExchangeBlockedPeers } from "@/lib/contact-care-targets";
import { DATING_ONE_ON_ONE_ACTIVE_STATUSES, toDatingOneOnOneAge } from "@/lib/dating-1on1";
import { getCurrentOneOnOneCardIds } from "@/lib/dating-1on1-current-cards";
import { normalizePhoneForOneOnOneBlock } from "@/lib/dating-1on1-phone-blocks";
import {
  fetchRecommendationAvailabilityDetails,
  fetchRecommendationProfiles,
} from "@/lib/dating-1on1-recommendation-data";
import { isCandidateInSourceAgeRange, type RecommendationCandidate } from "@/lib/dating-1on1-recommendations";
import { MIN_DATING_AGE, parseDatingBirthYear } from "@/lib/dating-age";
import { getRegionDistanceMeta } from "@/lib/region-distance";
import { normalizeOneOnOneMatchId } from "@/lib/dating-1on1-match-navigation";

const DAY = 86_400_000;
const ACTIVE_STATUSES = [...DATING_ONE_ON_ONE_ACTIVE_STATUSES];
const INCOMING_CAP = 40;
const STOCK_CAP = 8;
const INCOMING_ACCOUNT_CAP = 6;
const STOCK_ACCOUNT_CAP = 3;
const UNKNOWN_INCOMING = { hasIncoming: false, incomingCount: null } as const;

export type OpenCardOneOnOneEntry = {
  hasIncoming: boolean;
  incomingCount: number | null;
  suggestion: "nearby" | "profile" | null;
};

export const EMPTY_OPEN_CARD_ONE_ON_ONE_ENTRY: OpenCardOneOnOneEntry = { ...UNKNOWN_INCOMING, suggestion: null };

type ProfileCard = {
  id: string;
  user_id: string;
  sex: "male" | "female";
  region: string;
  birth_year: number;
  created_at: string;
  phone: string | null;
};
type Incoming = {
  id: string;
  source_user_id: string;
  candidate_user_id: string;
  source_card_id: string;
  candidate_card_id: string;
};
type QueryResult<T> = { data: T; error: unknown };
function requireData<T>(result: QueryResult<T>) {
  if (result.error) throw result.error;
  return result.data;
}
const unique = (items: string[]) => [...new Set(items)];
const isId = (id: unknown): id is string => normalizeOneOnOneMatchId(id) !== null;
const date = (now: number) => new Date(now).toISOString();

type EntryAuthUser = { id: string; app_metadata?: Record<string, unknown>; deleted_at?: string | null; banned_until?: string | null };
export function canShowOpenCardOneOnOneEntryAccount(account: EntryAuthUser | null | undefined, now: number) {
  if (!account || !isId(account.id) || account.deleted_at || account.app_metadata?.internal_test_suite) return false;
  if (!account.banned_until) return true;
  const until = Date.parse(account.banned_until);
  return Number.isFinite(until) && until <= now;
}
async function confirmEntryAccounts(db: SupabaseClient, ids: string[], now: number) {
  return new Map(await Promise.all(ids.map(async id => {
    try {
      const { data, error } = await db.auth.admin.getUserById(id);
      if (error || data.user?.id !== id) return [id, null] as const;
      return [id, canShowOpenCardOneOnOneEntryAccount(data.user, now)] as const;
    } catch {
      return [id, null] as const;
    }
  })));
}

// Read only the receiver's actionable rows. Do not return match IDs or count
// a canceled/blocked/missing/invalid profile just because a notification exists.
async function readIncoming(db: SupabaseClient, viewer: string, now: number) {
  const result = await db.from("dating_1on1_match_proposals")
    .select("id,source_user_id,candidate_user_id,source_card_id,candidate_card_id")
    .eq("candidate_user_id", viewer).eq("state", "source_selected")
    .neq("source_user_id", viewer)
    .order("source_selected_at", { ascending: false }).order("id", { ascending: false })
    .limit(INCOMING_CAP + 1);
  const raw = (requireData(result) ?? []) as Incoming[];
  if (!raw.length) return { hasIncoming: false, incomingCount: 0 };
  const rows = raw.slice(0, INCOMING_CAP).filter(row => row.candidate_user_id === viewer &&
    row.source_user_id !== viewer && row.source_card_id !== row.candidate_card_id &&
    [row.id, row.source_user_id, row.source_card_id, row.candidate_card_id].every(isId));
  if (!rows.length) return UNKNOWN_INCOMING;
  const [blocked, cardsResult] = await Promise.all([
    getContactExchangeBlockedPeers(db, viewer, unique(rows.map(row => row.source_user_id))),
    db.from("dating_1on1_cards").select("id,user_id,birth_year")
      .in("id", unique(rows.flatMap(row => [row.source_card_id, row.candidate_card_id]))).in("status", ACTIVE_STATUSES),
  ]);
  const owners = new Map((requireData(cardsResult) ?? [])
    .filter(card => parseDatingBirthYear(card.birth_year, now) !== null).map(card => [card.id, card.user_id]));
  const eligible = rows.filter(row => !blocked.has(row.source_user_id) &&
    owners.get(row.source_card_id) === row.source_user_id &&
    owners.get(row.candidate_card_id) === viewer);
  const peers = unique(eligible.map(row => row.source_user_id));
  const accounts = await confirmEntryAccounts(db, peers.slice(0, INCOMING_ACCOUNT_CAP), now);
  const valid = new Set(eligible.filter(row => accounts.get(row.source_user_id) === true).map(row => row.id));
  const exact = raw.length <= INCOMING_CAP && peers.length <= INCOMING_ACCOUNT_CAP && ![...accounts.values()].includes(null);
  return { hasIncoming: valid.size > 0, incomingCount: exact ? valid.size : null };
}

async function hasRecentOpenConnection(db: SupabaseClient, viewer: string, now: number) {
  const since = date(now - 14 * DAY);
  // Recently accepted Open Card connections (including rooms without a first
  // message) or recent activity in an older room suppress promotional UI.
  // Explicit requests are independent and always take precedence.
  const result = await db.from("dating_chat_threads").select("id")
    .in("source_kind", ["open", "paid"]).eq("status", "open")
    .or(`and(or(and(user_a_id.eq.${viewer},user_a_hidden_at.is.null),and(user_b_id.eq.${viewer},user_b_hidden_at.is.null)),or(created_at.gte.${since},last_message_at.gte.${since}))`).limit(1);
  if (requireData(result)?.length) return true;
  // A recent accepted request can also be continuing off-site even if chat
  // creation failed. Suppress the invitation for that applicant as well.
  const accepted = await db.from("dating_card_applications").select("id")
    .eq("applicant_user_id", viewer).eq("status", "accepted").gte("accepted_at", since).limit(1);
  return Boolean(requireData(accepted)?.length);
}

async function hasSameRegionUnseenStock(db: SupabaseClient, viewer: string, source: RecommendationCandidate, now: number) {
  if (!source.region || source.region.length > 100 ||
      getRegionDistanceMeta(source.region, source.region).distanceKm !== 0) return false;
  const opposite = source.sex === "male" ? "female" : "male";
  // Conservatively sample new, approved cards in the exact same region only.
  // A miss is not proof of an empty list and must never take a refresh slot.
  const result = await db.from("dating_1on1_cards").select("id,user_id,sex,region,birth_year,created_at,phone")
    .eq("region", source.region).eq("sex", opposite).eq("status", "approved").neq("user_id", viewer)
    .gte("created_at", date(now - 7 * DAY)).lte("created_at", date(now))
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(STOCK_CAP);
  const stock = ((requireData(result) ?? []) as ProfileCard[]).filter(row => isId(row.id) && isId(row.user_id) &&
    row.user_id !== viewer && row.sex === opposite && row.region === source.region &&
    parseDatingBirthYear(row.birth_year, now) !== null &&
    isCandidateInSourceAgeRange(source, { ...row, age: toDatingOneOnOneAge(row.birth_year) }));
  if (!stock.length) return false;
  const users = unique(stock.map(row => row.user_id)), userList = users.join(",");
  const [hides, impressions, pairs, favorites, saved, profiles, blocked, availability] = await Promise.all([
    db.from("dating_1on1_candidate_hides").select("candidate_user_id").eq("user_id", viewer).in("candidate_user_id", users),
    db.from("dating_1on1_candidate_impressions").select("candidate_user_id").eq("viewer_user_id", viewer).in("candidate_user_id", users),
    db.from("dating_1on1_match_proposals").select("source_user_id,candidate_user_id")
      .or(`and(source_user_id.eq.${viewer},candidate_user_id.in.(${userList})),and(candidate_user_id.eq.${viewer},source_user_id.in.(${userList}))`).limit(101),
    db.from("dating_1on1_candidate_favorites").select("candidate_card_id").eq("user_id", viewer).in("candidate_card_id", stock.map(row => row.id)),
    db.from("dating_1on1_recommendation_pages").select("refreshed_at,main_candidate_ids,extra_candidate_ids").eq("user_id", viewer).maybeSingle(),
    fetchRecommendationProfiles(db, [viewer, ...users]),
    getContactExchangeBlockedPeers(db, viewer, users),
    fetchRecommendationAvailabilityDetails(db, stock.map(row => row.id)),
  ]);
  const paired = requireData(pairs) ?? [];
  const page = requireData(saved);
  if (paired.length > 100) return false;
  const known = new Set([
    ...(requireData(hides) ?? []).map(row => row.candidate_user_id),
    ...(requireData(impressions) ?? []).map(row => row.candidate_user_id),
    ...paired.map(row => row.source_user_id === viewer ? row.candidate_user_id : row.source_user_id), ...blocked,
  ]);
  const usedCardIds = new Set([
    ...(requireData(favorites) ?? []).map(row => row.candidate_card_id),
    ...(page?.main_candidate_ids ?? []), ...(page?.extra_candidate_ids ?? []),
  ]);
  const ownPhone = normalizePhoneForOneOnOneBlock(profiles.get(viewer)?.phone ?? "");
  if (!ownPhone || profiles.get(viewer)?.banned !== false) return false;
  const pageAt = page ? Date.parse(page.refreshed_at) : 0;
  if (!Number.isFinite(pageAt)) return false;
  const eligible = stock.filter(row => {
    const detail = availability.get(row.id);
    const peer = profiles.get(row.user_id);
    const peerPhone = normalizePhoneForOneOnOneBlock(peer?.phone ?? "");
    return !known.has(row.user_id) && !usedCardIds.has(row.id) && Date.parse(row.created_at) > pageAt &&
      peer?.banned === false && Boolean(peerPhone) && peerPhone !== ownPhone &&
      detail?.hasPhoto && detail.user_id === row.user_id && detail.sex === row.sex &&
      detail.region === row.region && detail.birth_year === row.birth_year;
  });
  if (!eligible.length) return false;
  const current = await getCurrentOneOnOneCardIds(db, eligible, profiles);
  const finalPeers = unique(eligible.filter(row => current.has(row.id)).map(row => row.user_id)).slice(0, STOCK_ACCOUNT_CAP);
  if (!finalPeers.length) return false;
  const accounts = await confirmEntryAccounts(db, finalPeers, now);
  return [...accounts.values()].includes(true);
}

export async function readOpenCardOneOnOneEntry(
  db: SupabaseClient, viewer: string, now = Date.now(), pickMutual: () => Promise<string | null> = async () => null,
): Promise<OpenCardOneOnOneEntry & { matchId: string | null }> {
  if (!isId(viewer)) return { ...EMPTY_OPEN_CARD_ONE_ON_ONE_ENTRY, matchId: null };
  const account = requireData(await db.from("profiles").select("phone_verified,is_banned").eq("user_id", viewer).maybeSingle());
  if (!account || account.is_banned !== false || account.phone_verified !== true) {
    return { ...EMPTY_OPEN_CARD_ONE_ON_ONE_ENTRY, matchId: null };
  }
  const [incoming, latest] = await Promise.all([
    readIncoming(db, viewer, now).catch(() => UNKNOWN_INCOMING),
    db.from("dating_1on1_cards").select("id,user_id,sex,region,birth_year,created_at,phone")
      .eq("user_id", viewer).in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const entry: OpenCardOneOnOneEntry & { matchId: string | null } = { ...incoming, suggestion: null, matchId: null };
  if (incoming.hasIncoming || latest.error) return entry;
  const card = latest.data as ProfileCard | null;
  if (card) entry.matchId = await pickMutual().catch(() => null);
  if (entry.matchId || incoming.incomingCount === null) return entry;
  try {
    if (await hasRecentOpenConnection(db, viewer, now)) return entry;
    if (card) {
      if ((card.sex === "male" || card.sex === "female") && parseDatingBirthYear(card.birth_year, now) !== null &&
          await hasSameRegionUnseenStock(db, viewer, { ...card, age: toDatingOneOnOneAge(card.birth_year) }, now)) {
        entry.suggestion = "nearby";
      }
    } else {
      const [support, openCard, settings] = await Promise.all([
        db.from("dating_card_applications").select("id").eq("applicant_user_id", viewer)
          .in("status", ["submitted", "rejected"]).gte("created_at", date(now - 30 * DAY)).limit(1),
        db.from("dating_cards").select("id,sex,region,age,created_at").eq("owner_user_id", viewer)
          .in("status", ["public", "pending", "expired", "hidden"])
          .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
        db.from("site_settings").select("value_json").eq("key", "dating_1on1_write_status").maybeSingle(),
      ]);
      const open = requireData(openCard);
      const setting = requireData(settings);
      if (requireData(support)?.length && open && ["male", "female"].includes(open.sex) &&
          Number.isInteger(open.age) && open.age >= MIN_DATING_AGE && open.age <= 99 &&
          (!setting || setting.value_json?.status === "approved") &&
          await hasSameRegionUnseenStock(db, viewer, open, now)) {
        entry.suggestion = "profile";
      }
    }
  } catch { /* Fail closed on optional promotion context. */ }
  return entry;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatingBlockedUserIds, hasDatingBlockBetween } from "@/lib/dating-blocks";
import { filterDatingCardsByContactBlocks, hasDatingContactBlockBetween } from "@/lib/dating-contact-blocks";
import { getOppositeDatingSex, normalizeDatingCityViewSex } from "@/lib/dating-city-view";
import { fetchCityViewCandidateRows } from "@/lib/dating-city-view-candidates";
import { extractProvinceFromRegion, PROVINCE_ORDER } from "@/lib/region-city";

export type LovePassStatus = { id: string; startsAt: string; expiresAt: string; areas: string[]; publicationsRemaining: number; nextPublicationAt: string | null; creditsRemaining: number };
export type LovePassNearbyItem = { id: string; nickname: string; age: number; region: string; status: "pending" | "public" };
export type LovePassOwnCard = { id: string; status: "pending" | "public" };
const canonicalAreas = new Set<string>(PROVINCE_ORDER);

export function isLovePassAreaList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 2 && value.every(area => typeof area === "string" && canonicalAreas.has(area)) && new Set(value).size === value.length;
}

export function readLovePassStatus(value: unknown, now = Date.now()): LovePassStatus | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<LovePassStatus>;
  if (typeof row.id !== "string" || typeof row.startsAt !== "string" || typeof row.expiresAt !== "string" || !isLovePassAreaList(row.areas)) return null;
  const start = Date.parse(row.startsAt), end = Date.parse(row.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end <= start) return null;
  if (typeof row.publicationsRemaining !== "number" || !Number.isInteger(row.publicationsRemaining) || row.publicationsRemaining < 0 || row.publicationsRemaining > 4) return null;
  if (typeof row.creditsRemaining !== "number" || !Number.isInteger(row.creditsRemaining) || row.creditsRemaining < 0 || row.creditsRemaining > 40) return null;
  const next = row.nextPublicationAt;
  if (next !== null && (typeof next !== "string" || !Number.isFinite(Date.parse(next)))) return null;
  return { id: row.id, startsAt: row.startsAt, expiresAt: row.expiresAt, areas: row.areas, publicationsRemaining: row.publicationsRemaining, nextPublicationAt: next, creditsRemaining: row.creditsRemaining };
}

export async function getLovePassStatus(admin: SupabaseClient, userId: string) {
  const res = await admin.rpc("dating_love_pass_status", { p_user_id: userId });
  if (res.error) {
    if (res.error.code === "42883" || res.error.code === "PGRST202") return null;
    throw res.error;
  }
  return readLovePassStatus(res.data);
}

type Card = { id: string; owner_user_id: string; status: string; expires_at: string | null; age: number | null; sex: string | null; region: string | null; display_nickname: string | null; instagram_id: string | null };

function isLiveCard(row: Pick<Card, "status" | "expires_at">, now: number) {
  return (row.status === "pending" && (row.expires_at == null || Date.parse(row.expires_at) > now)) ||
    (row.status === "public" && row.expires_at != null && Date.parse(row.expires_at) > now);
}

export async function getLovePassViewer(admin: SupabaseClient, userId: string) {
  const [profile, own] = await Promise.all([
    admin.from("profiles").select("phone_verified,is_banned").eq("user_id", userId).maybeSingle(),
    admin.from("dating_cards").select("id,sex,age,status,expires_at").eq("owner_user_id", userId)
      .in("status", ["pending", "public", "expired", "hidden"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (profile.error || own.error) throw profile.error ?? own.error;
  const verified = profile.data?.phone_verified === true && profile.data.is_banned !== true;
  const sex = own.data && own.data.age >= 19 ? normalizeDatingCityViewSex(own.data.sex) : null;
  const ownCard = sex && own.data && isLiveCard(own.data, Date.now()) ? { id: String(own.data.id), status: own.data.status as LovePassOwnCard["status"] } : null;
  return { verified, targetSex: sex ? getOppositeDatingSex(sex) : null, ownCard };
}

export async function hasLovePassNearbyCardAccess(admin: SupabaseClient, userId: string, cardId: string) {
  try {
    const pass = await getLovePassStatus(admin, userId);
    if (!pass?.areas.length) return false;
    const [viewer, target] = await Promise.all([
      getLovePassViewer(admin, userId),
      admin.from("dating_cards").select("id,owner_user_id,status,expires_at,age,sex,region,instagram_id").eq("id", cardId).maybeSingle(),
    ]);
    const card = target.data as Card | null;
    const area = extractProvinceFromRegion(card?.region ?? null);
    if (target.error || !viewer.verified || !card || !viewer.targetSex || card.owner_user_id === userId || !card.owner_user_id ||
      card.sex !== viewer.targetSex || card.age == null || card.age < 19 || !isLiveCard(card, Date.now()) || !area || !pass.areas.includes(area)) return false;
    const [owner, blocked, blockedContact, review] = await Promise.all([
      admin.from("profiles").select("is_banned").eq("user_id", card.owner_user_id).maybeSingle(),
      hasDatingBlockBetween(admin, userId, card.owner_user_id),
      hasDatingContactBlockBetween(admin, userId, card.owner_user_id, { userBInstagramIds: [card.instagram_id] }),
      admin.rpc("dating_love_pass_card_review_ok", { p_card_id: cardId }),
    ]);
    return !owner.error && Boolean(owner.data) && owner.data?.is_banned !== true && !blocked && !blockedContact && !review.error && review.data === true;
  } catch {
    // Gate only this new path; old products must remain operational even if the new migration is unavailable.
    return false;
  }
}

export async function listLovePassNearbyCards(admin: SupabaseClient, userId: string, pass: LovePassStatus, targetSex: "male" | "female"): Promise<LovePassNearbyItem[]> {
  if (pass.areas.length === 0) return [];
  const [pool, blocks] = await Promise.all([fetchCityViewCandidateRows(admin), getDatingBlockedUserIds(admin, userId)]);
  const rows = pool.filter(row => {
    const area = extractProvinceFromRegion(row.region);
    return row.sex === targetSex && row.owner_user_id && row.owner_user_id !== userId && !blocks.has(row.owner_user_id) && area && pass.areas.includes(area);
  }).sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || a.id.localeCompare(b.id));
  const items: LovePassNearbyItem[] = [];
  for (let start = 0; start < rows.length && items.length < 30; start += 50) {
    const ids = rows.slice(start, start + 50).map(row => row.id);
    const [detail, reviews] = await Promise.all([
      admin.from("dating_cards").select("id,owner_user_id,status,expires_at,age,sex,region,display_nickname,instagram_id").in("id", ids),
      admin.rpc("get_dating_love_pass_reviewable_cards", { p_card_ids: ids }),
    ]);
    if (detail.error || reviews.error) throw detail.error ?? reviews.error;
    const reviewedIds = new Set(Array.isArray(reviews.data) ? reviews.data as string[] : []);
    const eligible = (detail.data as Card[]).filter(row => {
      const area = extractProvinceFromRegion(row.region);
      return row.owner_user_id && row.owner_user_id !== userId && !blocks.has(row.owner_user_id) && row.sex === targetSex &&
        row.age != null && row.age >= 19 && area && pass.areas.includes(area) && isLiveCard(row, Date.now()) && reviewedIds.has(row.id);
    });
    const checked = await filterDatingCardsByContactBlocks(admin, userId, eligible);
    const byId = new Map(checked.map(row => [row.id, row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row || row.age == null || !row.region || (row.status !== "public" && row.status !== "pending")) continue;
      items.push({ id, nickname: row.display_nickname?.trim() || "짐툴 회원", age: row.age, region: row.region, status: row.status });
      if (items.length >= 30) break;
    }
  }
  return items;
}

import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { FRIEND_PROMPTS, FRIEND_TOKEN, friendAgeBand, type FriendKind, type FriendPrompt, type FriendPublicItem, type FriendSelection } from "@/lib/friend-recommendation";
import { extractProvinceFromRegion } from "@/lib/region-city";
import { parseDatingBirthYear } from "@/lib/dating-age";
import { verifyImpressionTicket } from "@/lib/dating-1on1-impressions";
import { getCurrentOneOnOneCardIds } from "@/lib/dating-1on1-current-cards";
import { hashOneOnOneBlockedPhone, normalizePhoneForOneOnOneBlock } from "@/lib/dating-1on1-phone-blocks";
import { hashDatingContactBlockValue, normalizeDatingContactInstagram } from "@/lib/dating-contact-blocks";

export type FriendAdmin = ReturnType<typeof createAdminClient>;
export type FriendItem = { id: string; kind: FriendKind; card_id: string; user_id: string; revision: number; label: string };
export type FriendLink = { id: string; user_id: string | null; token: string; prompt: FriendPrompt; items: FriendItem[]; created_at: string; expires_at: string; revoked_at: string | null };
export type FriendMember = { user_id: string; nickname: string | null; phone_e164: string | null; phone_verified: boolean; is_banned: boolean | null; instagramIds?: string[] };
type Card = {
  id: string; user_id: string; name: string; age: number; sex: string; region: string;
  height: number | null; job: string; intro: string; strengths: string; preference: string;
  photos: string[]; blur: boolean; phone: string | null; instagram: string | null;
};
export class FriendError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const FRIEND_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie, Authorization", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };
export const friendJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: FRIEND_HEADERS });
export function friendFailure(error: unknown) {
  if (error instanceof FriendError) return friendJson({ error: error.message }, error.status);
  // Avoid logging bearer links, private profiles, or database request bodies.
  console.error("[friend recommendation] unavailable", { code: (error as { code?: string })?.code ?? "unknown" });
  return friendJson({ error: "지금은 공유 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요." }, 503);
}
export async function friendBody(req: Request) {
  if (!req.body) throw new FriendError(400, "입력 내용을 확인해 주세요.");
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 20000) { await reader.cancel(); throw new FriendError(413, "입력 내용이 너무 길어요."); } chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) { if (error instanceof FriendError) throw error; throw new FriendError(400, "입력 내용을 확인해 주세요."); }
  finally { reader.releaseLock(); }
}
export async function friendPolicy(admin: FriendAdmin) {
  const result = await admin.from("dating_friend_share_policy").select("enabled").eq("id", true).maybeSingle();
  if (result.error) throw result.error;
  if (result.data?.enabled !== true) throw new FriendError(503, "친구 추천을 준비 중이에요.");
}
export async function friendMember(admin: FriendAdmin, id: string, verified = true): Promise<FriendMember> {
  const result = await admin.from("profiles").select("user_id,nickname,phone_e164,phone_verified,is_banned").eq("user_id", id).maybeSingle();
  if (result.error) throw result.error;
  const row = result.data as FriendMember | null;
  if (!row || row.is_banned) throw new FriendError(410, "현재 이용할 수 없는 프로필이에요.");
  const account = await admin.auth.admin.getUserById(id);
  if (account.error) {
    if (account.error.status === 404) throw new FriendError(410, "현재 이용할 수 없는 프로필이에요.");
    throw account.error;
  }
  if (!account.data.user || account.data.user.app_metadata?.internal_test_suite ||
    Date.parse(String((account.data.user as { banned_until?: string }).banned_until ?? "")) > Date.now()) throw new FriendError(410, "현재 이용할 수 없는 프로필이에요.");
  row.phone_e164 = normalizePhoneForOneOnOneBlock(row.phone_e164 ?? "") || null;
  if (verified && (!row.phone_verified || !row.phone_e164)) throw new FriendError(403, "휴대폰 인증 후 이용해 주세요.");
  const instagramRows = await Promise.all([
    admin.from("dating_cards").select("instagram_id").eq("owner_user_id", id).order("created_at", { ascending: false }).limit(5),
    admin.from("dating_paid_cards").select("instagram_id").eq("user_id", id).order("created_at", { ascending: false }).limit(5),
  ]);
  for (const result of instagramRows) if (result.error) throw result.error;
  row.instagramIds = [...new Set(instagramRows.flatMap(result => (result.data ?? []).map(item => normalizeDatingContactInstagram(item.instagram_id ?? "")).filter(Boolean)))];
  return row;
}
export async function friendPreference(admin: FriendAdmin, id: string) {
  const result = await admin.from("dating_friend_share_preferences").select("enabled,revision").eq("user_id", id).maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? { enabled: true, revision: 0 };
}
// Exact indexed probes, no missing-table fallback: a failed safety check denies access.
export async function friendPairBlocked(admin: FriendAdmin, a: FriendMember, b: FriendMember, instagram?: string | null) {
  if (a.user_id === b.user_id) return false;
  const [members, operators, ...contacts] = await Promise.all([
    admin.from("dating_user_blocks").select("id").or(`and(blocker_user_id.eq.${a.user_id},blocked_user_id.eq.${b.user_id}),and(blocker_user_id.eq.${b.user_id},blocked_user_id.eq.${a.user_id})`).limit(1),
    admin.from("dating_1on1_admin_user_blocks").select("user_a_id").or(`and(user_a_id.eq.${a.user_id},user_b_id.eq.${b.user_id}),and(user_a_id.eq.${b.user_id},user_b_id.eq.${a.user_id})`).limit(1),
    ...[[a, b], [b, a]].flatMap(([viewer, target]) => target.phone_e164 ? [
      admin.from("dating_1on1_phone_blocks").select("id").eq("user_id", viewer.user_id).eq("phone_hash", hashOneOnOneBlockedPhone(target.phone_e164)).limit(1),
      admin.from("dating_contact_blocks").select("id").eq("user_id", viewer.user_id).eq("block_type", "phone").eq("value_hash", hashDatingContactBlockValue("phone", target.phone_e164)).limit(1),
    ] : []),
    ...[[a, [...(b.instagramIds ?? []), normalizeDatingContactInstagram(instagram ?? "")]], [b, a.instagramIds ?? []]].flatMap(([viewer, values]) => {
      const hashes = [...new Set((values as string[]).filter(Boolean).map(value => hashDatingContactBlockValue("instagram", value)))];
      return hashes.length ? [admin.from("dating_contact_blocks").select("id").eq("user_id", (viewer as FriendMember).user_id).eq("block_type", "instagram").in("value_hash", hashes).limit(1)] : [];
    }),
  ]);
  for (const result of [members, operators, ...contacts]) if (result.error) throw result.error;
  return [members, operators, ...contacts].some(result => Boolean(result.data?.length));
}
export async function friendCard(admin: FriendAdmin, kind: FriendKind, id: string): Promise<Card> {
  const table = kind === "one_on_one" ? "dating_1on1_cards" : kind === "paid_card" ? "dating_paid_cards" : "dating_cards";
  const fields: string = kind === "one_on_one" ? "id,user_id,sex,name,birth_year,height_cm,job,region,intro_text,strengths_text,preferred_partner_text,status,photo_paths,phone" :
    kind === "paid_card" ? "id,user_id,nickname,gender,age,region,height_cm,job,strengths_text,ideal_text,intro_text,photo_visibility,photo_paths,status,expires_at,instagram_id" :
      "id,owner_user_id,display_nickname,sex,age,region,height_cm,job,strengths_text,ideal_type,photo_visibility,photo_paths,status,expires_at,instagram_id";
  const result = await admin.from(table).select(fields).eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  const row = result.data as unknown as Record<string, unknown> | null;
  if (!row) throw new FriendError(410, "지금은 볼 수 없는 프로필이에요.");
  const owner = String(row.user_id ?? row.owner_user_id ?? "");
  if (kind === "one_on_one") {
    if (!["submitted", "reviewing", "approved"].includes(String(row.status)) || parseDatingBirthYear(row.birth_year) === null) throw new FriendError(410, "지금은 볼 수 없는 프로필이에요.");
    const current = await getCurrentOneOnOneCardIds(admin, [{ id, user_id: owner, phone: typeof row.phone === "string" ? row.phone : null }]);
    if (!current.has(id)) throw new FriendError(410, "프로필이 변경됐어요.");
  } else if (row.status !== (kind === "paid_card" ? "approved" : "public") || !(Date.parse(String(row.expires_at)) > Date.now())) {
    throw new FriendError(410, "공개가 종료된 프로필이에요.");
  }
  return {
    id, user_id: owner, name: String(row.name ?? row.nickname ?? row.display_nickname ?? "회원"),
    age: kind === "one_on_one" ? new Date(Date.now() + 9 * 3600000).getUTCFullYear() - Number(row.birth_year) + 1 : Number(row.age),
    sex: String(row.sex ?? row.gender), region: String(row.region ?? ""), height: typeof row.height_cm === "number" ? row.height_cm : null,
    job: String(row.job ?? ""), intro: String(row.intro_text ?? ""), strengths: String(row.strengths_text ?? ""),
    preference: String(row.preferred_partner_text ?? row.ideal_text ?? row.ideal_type ?? ""),
    photos: Array.isArray(row.photo_paths) ? row.photo_paths.filter((p): p is string => typeof p === "string").slice(0, 2) : [],
    blur: kind !== "one_on_one" && row.photo_visibility !== "public", phone: typeof row.phone === "string" ? row.phone : null,
    instagram: typeof row.instagram_id === "string" ? row.instagram_id : null,
  };
}
export async function createFriendLink(admin: FriendAdmin, userId: string, requestKey: string, prompt: FriendPrompt, selections: FriendSelection[]) {
  await friendPolicy(admin);
  const sender = await friendMember(admin, userId);
  // Retry returns only the same request, never extends the expiry.
  const old = await admin.from("dating_friend_shares").select("*").eq("user_id", userId).eq("request_key", requestKey).maybeSingle();
  if (old.error) throw old.error;
  if (old.data) {
    const previous = old.data as FriendLink;
    if (previous.prompt !== prompt || previous.items.length !== selections.length || previous.items.some((p, i) => p.kind !== selections[i].kind || p.card_id !== selections[i].cardId)) throw new FriendError(409, "공유 선택이 바뀌었어요. 다시 시도해 주세요.");
    await readFriendLink(admin, previous.token, userId);
    return previous;
  }
  const items: FriendItem[] = [];
  for (const selection of selections) {
    if (selection.kind === "one_on_one" && !verifyImpressionTicket(selection.ticket, userId, [selection.cardId])) {
      const favorite = await admin.from("dating_1on1_candidate_favorites").select("id").eq("user_id", userId).eq("candidate_card_id", selection.cardId).limit(1);
      if (favorite.error) throw favorite.error;
      if (!favorite.data?.length) throw new FriendError(409, "후보 목록을 다시 확인한 뒤 추천해 주세요.");
    }
    const card = await friendCard(admin, selection.kind, selection.cardId);
    const [target, pref] = await Promise.all([friendMember(admin, card.user_id), friendPreference(admin, card.user_id)]);
    if (card.user_id === userId || !pref.enabled || await friendPairBlocked(admin, sender, target, card.instagram)) throw new FriendError(410, "현재 추천할 수 없는 프로필이에요.");
    if (items.some(item => item.user_id === card.user_id)) throw new FriendError(400, "같은 회원은 한 번만 담아 주세요.");
    items.push({ id: randomUUID(), kind: selection.kind, card_id: card.id, user_id: card.user_id, revision: pref.revision, label: card.name.slice(0, 30) });
  }
  const result = await admin.rpc("create_dating_friend_share", { p_user: userId, p_request_key: requestKey, p_token: randomBytes(32).toString("base64url"), p_prompt: prompt, p_items: items });
  if (result.error) {
    if (result.error.message.includes("share limit")) throw new FriendError(429, "만든 링크가 많아요. 이전 링크를 종료하거나 내일 다시 이용해 주세요.");
    if (/profile|request conflict/.test(result.error.message)) throw new FriendError(409, "공유 설정이 바뀌었어요. 다시 확인해 주세요.");
    throw result.error;
  }
  const created = (Array.isArray(result.data) ? result.data[0] : result.data) as FriendLink | null;
  if (!created || !FRIEND_TOKEN.test(created.token ?? "") || !created.id) throw new FriendError(503, "추천 링크를 확인하지 못했어요. 다시 시도해 주세요.");
  return created;
}
export async function readFriendLink(admin: FriendAdmin, token: string, viewerId: string | null, onlyItem?: string) {
  if (!FRIEND_TOKEN.test(token)) throw new FriendError(404, "링크를 확인해 주세요.");
  await friendPolicy(admin);
  const result = await admin.from("dating_friend_shares").select("*").eq("token", token).maybeSingle();
  if (result.error) throw result.error;
  const link = result.data as FriendLink | null;
  if (!link || !link.user_id || link.revoked_at || !(Date.parse(link.expires_at) > Date.now())) throw new FriendError(410, "만료되었거나 종료된 추천이에요.");
  const sender = await friendMember(admin, link.user_id);
  const viewer = viewerId ? await friendMember(admin, viewerId, false) : null;
  if (viewer && await friendPairBlocked(admin, viewer, sender)) throw new FriendError(410, "현재 볼 수 없는 추천이에요.");
  const detailed = Boolean(viewer?.phone_verified && viewer?.phone_e164);
  const items: { item: FriendItem; card: Card }[] = [];
  for (const item of link.items) {
    if (onlyItem && item.id !== onlyItem) continue;
    try {
      const [pref, target, card] = await Promise.all([friendPreference(admin, item.user_id), friendMember(admin, item.user_id), friendCard(admin, item.kind, item.card_id)]);
      if (!pref.enabled || Number(pref.revision) !== Number(item.revision) || card.user_id !== item.user_id ||
        await friendPairBlocked(admin, sender, target, card.instagram) || (viewer && await friendPairBlocked(admin, viewer, target, card.instagram))) continue;
      items.push({ item, card });
    } catch (error) { if (error instanceof FriendError && [403, 410].includes(error.status)) continue; throw error; }
  }
  if (!items.length) throw new FriendError(410, "현재 볼 수 있는 프로필이 없어요.");
  return { link, items, viewer, detailed };
}
function safeText(text: string, limit = 1200) {
  return text.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|@[\w.]+|(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/gi, "[연락처 비공개]").slice(0, limit);
}
export function projectFriendItem(token: string, item: FriendItem, card: Card, detailed: boolean): FriendPublicItem {
  return {
    id: item.id, kind: item.kind, ageBand: friendAgeBand(card.age), area: extractProvinceFromRegion(card.region) ?? "지역 미표시",
    photos: card.photos.map((_, index) => `/api/dating/friend-shares/${token}/photos/${item.id}/${index}`),
    ...(detailed ? { detail: { name: safeText(card.name, 30), age: card.age, height: card.height, job: safeText(card.job, 80), intro: safeText(card.intro), strengths: safeText(card.strengths), preference: safeText(card.preference) } } : {}),
  };
}
export { FRIEND_PROMPTS };

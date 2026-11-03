import type { SupabaseClient } from "@supabase/supabase-js";
import { hashDatingContactBlockValue, hasDatingContactBlockBetween } from "@/lib/dating-contact-blocks";
import { hashOneOnOneBlockedPhone } from "@/lib/dating-1on1-phone-blocks";
import { isOneOnOnePairAgeEligible } from "@/lib/dating-1on1-age";
import { PRIVATE_CONTACT_MARKER, parsePayerContact } from "@/lib/dating-private-contact";

export const privateContactEnabled = () => process.env.ONE_ON_ONE_INSTAGRAM_CONTACT_ENABLED === "true";
export type PrivateDisclosure = { match_id: string; payer_user_id: string; instagram: string; order_id: string };

// Keep privacy reads active even when new checkouts are switched off.
export async function loadPrivateDisclosures(admin: SupabaseClient, matches: { id: string; contact_exchange_note?: string | null }[]) {
  const result = new Map<string, PrivateDisclosure>();
  // SQL writes/protects the marker atomically. Legacy phone exchanges incur no new query.
  const privateMatches = matches.filter(row => row.contact_exchange_note?.includes(PRIVATE_CONTACT_MARKER));
  for (let offset = 0; offset < privateMatches.length; offset += 100) {
    const batch = privateMatches.slice(offset, offset + 100);
    const { data, error } = await admin.from("dating_1on1_private_contacts")
      .select("match_id,payer_user_id,instagram,order_id").in("match_id", batch.map(row => row.id));
    if (error) {
      throw new Error("연락처 공개 설정을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.");
    }
    for (const row of data ?? []) result.set(row.match_id, row as PrivateDisclosure);
    if (batch.some(row => row.contact_exchange_note?.includes(PRIVATE_CONTACT_MARKER) && !result.has(row.id))) {
      throw new Error("연락처 공개 설정 확인이 필요해요.");
    }
  }
  return result;
}

export async function privateContactContext(admin: SupabaseClient, matchId: string, userId: string, instagram: string) {
  const { data: match, error } = await admin.from("dating_1on1_match_proposals")
    .select("id,source_card_id,candidate_card_id,source_user_id,candidate_user_id").eq("id", matchId).maybeSingle();
  if (error) throw error;
  if (!match || ![match.source_user_id, match.candidate_user_id].includes(userId)) throw new Error("매칭을 확인할 수 없어요.");
  if (!await isOneOnOnePairAgeEligible(admin, match)) throw new Error("매칭을 확인할 수 없어요.");
  if (await hasDatingContactBlockBetween(admin, match.source_user_id, match.candidate_user_id, {
    userAInstagramIds: match.source_user_id === userId ? [instagram] : [],
    userBInstagramIds: match.candidate_user_id === userId ? [instagram] : [],
  })) throw new Error("이 매칭은 더 이상 진행할 수 없어요.");
  const users = [match.source_user_id, match.candidate_user_id];
  const phones = await admin.from("profiles").select("user_id,phone_e164").in("user_id", users);
  if (phones.error) throw phones.error;
  const values = users.map(id => phones.data?.find(row => row.user_id === id)?.phone_e164 ?? "");
  if (values.some(value => !/^\+[1-9][0-9]{7,14}$/.test(value))) throw new Error("인증된 번호를 확인할 수 없어요.");
  return { p_match: matchId, p_user: userId, p_phones: values,
    p_contact_hashes: values.map(value => hashDatingContactBlockValue("phone", value)),
    p_legacy_hashes: values.map(value => hashOneOnOneBlockedPhone(value)),
    p_instagram_hash: hashDatingContactBlockValue("instagram", instagram) };
}

export async function preflightPrivateContact(admin: SupabaseClient, matchId: string, userId: string, instagram: string) {
  const params = await privateContactContext(admin, matchId, userId, instagram);
  const { error } = await admin.rpc("check_private_contact_exchange", params);
  if (error) throw new Error("연락처 공개 설정을 확인하지 못했어요. 결제하지 말고 잠시 후 다시 확인해 주세요.");
  return params;
}

export async function fulfillPrivateContact(admin: SupabaseClient, order: { id: string; user_id: string; product_ref_id: string | null; product_meta: Record<string, unknown> | null }) {
  const choice = parsePayerContact(order.product_meta?.payerContact);
  if (!choice || !order.product_ref_id) throw new Error("연락처 공개 설정을 확인해 주세요.");
  const params = await privateContactContext(admin, order.product_ref_id, order.user_id, choice.instagram);
  const { data, error } = await admin.rpc("approve_private_contact_exchange", { ...params, p_order: order.id });
  if (error) throw new Error("결제는 다시 하지 말고 잠시 후 내역을 확인해 주세요. 연락처 공개 처리를 확인 중이에요.");
  return data;
}

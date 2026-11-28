import type { SupabaseClient } from "@supabase/supabase-js";
import { hashDatingContactBlockValue, normalizeDatingContactPhone } from "@/lib/dating-contact-blocks";

// Longer than the public label input limit; only this server path creates it.
const PREFIX = "member-block:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function memberBlockSource(label: unknown): string | null {
  if (typeof label !== "string" || !label.startsWith(PREFIX)) return null;
  const id = label.slice(PREFIX.length);
  return UUID.test(id) ? id : null;
}
export function memberBlockDisplayLabel(label: string | null) {
  return memberBlockSource(label) ? "회원 차단 · 재가입 방지" : label;
}

export async function prepareMemberContactBlock(admin: SupabaseClient, ownerId: string, targetId: string) {
  if (!UUID.test(ownerId) || !UUID.test(targetId) || ownerId === targetId) throw new Error("invalid_block_pair");
  const profile = await admin.from("profiles").select("phone_e164,phone_verified").eq("user_id", targetId).maybeSingle();
  if (profile.error) throw new Error("block_identity_read_failed");
  const phone = profile.data?.phone_verified === true ? normalizeDatingContactPhone(profile.data.phone_e164 ?? "") : "";
  if (!phone) return null;
  return { user_id: ownerId, block_type: "phone" as const, value_hash: hashDatingContactBlockValue("phone", phone),
    value_hint: "회원 차단 연동", label: PREFIX + targetId };
}

export async function saveMemberContactBlock(admin: SupabaseClient, row: Awaited<ReturnType<typeof prepareMemberContactBlock>>) {
  if (!row) return;
  // The contact hash references only the blocker, so deleting/recreating the
  // blocked Auth account cannot cascade this protection away. Explicit contact
  // blocks retain ownership and must not be overwritten by an account block.
  const inserted = await admin.from("dating_contact_blocks").upsert(row, { onConflict: "user_id,block_type,value_hash", ignoreDuplicates: true });
  if (inserted.error) throw new Error("block_identity_write_failed");
  const existing = await admin.from("dating_contact_blocks").select("id,label").eq("user_id", row.user_id)
    .eq("block_type", row.block_type).eq("value_hash", row.value_hash).maybeSingle();
  if (existing.error || !existing.data) throw new Error("block_identity_verify_failed");
  const previousTarget = memberBlockSource(existing.data.label);
  if (!previousTarget || existing.data.label === row.label) return;
  // A re-registered account may inherit an orphaned hash. Associate the hash
  // with the new block only if the prior account-pair block is already gone.
  const previous = await admin.from("dating_user_blocks").select("id").eq("blocker_user_id", row.user_id).eq("blocked_user_id", previousTarget).maybeSingle();
  if (previous.error) throw new Error("previous_block_read_failed");
  if (previous.data) return;
  const linked = await admin.from("dating_contact_blocks").update({ label: row.label }).eq("id", existing.data.id)
    .eq("user_id", row.user_id).eq("label", existing.data.label);
  if (linked.error) throw new Error("block_identity_link_failed");
}

export async function removeMemberContactBlock(admin: SupabaseClient, ownerId: string, targetId: string) {
  if (!UUID.test(ownerId) || !UUID.test(targetId) || ownerId === targetId) throw new Error("invalid_block_pair");
  const label = PREFIX + targetId;
  const linked = await admin.from("dating_contact_blocks").select("id,value_hash").eq("user_id", ownerId).eq("label", label);
  if (linked.error) throw new Error("block_identity_read_failed");
  if (!linked.data?.length) return;

  // Several separately blocked accounts can share one verified phone. Removing
  // one account block must preserve protection belonging to another live block.
  const replacementByHash = new Map<string, string>();
  for (let offset = 0; ; offset += 200) {
    const remaining = await admin.from("dating_user_blocks").select("blocked_user_id")
      .eq("blocker_user_id", ownerId).order("id").range(offset, offset + 199);
    if (remaining.error) throw new Error("remaining_blocks_read_failed");
    const ids = (remaining.data ?? []).map(row => String(row.blocked_user_id));
    if (ids.length) {
      const profiles = await admin.from("profiles").select("user_id,phone_e164,phone_verified").in("user_id", ids);
      if (profiles.error) throw new Error("remaining_identities_read_failed");
      for (const profile of profiles.data ?? []) {
        const phone = profile.phone_verified === true ? normalizeDatingContactPhone(profile.phone_e164 ?? "") : "";
        if (phone) replacementByHash.set(hashDatingContactBlockValue("phone", phone), profile.user_id);
      }
    }
    if (ids.length < 200) break;
  }
  for (const row of linked.data) {
    const replacement = replacementByHash.get(row.value_hash);
    const query = replacement
      ? admin.from("dating_contact_blocks").update({ label: PREFIX + replacement })
      : admin.from("dating_contact_blocks").delete();
    const result = await query.eq("id", row.id).eq("user_id", ownerId).eq("label", label);
    if (result.error) throw new Error("block_identity_delete_failed");
  }
}

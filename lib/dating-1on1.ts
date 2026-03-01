import type { SupabaseClient, User } from "@supabase/supabase-js";

export type DatingOneOnOneWriteStatus = "approved" | "paused";
export const DATING_ONE_ON_ONE_ACTIVE_STATUSES = ["submitted", "reviewing", "approved"] as const;
export const DATING_ONE_ON_ONE_AUTO_EXPIRE_DAYS = 30;

type SiteSettingRow = {
  value_json: Record<string, unknown> | null;
};

type ProfilePhoneRow = {
  phone_verified: boolean | null;
  phone_e164: string | null;
  phone_verified_at: string | null;
};

export async function getDatingOneOnOneWriteStatus(
  adminClient: SupabaseClient
): Promise<DatingOneOnOneWriteStatus> {
  const { data } = await adminClient
    .from("site_settings")
    .select("value_json")
    .eq("key", "dating_1on1_write_status")
    .maybeSingle<SiteSettingRow>();

  const statusRaw =
    data && data.value_json && typeof data.value_json.status === "string"
      ? data.value_json.status
      : "approved";

  return statusRaw === "approved" ? "approved" : "paused";
}

export async function getProfilePhoneVerification(
  adminClient: SupabaseClient,
  userId: string
): Promise<{ phoneVerified: boolean; phoneE164: string | null; phoneVerifiedAt: string | null }> {
  const { data } = await adminClient
    .from("profiles")
    .select("phone_verified,phone_e164,phone_verified_at")
    .eq("user_id", userId)
    .maybeSingle<ProfilePhoneRow>();

  return {
    phoneVerified: data?.phone_verified === true,
    phoneE164: data?.phone_e164 ?? null,
    phoneVerifiedAt: data?.phone_verified_at ?? null,
  };
}

export function getDatingOneOnOneExpireBeforeIso(now = new Date()): string {
  return new Date(now.getTime() - DATING_ONE_ON_ONE_AUTO_EXPIRE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function expireStaleDatingOneOnOneCards(
  adminClient: SupabaseClient,
  userId?: string | null
): Promise<number> {
  const nowIso = new Date().toISOString();
  let query = adminClient
    .from("dating_1on1_cards")
    .update({
      status: "rejected",
      reviewed_at: nowIso,
      updated_at: nowIso,
    })
    .in("status", [...DATING_ONE_ON_ONE_ACTIVE_STATUSES])
    .lt("created_at", getDatingOneOnOneExpireBeforeIso())
    .select("id");

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return Array.isArray(data) ? data.length : 0;
}

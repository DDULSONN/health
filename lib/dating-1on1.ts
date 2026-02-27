import type { SupabaseClient, User } from "@supabase/supabase-js";

export type DatingOneOnOneWriteStatus = "approved" | "paused";

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

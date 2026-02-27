import type { SupabaseClient, User } from "@supabase/supabase-js";

export type DatingOneOnOneWriteStatus = "approved" | "paused";

type SiteSettingRow = {
  value_json: Record<string, unknown> | null;
};

type AuthUserLike = User & {
  phone_confirmed_at?: string | null;
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

export function isPhoneVerified(user: User): boolean {
  const candidate = user as AuthUserLike;
  const hasPhone = typeof candidate.phone === "string" && candidate.phone.trim().length > 0;
  const confirmedAt =
    typeof candidate.phone_confirmed_at === "string" && candidate.phone_confirmed_at.length > 0;
  const metadata = (candidate.user_metadata ?? {}) as Record<string, unknown>;
  const metadataVerified = metadata.phone_verified === true || metadata.phoneVerified === true;
  return hasPhone && (confirmedAt || metadataVerified);
}


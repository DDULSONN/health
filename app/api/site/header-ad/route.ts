import {
  DEFAULT_HEADER_AD_SETTING,
  HEADER_AD_SETTING_KEY,
  normalizeHeaderAdSetting,
  toPublicHeaderAd,
} from "@/lib/header-ad";
import { publicCachedJson } from "@/lib/http-cache";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_settings")
    .select("value_json")
    .eq("key", HEADER_AD_SETTING_KEY)
    .maybeSingle();

  const setting = error
    ? DEFAULT_HEADER_AD_SETTING
    : normalizeHeaderAdSetting(data?.value_json ?? DEFAULT_HEADER_AD_SETTING);

  return publicCachedJson(toPublicHeaderAd(setting), { sMaxAge: 10 });
}

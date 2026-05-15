import {
  COMMUNITY_TOP_BANNER_KEY,
  DEFAULT_COMMUNITY_TOP_BANNER,
  normalizeCommunityTopBanner,
} from "@/lib/community-top-banner";
import { publicCachedJson } from "@/lib/http-cache";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_settings")
    .select("value_json")
    .eq("key", COMMUNITY_TOP_BANNER_KEY)
    .maybeSingle();

  if (error) {
    return publicCachedJson(DEFAULT_COMMUNITY_TOP_BANNER, { sMaxAge: 60, staleWhileRevalidate: 300 });
  }

  return publicCachedJson(normalizeCommunityTopBanner(data?.value_json), { sMaxAge: 60, staleWhileRevalidate: 300 });
}

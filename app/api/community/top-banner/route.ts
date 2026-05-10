import { NextResponse } from "next/server";
import {
  COMMUNITY_TOP_BANNER_KEY,
  DEFAULT_COMMUNITY_TOP_BANNER,
  normalizeCommunityTopBanner,
} from "@/lib/community-top-banner";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_settings")
    .select("value_json")
    .eq("key", COMMUNITY_TOP_BANNER_KEY)
    .maybeSingle();

  if (error) {
    return NextResponse.json(DEFAULT_COMMUNITY_TOP_BANNER);
  }

  return NextResponse.json(normalizeCommunityTopBanner(data?.value_json));
}

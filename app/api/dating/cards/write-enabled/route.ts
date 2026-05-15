import { publicCachedJson } from "@/lib/http-cache";
import { createAdminClient } from "@/lib/supabase/server";

function parseEnabled(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const enabled = (value as { enabled?: unknown }).enabled;
  return enabled === false ? false : true;
}

export async function GET() {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("site_settings")
    .select("value_json")
    .eq("key", "open_card_write_enabled")
    .maybeSingle();

  if (error) {
    console.error("[GET /api/dating/cards/write-enabled] failed", error);
    return publicCachedJson({ enabled: true }, { sMaxAge: 30, staleWhileRevalidate: 60 });
  }

  return publicCachedJson({ enabled: parseEnabled(data?.value_json) }, { sMaxAge: 30, staleWhileRevalidate: 60 });
}

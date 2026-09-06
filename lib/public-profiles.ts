import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Public identity only. Callers must scope this query to authors/participants
 * already visible to the request. Never add contact or account-state columns.
 * The original profiles table is readable only by its owner under RLS.
 */
export function selectPublicProfiles() {
  return createAdminClient().from("profiles").select("user_id,nickname,role");
}

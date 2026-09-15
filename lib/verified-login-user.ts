import type { SupabaseClient } from "@supabase/supabase-js";

// getSession() may still contain a user that has been deleted in Auth.
// Use it only to avoid an unnecessary request for logged-out visitors.
export async function getVerifiedLoginUser(client: SupabaseClient) {
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) return null;

  const { data: { user }, error } = await client.auth.getUser();
  if (error) {
    const definitivelyInvalid = error.code === "user_not_found"
      || error.code === "session_not_found"
      || error.name === "AuthSessionMissingError"
      || error.status === 401;
    if (!definitivelyInvalid) throw error;
    await client.auth.signOut({ scope: "local" });
    return null;
  }
  if (user?.deleted_at) {
    await client.auth.signOut({ scope: "local" });
    return null;
  }
  return user;
}

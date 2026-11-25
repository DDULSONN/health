import type { SupabaseClient } from "@supabase/supabase-js";

const OWNER_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function openCardRawPhotoOwner(path: string): string | null {
  const [root, owner, folder, file, ...remaining] = path.split("/");
  if (root !== "cards" || !OWNER_UUID.test(owner ?? "") || folder !== "raw" ||
    !file || file === "." || file === ".." || remaining.length || /[\\?#]|%2e|%2f|%5c/i.test(file)) return null;
  return owner;
}

// New uploads are not yet attached to a card. A marked owner can still upload
// to private storage, but an optional public mirror is only safe for an owner
// confirmed to have no member-only cards (including expired/reusable profiles).
export async function mayMirrorOpenCardPhoto(admin: SupabaseClient, owner: string | null): Promise<boolean> {
  if (!owner || !OWNER_UUID.test(owner)) return false;
  try {
    const { data, error } = await admin.from("dating_cards")
      .select("id")
      .eq("owner_user_id", owner)
      .eq("members_only", true)
      .limit(1)
      .abortSignal(AbortSignal.timeout(2_000));
    return !error && Array.isArray(data) && data.length === 0;
  } catch {
    return false;
  }
}

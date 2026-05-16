import { NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/server";

const BUCKET = "community-fit-room";

export async function GET(request: Request) {
  const authError = ensureCronAuthorized(request);
  if (authError) return authError;

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: expired, error } = await admin
    .from("community_fit_room_entries")
    .select("id,image_path,expires_at,deleted_at")
    .lt("expires_at", cutoff)
    .limit(300);

  if (error) {
    console.error("[cron community-fit-room-cleanup] fetch failed", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const paths = (expired ?? [])
    .map((row) => String((row as { image_path?: unknown }).image_path ?? ""))
    .filter(Boolean);
  if (paths.length > 0) {
    const removeRes = await admin.storage.from(BUCKET).remove(paths);
    if (removeRes.error) {
      console.warn("[cron community-fit-room-cleanup] storage remove failed", removeRes.error.message);
    }
  }

  const ids = (expired ?? []).map((row) => String((row as { id?: unknown }).id ?? "")).filter(Boolean);
  if (ids.length > 0) {
    const deleteRes = await admin.from("community_fit_room_entries").delete().in("id", ids);
    if (deleteRes.error) {
      console.error("[cron community-fit-room-cleanup] delete failed", deleteRes.error);
      return NextResponse.json({ ok: false, error: deleteRes.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, deleted: ids.length });
}

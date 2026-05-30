import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import {
  DEFAULT_TOOLS_PATCH_NOTE,
  TOOLS_PATCH_NOTE_SETTING_KEY,
  normalizeToolsPatchNoteText,
  normalizeToolsPatchNote,
  readToolsPatchNote,
} from "@/lib/tools-patch-note";
import { createAdminClient, createClient } from "@/lib/supabase/server";

async function checkAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedAdminUser(user.id, user.email)) return null;
  return user;
}

export async function GET() {
  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "관리자 권한이 없습니다." }, { status: 403 });

  return NextResponse.json(await readToolsPatchNote());
}

export async function PATCH(req: Request) {
  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "관리자 권한이 없습니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "설정 값이 올바르지 않습니다." }, { status: 400 });
  }

  const current = await readToolsPatchNote();
  const enabled = typeof (body as { enabled?: unknown }).enabled === "boolean"
    ? (body as { enabled?: boolean }).enabled
    : DEFAULT_TOOLS_PATCH_NOTE.enabled;
  const text = normalizeToolsPatchNoteText((body as { text?: unknown }).text);
  const requestedItems = (body as { items?: unknown }).items;
  const nextItems = Array.isArray(requestedItems)
    ? requestedItems
    : text && current.items[0]?.text !== text
      ? [{ id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }, ...current.items].slice(0, 20)
      : current.items;
  const setting = normalizeToolsPatchNote({
    enabled,
    text: nextItems[0]?.text ?? "",
    items: nextItems,
  });

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("site_settings").upsert(
    {
      key: TOOLS_PATCH_NOTE_SETTING_KEY,
      value_json: setting,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("[PATCH /api/admin/tools/patch-note] failed", error);
    return NextResponse.json({ error: "도구 패치노트 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, setting });
}

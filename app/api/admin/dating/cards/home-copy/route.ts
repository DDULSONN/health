import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import {
  DEFAULT_OPEN_CARD_HOME_COPY,
  OPEN_CARD_HOME_COPY_SETTING_KEY,
  normalizeOpenCardHomeCopy,
  readOpenCardHomeCopy,
} from "@/lib/open-card-home-copy";
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

  return NextResponse.json(await readOpenCardHomeCopy());
}

export async function PATCH(req: Request) {
  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "관리자 권한이 없습니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "설정 값이 올바르지 않습니다." }, { status: 400 });
  }

  const setting = normalizeOpenCardHomeCopy({
    subtitle: (body as { subtitle?: unknown }).subtitle ?? DEFAULT_OPEN_CARD_HOME_COPY.subtitle,
  });

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("site_settings").upsert(
    {
      key: OPEN_CARD_HOME_COPY_SETTING_KEY,
      value_json: setting,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("[PATCH /api/admin/dating/cards/home-copy] failed", error);
    return NextResponse.json({ error: "오픈카드 홈 문구 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, setting });
}

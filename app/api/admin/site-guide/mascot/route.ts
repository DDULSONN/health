import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import {
  SITE_GUIDE_MASCOT_SETTING_KEY,
  normalizeSiteGuideMascotSetting,
  readSiteGuideMascotSetting,
} from "@/lib/site-guide-mascot";
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

  return NextResponse.json(await readSiteGuideMascotSetting());
}

export async function PATCH(req: Request) {
  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "관리자 권한이 없습니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "설정 값이 올바르지 않습니다." }, { status: 400 });
  }

  const setting = normalizeSiteGuideMascotSetting({
    selectedId: (body as { selectedId?: unknown }).selectedId,
  });

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("site_settings").upsert(
    {
      key: SITE_GUIDE_MASCOT_SETTING_KEY,
      value_json: { selectedId: setting.selectedId },
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("[PATCH /api/admin/site-guide/mascot] failed", error);
    return NextResponse.json({ error: "짐냥이 설정 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, setting });
}

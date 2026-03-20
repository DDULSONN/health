import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import {
  AD_INQUIRY_SETTING_KEY,
  DEFAULT_AD_INQUIRY_SETTING,
  normalizeAdInquirySetting,
  readAdInquirySetting,
} from "@/lib/ad-inquiry";
import { createAdminClient, createClient } from "@/lib/supabase/server";

async function checkAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return null;
  return user;
}

export async function GET() {
  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  return NextResponse.json(await readAdInquirySetting());
}

export async function PATCH(req: Request) {
  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "설정 값이 올바르지 않습니다." }, { status: 400 });
  }

  const setting = normalizeAdInquirySetting({
    enabled: (body as { enabled?: unknown }).enabled ?? DEFAULT_AD_INQUIRY_SETTING.enabled,
    title: (body as { title?: unknown }).title,
    description: (body as { description?: unknown }).description,
    cta: (body as { cta?: unknown }).cta,
    linkUrl: (body as { linkUrl?: unknown }).linkUrl,
    badge: (body as { badge?: unknown }).badge,
  });

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("site_settings").upsert(
    {
      key: AD_INQUIRY_SETTING_KEY,
      value_json: setting,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("[PATCH /api/admin/site/ad-inquiry] failed", error);
    return NextResponse.json({ error: "광고 문의 설정 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, setting });
}

import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import {
  OPEN_CARD_PUBLIC_SLOT_SETTING_KEY,
  getOpenCardEffectiveLimitBySex,
  getOpenCardLimitBySex,
  normalizeOpenCardPublicSlotSetting,
  readOpenCardPublicSlotSetting,
} from "@/lib/dating-open";
import { syncOpenCardQueue } from "@/lib/dating-cards-queue";
import { createAdminClient, createClient } from "@/lib/supabase/server";

async function checkAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return null;
  return user;
}

async function buildResponse(adminClient: ReturnType<typeof createAdminClient>) {
  const setting = await readOpenCardPublicSlotSetting(adminClient);
  const [maleEffectiveLimit, femaleEffectiveLimit] = await Promise.all([
    getOpenCardEffectiveLimitBySex(adminClient, "male"),
    getOpenCardEffectiveLimitBySex(adminClient, "female"),
  ]);

  return {
    maleExtra: setting.maleExtra,
    femaleExtra: setting.femaleExtra,
    maleBaseLimit: getOpenCardLimitBySex("male"),
    femaleBaseLimit: getOpenCardLimitBySex("female"),
    maleEffectiveLimit,
    femaleEffectiveLimit,
  };
}

export async function GET() {
  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const adminClient = createAdminClient();
  return NextResponse.json(await buildResponse(adminClient));
}

export async function PATCH(req: Request) {
  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "설정 값이 올바르지 않습니다." }, { status: 400 });
  }

  const setting = normalizeOpenCardPublicSlotSetting(body);
  const adminClient = createAdminClient();
  const { error } = await adminClient.from("site_settings").upsert(
    {
      key: OPEN_CARD_PUBLIC_SLOT_SETTING_KEY,
      value_json: setting,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("[PATCH /api/admin/dating/cards/public-slots] save failed", error);
    return NextResponse.json({ error: "오픈카드 공개 수 저장에 실패했습니다." }, { status: 500 });
  }

  try {
    await syncOpenCardQueue(adminClient);
  } catch (syncError) {
    console.error("[PATCH /api/admin/dating/cards/public-slots] queue sync failed", syncError);
    return NextResponse.json(
      {
        ok: false,
        error: "설정은 저장했지만 공개 대기열 동기화에 실패했습니다. 잠시 후 다시 새로고침해주세요.",
        setting: await buildResponse(adminClient),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, setting: await buildResponse(adminClient) });
}

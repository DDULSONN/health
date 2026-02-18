import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";

function parseEnabled(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const enabled = (value as { enabled?: unknown }).enabled;
  return enabled === false ? false : true;
}

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

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("site_settings")
    .select("value_json")
    .eq("key", "open_card_write_enabled")
    .maybeSingle();

  if (error) {
    console.error("[GET /api/admin/dating/cards/write-enabled] failed", error);
    return NextResponse.json({ error: "설정을 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ enabled: parseEnabled(data?.value_json) });
}

export async function PATCH(req: Request) {
  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled(boolean)가 필요합니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("site_settings").upsert(
    {
      key: "open_card_write_enabled",
      value_json: { enabled },
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("[PATCH /api/admin/dating/cards/write-enabled] failed", error);
    return NextResponse.json({ error: "설정 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, enabled });
}

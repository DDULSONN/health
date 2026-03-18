import { createAdminClient } from "@/lib/supabase/server";
import { runBodyBattleSeasonSync } from "@/lib/bodybattle-season-sync";
import { NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const authResponse = ensureCronAuthorized(request);
  if (authResponse) return authResponse;

  const admin = createAdminClient();
  const syncRes = await runBodyBattleSeasonSync(admin);
  if (!syncRes.ok) {
    return NextResponse.json({ ok: false, message: syncRes.message }, { status: 500 });
  }

  await admin.rpc("refresh_bodybattle_scoreboard_mv");

  return NextResponse.json({
    ok: true,
    ...syncRes.data,
  });
}

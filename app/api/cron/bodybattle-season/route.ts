import { createAdminClient } from "@/lib/supabase/server";
import { runBodyBattleSeasonSync } from "@/lib/bodybattle-season-sync";
import { NextResponse } from "next/server";

function isAuthorized(request: Request): boolean {
  const vercelCronHeader = request.headers.get("x-vercel-cron");
  if (vercelCronHeader) return true;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }

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

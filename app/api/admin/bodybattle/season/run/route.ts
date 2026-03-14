import { createAdminClient } from "@/lib/supabase/server";
import { runBodyBattleSeasonSync } from "@/lib/bodybattle-season-sync";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";

type RunBody = {
  mode?: "sync" | "finalize_only" | "ensure_only";
};

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as RunBody;
  const mode = body.mode ?? "sync";

  const admin = createAdminClient();
  const payload: Record<string, unknown> = { mode };
  let status = "success";

  try {
    if (mode === "sync") {
      const syncRes = await runBodyBattleSeasonSync(admin);
      if (!syncRes.ok) throw new Error(syncRes.message);
      Object.assign(payload, syncRes.data);
      await admin.rpc("refresh_bodybattle_scoreboard_mv");
    } else if (mode === "ensure_only") {
      const ensureRes = await admin.rpc("bodybattle_ensure_current_season");
      if (ensureRes.error) throw new Error(ensureRes.error.message);
      payload.ensured = ensureRes.data ?? null;
    } else if (mode === "finalize_only") {
      const finalizeRes = await admin.rpc("bodybattle_finalize_due_seasons");
      if (finalizeRes.error) throw new Error(finalizeRes.error.message);
      payload.finalized = finalizeRes.data ?? null;
      await admin.rpc("refresh_bodybattle_scoreboard_mv");
    }
  } catch (error) {
    status = "error";
    payload.error = error instanceof Error ? error.message : String(error);
  }

  await admin.from("bodybattle_admin_runs").insert({
    run_type: "season_run",
    status,
    requested_by_user_id: auth.user.id,
    payload,
  });

  if (status === "error") {
    return NextResponse.json(
      {
        ok: false,
        message: typeof payload.error === "string" ? payload.error : "Failed to run season sync.",
        ...payload,
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, ...payload });
}

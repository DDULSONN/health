import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";

type RollbackBody = {
  run_id?: string;
};

type BulkChange = {
  week_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as RollbackBody;
  const runId = (body.run_id ?? "").trim();
  if (!runId) {
    return NextResponse.json({ ok: false, message: "run_id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const runRes = await admin
    .from("bodybattle_admin_runs")
    .select("id,run_type,payload,created_at")
    .eq("id", runId)
    .maybeSingle();
  if (runRes.error) {
    return NextResponse.json({ ok: false, message: runRes.error.message }, { status: 500 });
  }
  if (!runRes.data || runRes.data.run_type !== "season_bulk_upsert") {
    return NextResponse.json({ ok: false, message: "Rollback target run not found." }, { status: 404 });
  }

  const payload = (runRes.data.payload ?? {}) as { changes?: BulkChange[] };
  const changes = payload.changes ?? [];
  const restored: string[] = [];
  const deleted: string[] = [];
  const skipped: string[] = [];

  for (const change of changes) {
    const before = change.before;
    const after = change.after;
    const targetWeekId = String(change.week_id ?? "");
    if (!targetWeekId) continue;

    const liveRes = await admin.from("bodybattle_seasons").select("id,end_at,status").eq("week_id", targetWeekId).maybeSingle();
    if (liveRes.error) {
      return NextResponse.json({ ok: false, message: liveRes.error.message }, { status: 500 });
    }
    const ended = liveRes.data ? new Date(String(liveRes.data.end_at)).getTime() <= Date.now() : false;
    if (ended) {
      skipped.push(targetWeekId);
      continue;
    }

    if (before) {
      const patch = {
        theme_slug: String(before.theme_slug ?? ""),
        theme_label: String(before.theme_label ?? ""),
        start_at: String(before.start_at ?? ""),
        end_at: String(before.end_at ?? ""),
        status: String(before.status ?? "draft"),
      };
      const restoreRes = await admin.from("bodybattle_seasons").update(patch).eq("week_id", targetWeekId);
      if (restoreRes.error) {
        return NextResponse.json({ ok: false, message: restoreRes.error.message }, { status: 500 });
      }
      restored.push(targetWeekId);
    } else if (after) {
      const deleteRes = await admin.from("bodybattle_seasons").delete().eq("week_id", targetWeekId);
      if (deleteRes.error) {
        return NextResponse.json({ ok: false, message: deleteRes.error.message }, { status: 500 });
      }
      deleted.push(targetWeekId);
    }
  }

  await admin.from("bodybattle_admin_runs").insert({
    run_type: "season_bulk_rollback",
    status: "success",
    requested_by_user_id: auth.user.id,
    payload: {
      source_run_id: runId,
      restored,
      deleted,
      skipped,
    },
  });

  return NextResponse.json({
    ok: true,
    restored,
    deleted,
    skipped,
  });
}


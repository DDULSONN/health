import { BODY_BATTLE_THEMES, getThemeBySlug } from "@/lib/bodybattle";
import { getKstWeekId, getKstWeekRangeFromWeekId } from "@/lib/weekly";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";

type BulkBody = {
  start_week_id?: string;
  weeks?: number;
  theme_slugs?: string[];
};

function normalizeWeekId(value: string | undefined) {
  const v = (value ?? "").trim().toUpperCase();
  return /^\d{4}-W\d{2}$/.test(v) ? v : "";
}

function nextWeekId(weekId: string) {
  const range = getKstWeekRangeFromWeekId(weekId);
  if (!range) return "";
  const next = new Date(range.startUtc.getTime() + 7 * 24 * 60 * 60 * 1000);
  return getKstWeekId(next);
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as BulkBody;
  const weeks = Math.max(1, Math.min(12, Number(body.weeks ?? 4)));
  const startWeekId = normalizeWeekId(body.start_week_id) || getKstWeekId(new Date());
  const cycle = (body.theme_slugs ?? []).filter((slug) => Boolean(getThemeBySlug(slug)));
  const themeCycle = cycle.length > 0 ? cycle : BODY_BATTLE_THEMES.map((theme) => theme.slug);

  const admin = createAdminClient();
  const changes: Array<{ week_id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }> = [];
  const now = Date.now();

  let currentWeekId = startWeekId;
  for (let i = 0; i < weeks; i += 1) {
    const range = getKstWeekRangeFromWeekId(currentWeekId);
    if (!range) {
      return NextResponse.json({ ok: false, message: `Invalid week_id: ${currentWeekId}` }, { status: 400 });
    }
    const themeSlug = themeCycle[i % themeCycle.length]!;
    const theme = getThemeBySlug(themeSlug)!;

    const beforeRes = await admin
      .from("bodybattle_seasons")
      .select("id,week_id,theme_slug,theme_label,start_at,end_at,status")
      .eq("week_id", currentWeekId)
      .maybeSingle();
    if (beforeRes.error) {
      return NextResponse.json({ ok: false, message: beforeRes.error.message }, { status: 500 });
    }

    const nextStatus = range.endUtc.getTime() <= now ? "closed" : range.startUtc.getTime() <= now ? "active" : "draft";
    const upsertRes = await admin
      .from("bodybattle_seasons")
      .upsert(
        {
          week_id: currentWeekId,
          theme_slug: theme.slug,
          theme_label: theme.label,
          start_at: range.startUtcIso,
          end_at: range.endUtcIso,
          status: beforeRes.data?.status === "active" ? "active" : nextStatus,
          created_by_user_id: auth.user.id,
        },
        { onConflict: "week_id" }
      )
      .select("id,week_id,theme_slug,theme_label,start_at,end_at,status")
      .single();
    if (upsertRes.error) {
      return NextResponse.json({ ok: false, message: upsertRes.error.message }, { status: 500 });
    }

    changes.push({
      week_id: currentWeekId,
      before: beforeRes.data ?? null,
      after: upsertRes.data ?? null,
    });
    currentWeekId = nextWeekId(currentWeekId);
    if (!currentWeekId) break;
  }

  const runRes = await admin
    .from("bodybattle_admin_runs")
    .insert({
      run_type: "season_bulk_upsert",
      status: "success",
      requested_by_user_id: auth.user.id,
      payload: {
        start_week_id: startWeekId,
        weeks,
        theme_cycle: themeCycle,
        changes,
      },
    })
    .select("id,created_at")
    .single();
  if (runRes.error) {
    return NextResponse.json({ ok: false, message: runRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, run: runRes.data, changes });
}


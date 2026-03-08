import { BODY_BATTLE_THEMES, getThemeBySlug } from "@/lib/bodybattle";
import { getKstWeekRangeFromWeekId } from "@/lib/weekly";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "../_auth";

type UpsertSeasonBody = {
  week_id?: string;
  theme_slug?: string;
  theme_label?: string;
};

function normalizeWeekId(value: string | undefined) {
  const v = (value ?? "").trim().toUpperCase();
  if (!/^\d{4}-W\d{2}$/.test(v)) return "";
  return v;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const [seasonsRes, activeRes] = await Promise.all([
    admin
      .from("bodybattle_seasons")
      .select("id,week_id,theme_slug,theme_label,start_at,end_at,status,created_at,updated_at")
      .order("start_at", { ascending: true })
      .gte("end_at", new Date(Date.now() - 1000 * 60 * 60 * 24 * 28).toISOString())
      .limit(40),
    admin
      .from("bodybattle_seasons")
      .select("id,week_id,theme_slug,theme_label,start_at,end_at,status")
      .eq("status", "active")
      .lte("start_at", nowIso)
      .gt("end_at", nowIso)
      .order("start_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (seasonsRes.error) {
    return NextResponse.json({ ok: false, message: seasonsRes.error.message }, { status: 500 });
  }
  if (activeRes.error) {
    return NextResponse.json({ ok: false, message: activeRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    active: activeRes.data ?? null,
    items: seasonsRes.data ?? [],
    themes: BODY_BATTLE_THEMES.map((theme) => ({ slug: theme.slug, label: theme.label })),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as UpsertSeasonBody;
  const weekId = normalizeWeekId(body.week_id);
  const themeSlug = (body.theme_slug ?? "").trim();
  const theme = getThemeBySlug(themeSlug);

  if (!weekId) {
    return NextResponse.json({ ok: false, message: "week_id is required (YYYY-W##)." }, { status: 400 });
  }
  if (!theme) {
    return NextResponse.json({ ok: false, message: "theme_slug is invalid." }, { status: 400 });
  }

  const weekRange = getKstWeekRangeFromWeekId(weekId);
  if (!weekRange) {
    return NextResponse.json({ ok: false, message: "Invalid week_id range." }, { status: 400 });
  }

  const admin = createAdminClient();
  const existingRes = await admin
    .from("bodybattle_seasons")
    .select("id,week_id,start_at,end_at,status")
    .eq("week_id", weekId)
    .limit(1)
    .maybeSingle();
  if (existingRes.error) {
    return NextResponse.json({ ok: false, message: existingRes.error.message }, { status: 500 });
  }

  const now = Date.now();
  const weekEndMs = weekRange.endUtc.getTime();
  const defaultLabel = theme.label;
  const requestedLabel = (body.theme_label ?? "").trim();
  const themeLabel = requestedLabel ? requestedLabel.slice(0, 80) : defaultLabel;
  const nextStatus = weekEndMs <= now ? "closed" : weekRange.startUtc.getTime() <= now ? "active" : "draft";

  if (existingRes.data && new Date(existingRes.data.end_at).getTime() <= now) {
    return NextResponse.json({ ok: false, message: "Ended season cannot be edited." }, { status: 400 });
  }

  const upsertRes = await admin
    .from("bodybattle_seasons")
    .upsert(
      {
        week_id: weekId,
        theme_slug: theme.slug,
        theme_label: themeLabel,
        start_at: weekRange.startUtcIso,
        end_at: weekRange.endUtcIso,
        status: existingRes.data?.status === "active" ? "active" : nextStatus,
        created_by_user_id: auth.user.id,
      },
      { onConflict: "week_id" }
    )
    .select("id,week_id,theme_slug,theme_label,start_at,end_at,status,created_at,updated_at")
    .single();

  if (upsertRes.error) {
    return NextResponse.json({ ok: false, message: upsertRes.error.message }, { status: 500 });
  }

  await admin.from("bodybattle_admin_runs").insert({
    run_type: "season_theme_upsert",
    status: "success",
    requested_by_user_id: auth.user.id,
    payload: {
      season_id: upsertRes.data.id,
      week_id: upsertRes.data.week_id,
      theme_slug: upsertRes.data.theme_slug,
      theme_label: upsertRes.data.theme_label,
    },
  });

  return NextResponse.json({ ok: true, item: upsertRes.data });
}


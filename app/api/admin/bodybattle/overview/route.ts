import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "../_auth";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");

  const seasonQuery = admin
    .from("bodybattle_seasons")
    .select("id,week_id,theme_slug,theme_label,start_at,end_at,status")
    .order("start_at", { ascending: false })
    .limit(1);
  const seasonRes = seasonId
    ? await seasonQuery.eq("id", seasonId).maybeSingle()
    : await seasonQuery.eq("status", "active").lte("start_at", nowIso).gt("end_at", nowIso).maybeSingle();

  if (seasonRes.error) {
    return NextResponse.json({ ok: false, message: seasonRes.error.message }, { status: 500 });
  }

  const season = seasonRes.data ?? null;
  if (!season) {
    return NextResponse.json({ ok: true, season: null, counts: null });
  }

  const [entryCountsRes, reportCountsRes, votesRes, claimsRes] = await Promise.all([
    admin
      .from("bodybattle_entries")
      .select("id,moderation_status,status", { count: "exact" })
      .eq("season_id", season.id),
    admin
      .from("bodybattle_reports")
      .select("id,status", { count: "exact" })
      .eq("season_id", season.id),
    admin
      .from("bodybattle_votes")
      .select("id", { count: "exact" })
      .eq("season_id", season.id),
    admin
      .from("bodybattle_reward_claims")
      .select("id", { count: "exact" })
      .gte("claimed_at", season.start_at)
      .lt("claimed_at", season.end_at),
  ]);

  if (entryCountsRes.error || reportCountsRes.error || votesRes.error || claimsRes.error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          entryCountsRes.error?.message ??
          reportCountsRes.error?.message ??
          votesRes.error?.message ??
          claimsRes.error?.message ??
          "Failed to load overview.",
      },
      { status: 500 }
    );
  }

  const entries = entryCountsRes.data ?? [];
  const reports = reportCountsRes.data ?? [];
  const pendingEntries = entries.filter((row) => row.moderation_status === "pending").length;
  const approvedActiveEntries = entries.filter((row) => row.moderation_status === "approved" && row.status === "active").length;
  const hiddenEntries = entries.filter((row) => row.status === "hidden").length;
  const openReports = reports.filter((row) => row.status === "pending").length;

  return NextResponse.json({
    ok: true,
    season,
    counts: {
      entries_total: entryCountsRes.count ?? entries.length,
      entries_pending: pendingEntries,
      entries_approved_active: approvedActiveEntries,
      entries_hidden: hiddenEntries,
      reports_open: openReports,
      votes_total: votesRes.count ?? 0,
      rewards_claimed: claimsRes.count ?? 0,
    },
  });
}

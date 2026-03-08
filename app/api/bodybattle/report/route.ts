import {
  BODY_BATTLE_REPORT_BLIND_THRESHOLD,
  BODY_BATTLE_REPORT_COOLDOWN_MS,
  BODY_BATTLE_REPORT_DAILY_LIMIT,
} from "@/lib/bodybattle";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ReportBody = {
  season_id?: string;
  entry_id?: string;
  reason?: string;
};

function normalizeReason(value: string | undefined) {
  const text = (value ?? "").trim();
  if (!text) return "";
  return text.slice(0, 240);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Login is required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ReportBody;
  const seasonId = (body.season_id ?? "").trim();
  const entryId = (body.entry_id ?? "").trim();
  const reason = normalizeReason(body.reason);
  if (!seasonId || !entryId || !reason) {
    return NextResponse.json({ ok: false, message: "season_id, entry_id, reason are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const entryRes = await admin
    .from("bodybattle_entries")
    .select("id,user_id,season_id,status,moderation_status,report_count")
    .eq("id", entryId)
    .eq("season_id", seasonId)
    .maybeSingle();
  if (entryRes.error) {
    return NextResponse.json({ ok: false, message: entryRes.error.message }, { status: 500 });
  }
  if (!entryRes.data) {
    return NextResponse.json({ ok: false, message: "Entry not found." }, { status: 404 });
  }
  if (entryRes.data.user_id === user.id) {
    return NextResponse.json({ ok: false, message: "You cannot report your own entry." }, { status: 400 });
  }

  const [lastMyReportRes, todayCountRes, dupRes] = await Promise.all([
    admin
      .from("bodybattle_reports")
      .select("created_at")
      .eq("reporter_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("bodybattle_reports")
      .select("id", { count: "exact", head: true })
      .eq("reporter_user_id", user.id)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    admin
      .from("bodybattle_reports")
      .select("id")
      .eq("entry_id", entryId)
      .eq("reporter_user_id", user.id)
      .limit(1)
      .maybeSingle(),
  ]);
  if (lastMyReportRes.error || todayCountRes.error || dupRes.error) {
    return NextResponse.json(
      {
        ok: false,
        message: lastMyReportRes.error?.message ?? todayCountRes.error?.message ?? dupRes.error?.message ?? "Failed to validate report.",
      },
      { status: 500 }
    );
  }

  if (dupRes.data) {
    return NextResponse.json({ ok: false, message: "You already reported this entry." }, { status: 409 });
  }
  if ((todayCountRes.count ?? 0) >= BODY_BATTLE_REPORT_DAILY_LIMIT) {
    return NextResponse.json({ ok: false, message: "Daily report limit reached." }, { status: 429 });
  }
  if (lastMyReportRes.data?.created_at) {
    const elapsed = Date.now() - new Date(lastMyReportRes.data.created_at).getTime();
    if (elapsed < BODY_BATTLE_REPORT_COOLDOWN_MS) {
      return NextResponse.json({ ok: false, message: `Please retry in ${Math.ceil((BODY_BATTLE_REPORT_COOLDOWN_MS - elapsed) / 1000)}s.` }, { status: 429 });
    }
  }

  const insertRes = await admin
    .from("bodybattle_reports")
    .insert({
      season_id: seasonId,
      entry_id: entryId,
      reporter_user_id: user.id,
      reason,
      status: "pending",
    })
    .select("id,entry_id,status,created_at")
    .single();
  if (insertRes.error) {
    return NextResponse.json({ ok: false, message: insertRes.error.message }, { status: 500 });
  }

  const countRes = await admin.from("bodybattle_reports").select("id", { count: "exact", head: true }).eq("entry_id", entryId);
  if (countRes.error) {
    return NextResponse.json({ ok: false, message: countRes.error.message }, { status: 500 });
  }
  const reportCount = Number(countRes.count ?? 0);
  const shouldHide = reportCount >= BODY_BATTLE_REPORT_BLIND_THRESHOLD;
  const patch: Record<string, unknown> = { report_count: reportCount };
  if (shouldHide && entryRes.data.status !== "hidden") {
    patch.status = "hidden";
  }
  await admin.from("bodybattle_entries").update(patch).eq("id", entryId);

  return NextResponse.json({
    ok: true,
    report: insertRes.data,
    report_count: reportCount,
    auto_hidden: shouldHide,
  });
}


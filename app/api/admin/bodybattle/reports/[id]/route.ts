import { createAdminClient } from "@/lib/supabase/server";
import { BODY_BATTLE_REPORT_BLIND_THRESHOLD } from "@/lib/bodybattle";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";

type PatchBody = {
  status?: "pending" | "reviewed" | "dismissed";
  apply_entry_action?: "none" | "hide";
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const nextStatus = body.status;
  const applyEntryAction = body.apply_entry_action ?? "none";
  if (!nextStatus || !["pending", "reviewed", "dismissed"].includes(nextStatus)) {
    return NextResponse.json({ ok: false, message: "Invalid status." }, { status: 400 });
  }

  const admin = createAdminClient();
  const reportRes = await admin.from("bodybattle_reports").select("id,entry_id,status").eq("id", id).maybeSingle();
  if (reportRes.error) {
    return NextResponse.json({ ok: false, message: reportRes.error.message }, { status: 500 });
  }
  if (!reportRes.data) {
    return NextResponse.json({ ok: false, message: "Report not found." }, { status: 404 });
  }

  const updateRes = await admin.from("bodybattle_reports").update({ status: nextStatus }).eq("id", id);
  if (updateRes.error) {
    return NextResponse.json({ ok: false, message: updateRes.error.message }, { status: 500 });
  }

  if (applyEntryAction === "hide") {
    await admin.from("bodybattle_entries").update({ status: "hidden" }).eq("id", reportRes.data.entry_id);
  }

  const activeCountRes = await admin
    .from("bodybattle_reports")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", reportRes.data.entry_id)
    .in("status", ["pending", "reviewed"]);
  if (!activeCountRes.error) {
    const reportCount = Number(activeCountRes.count ?? 0);
    const patch: Record<string, unknown> = { report_count: reportCount };
    if (reportCount >= BODY_BATTLE_REPORT_BLIND_THRESHOLD) {
      patch.status = "hidden";
    }
    await admin.from("bodybattle_entries").update(patch).eq("id", reportRes.data.entry_id);
  }

  return NextResponse.json({ ok: true });
}

import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

type ActionType = "none" | "evidence_preserved" | "temporarily_hidden" | "warning" | "banned" | "restored";

type ReportRow = {
  id: string;
  target_type: "open_card_application" | "paid_card_application" | "one_on_one_card" | "one_on_one_match";
  target_id: string;
  target_card_id: string | null;
  evidence_snapshot: unknown;
};

function cleanText(value: unknown, max = 1200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isStatus(value: string) {
  return value === "open" || value === "resolved" || value === "dismissed";
}

function isActionType(value: string): value is ActionType {
  return (
    value === "none" ||
    value === "evidence_preserved" ||
    value === "temporarily_hidden" ||
    value === "warning" ||
    value === "banned" ||
    value === "restored"
  );
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("column") || message.includes("schema cache");
}

async function refreshEvidenceSnapshot(admin: ReturnType<typeof createAdminClient>, report: ReportRow) {
  let card: unknown = null;
  let target: unknown = null;

  if (report.target_type === "open_card_application") {
    target = await admin.from("dating_card_applications").select("*").eq("id", report.target_id).maybeSingle();
    if (report.target_card_id) card = await admin.from("dating_cards").select("*").eq("id", report.target_card_id).maybeSingle();
  } else if (report.target_type === "paid_card_application") {
    target = await admin.from("dating_paid_card_applications").select("*").eq("id", report.target_id).maybeSingle();
    if (report.target_card_id) card = await admin.from("dating_paid_cards").select("*").eq("id", report.target_card_id).maybeSingle();
  } else if (report.target_type === "one_on_one_card") {
    card = await admin.from("dating_1on1_cards").select("*").eq("id", report.target_card_id ?? report.target_id).maybeSingle();
  } else {
    target = await admin.from("dating_1on1_match_proposals").select("*").eq("id", report.target_id).maybeSingle();
    if (report.target_card_id) card = await admin.from("dating_1on1_cards").select("*").eq("id", report.target_card_id).maybeSingle();
  }

  return {
    ...(typeof report.evidence_snapshot === "object" && report.evidence_snapshot ? report.evidence_snapshot : {}),
    recaptured_at: new Date().toISOString(),
    target,
    card,
  };
}

export async function PATCH(req: Request, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { id } = await params;
  const reportId = String(id ?? "").trim();
  const body = ((await req.json().catch(() => null)) ?? {}) as {
    status?: unknown;
    admin_note?: unknown;
    action_type?: unknown;
    action_note?: unknown;
    preserve_evidence?: unknown;
  };

  const status = typeof body.status === "string" ? body.status.trim() : "";
  const actionType = typeof body.action_type === "string" ? body.action_type.trim() : "";

  if (!reportId || (status && !isStatus(status)) || (actionType && !isActionType(actionType))) {
    return NextResponse.json({ error: "요청 값을 확인해 주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  let reportRes = await admin
    .from("dating_user_reports")
    .select("id,target_type,target_id,target_card_id,evidence_snapshot")
    .eq("id", reportId)
    .maybeSingle();

  if (reportRes.error && isMissingColumnError(reportRes.error)) {
    reportRes = await admin
      .from("dating_user_reports")
      .select("id,target_type,target_id,target_card_id")
      .eq("id", reportId)
      .maybeSingle();
  }

  if (reportRes.error || !reportRes.data) {
    if (reportRes.error) console.error("[PATCH /api/admin/dating/user-reports/[id]] load failed", reportRes.error);
    return NextResponse.json({ error: "신고 내용을 찾지 못했습니다." }, { status: 404 });
  }

  const patch: Record<string, unknown> = {
    reviewed_at: new Date().toISOString(),
    reviewed_by_user_id: user.id,
  };

  if (status) patch.status = status;
  if (body.admin_note !== undefined) patch.admin_note = cleanText(body.admin_note);
  if (actionType) {
    patch.action_type = actionType;
    patch.actioned_at = new Date().toISOString();
    patch.actioned_by_user_id = user.id;
  }
  if (body.action_note !== undefined) patch.action_note = cleanText(body.action_note);

  if (body.preserve_evidence === true || actionType === "evidence_preserved") {
    patch.evidence_snapshot = await refreshEvidenceSnapshot(admin, reportRes.data as ReportRow);
    patch.evidence_preserved_at = new Date().toISOString();
  }

  let { error } = await admin.from("dating_user_reports").update(patch).eq("id", reportId);

  if (error && isMissingColumnError(error)) {
    const legacyPatch: Record<string, unknown> = {};
    if (status) legacyPatch.status = status;
    if (Object.keys(legacyPatch).length > 0) {
      const legacyRes = await admin.from("dating_user_reports").update(legacyPatch).eq("id", reportId);
      error = legacyRes.error;
    }
  }

  if (error) {
    console.error("[PATCH /api/admin/dating/user-reports/[id]] failed", error);
    return NextResponse.json({ error: "신고 상태를 변경하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

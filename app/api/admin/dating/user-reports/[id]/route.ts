import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { safeReportEvidence, isReportUuid } from "@/lib/dating-report-safety";
import { requireAdminRoute } from "@/lib/admin-route";
import type { createAdminClient } from "@/lib/supabase/server";
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
  const read = async (table: string, id: string) => {
    const result = await admin.from(table).select("*").eq("id", id).maybeSingle();
    if (result.error) throw result.error;
    return safeReportEvidence(result.data);
  };
  const cardTable = report.target_type === "open_card_application" ? "dating_cards"
    : report.target_type === "paid_card_application" ? "dating_paid_cards" : "dating_1on1_cards";
  const targetTable = report.target_type === "open_card_application" ? "dating_card_applications"
    : report.target_type === "paid_card_application" ? "dating_paid_card_applications"
    : report.target_type === "one_on_one_match" ? "dating_1on1_match_proposals" : null;
  const cardId = report.target_card_id ?? (report.target_type === "one_on_one_card" ? report.target_id : null);
  const [target, card] = await Promise.all([
    targetTable ? read(targetTable, report.target_id) : null,
    cardId ? read(cardTable, cardId) : null,
  ]);
  const original = typeof report.evidence_snapshot === "object" && report.evidence_snapshot
    ? report.evidence_snapshot as Record<string, unknown> : {};
  // Preserve the original evidence even after the reported profile was edited/deleted.
  return {
    captured_at: typeof original.captured_at === "string" ? original.captured_at : new Date().toISOString(),
    target_type: report.target_type, target_id: report.target_id, target_card_id: report.target_card_id,
    reporter_profile: safeReportEvidence(original.reporter_profile),
    reported_profile: safeReportEvidence(original.reported_profile),
    target: safeReportEvidence(original.target) ?? target,
    card: safeReportEvidence(original.card) ?? card,
    latest: { captured_at: new Date().toISOString(), target, card },
  };
}

export async function PATCH(req: Request, { params }: Params) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;
  const { user } = auth;

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

  if (!isReportUuid(reportId) || (status && !isStatus(status)) || (actionType && !isActionType(actionType))) {
    return NextResponse.json({ error: "요청 값을 확인해 주세요." }, { status: 400 });
  }

  const extended = body.preserve_evidence === true || Boolean(actionType) || body.admin_note !== undefined || body.action_note !== undefined;
  if (!status && !extended) return NextResponse.json({ error: "변경할 항목이 없습니다." }, { status: 400 });
  const admin = auth.admin;
  let reportRes = await admin
    .from("dating_user_reports")
    .select("id,target_type,target_id,target_card_id,evidence_snapshot")
    .eq("id", reportId)
    .maybeSingle();

  if (reportRes.error && isMissingColumnError(reportRes.error)) {
    if (extended) return NextResponse.json({ error: "증거 보존 DB 업데이트가 필요합니다. 신고 접수와 상태 처리는 이용할 수 있습니다.", code: "report_schema_update_required" }, { status: 409 });
    reportRes = await admin
      .from("dating_user_reports")
      .select("id,target_type,target_id,target_card_id")
      .eq("id", reportId)
      .maybeSingle();
  }

  if (reportRes.error || !reportRes.data) {
    if (reportRes.error) console.error("[PATCH /api/admin/dating/user-reports/[id]] load failed", reportRes.error);
    return NextResponse.json({ error: "신고 내용을 찾지 못했습니다." }, { status: reportRes.error ? 500 : 404 });
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
    try {
      patch.evidence_snapshot = await refreshEvidenceSnapshot(admin, reportRes.data as ReportRow);
    } catch (error) {
      console.error("[admin report] evidence read failed", error);
      return NextResponse.json({ error: "증거를 불러오지 못했습니다. 기존 증거는 유지됩니다." }, { status: 500 });
    }
    patch.evidence_preserved_at = new Date().toISOString();
  }

  const { data: updated, error } = await admin.from("dating_user_reports").update(patch).eq("id", reportId).select("id").maybeSingle();

  if (error && isMissingColumnError(error)) {
    return NextResponse.json({ error: "증거 보존 DB 업데이트가 필요합니다. 변경은 적용되지 않았습니다.", code: "report_schema_update_required" }, { status: 409 });
  }

  if (error) {
    console.error("[PATCH /api/admin/dating/user-reports/[id]] failed", error);
    return NextResponse.json({ error: "신고 상태를 변경하지 못했습니다." }, { status: 500 });
  }

  if (!updated) return NextResponse.json({ error: "신고가 더 이상 존재하지 않습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

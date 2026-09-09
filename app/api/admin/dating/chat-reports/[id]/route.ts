import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { isReportUuid } from "@/lib/dating-report-safety";
import { requireAdminRoute } from "@/lib/admin-route";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const reportId = String(id ?? "").trim();
  const body = ((await req.json().catch(() => null)) ?? {}) as { status?: unknown };
  const status = typeof body.status === "string" ? body.status.trim() : "";

  if (!isReportUuid(reportId) || !["open", "resolved", "dismissed"].includes(status)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const admin = auth.admin;
  const { data, error } = await admin
    .from("dating_chat_reports")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: auth.user.id,
    })
    .eq("id", reportId).select("id").maybeSingle();

  if (error) {
    console.error("[PATCH /api/admin/dating/chat-reports/[id]] failed", error);
    return NextResponse.json({ error: "채팅 신고 상태를 변경하지 못했습니다." }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: "신고가 존재하지 않습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

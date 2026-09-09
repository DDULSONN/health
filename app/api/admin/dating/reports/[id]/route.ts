import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { isReportUuid } from "@/lib/dating-report-safety";
import { requireAdminRoute } from "@/lib/admin-route";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isReportUuid(id)) return NextResponse.json({ error: "신고 ID를 확인해 주세요." }, { status: 400 });
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const status = (body as { status?: string } | null)?.status;
  if (status !== "open" && status !== "resolved" && status !== "dismissed") {
    return NextResponse.json({ error: "허용되지 않은 상태값입니다." }, { status: 400 });
  }

  const adminClient = auth.admin;
  const { data, error } = await adminClient
    .from("dating_card_reports")
    .update({ status })
    .eq("id", id).select("id").maybeSingle();

  if (error) {
    console.error("[PATCH /api/admin/dating/reports/[id]] failed", error);
    return NextResponse.json({ error: "신고 상태 변경에 실패했습니다." }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: "신고가 존재하지 않습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, status });
}

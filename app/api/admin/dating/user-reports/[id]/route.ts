import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

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
  const body = ((await req.json().catch(() => null)) ?? {}) as { status?: unknown };
  const status = typeof body.status === "string" ? body.status.trim() : "";

  if (!reportId || !["open", "resolved", "dismissed"].includes(status)) {
    return NextResponse.json({ error: "요청 값을 확인해 주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("dating_user_reports")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: user.id,
    })
    .eq("id", reportId);

  if (error) {
    console.error("[PATCH /api/admin/dating/user-reports/[id]] failed", error);
    return NextResponse.json({ error: "신고 상태를 변경하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
